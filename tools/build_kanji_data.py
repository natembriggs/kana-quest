"""Build src/data/kanji-grade-*.js and src/data/kanji-manifest.js from
KANJIDIC2 and JMdict.

Extracts kanji for the given school grades with their on'yomi/kun'yomi
readings, English meanings, and example words. Writes one data file PER
GRADE (`KANJI_ENTRIES`, the full per-kanji data) plus one small always-loaded
manifest (`KANJI_UNITS`, just the ordered character list per grade, and
`NO_YOMI_CHARS`, the handful of kanji with no quizzable reading at all) — see
kanji-expansion-plan.md §4. `src/kanji.js` loads a grade's `KANJI_ENTRIES`
file lazily, on demand; the manifest is small enough to load eagerly and is
enough on its own to build the app's course skeleton (ids, chunks, overview
tiles) without touching the network.

The hard part is the per-reading example index: the word shown when a learner
taps one specific reading. A naive "does the word's reading start with this
reading" test is badly wrong — 十二 (じゅうに) starts with じ, so it would be
offered as proof that 二 can be read ジ, when in fact 二 is に there and じゅう
belongs to 十. So this script actually aligns each word's kanji against its
reading, using every kanji's readings from KANJIDIC (all of them, not just
the grades being built), and only credits a word to a reading when that
reading is genuinely what the target kanji contributes.

Source data (CC BY-SA, The Electronic Dictionary Research and Development
Group, https://www.edrdg.org/) is downloaded by fetch_kanji_sources.sh into
tools/data_src/ and is NOT committed — this script is meant to be re-run
rather than the multi-hundred-MB sources kept in git.

Usage:
    python3 tools/build_kanji_data.py
"""
import html
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "tools" / "data_src"
DATA_DIR = ROOT / "src" / "data"

# KANJIDIC's own grade values to include: 1-6 (elementary/Kyoiku), 8
# (secondary jōyō — everything in the 2,136-kanji jōyō set that isn't
# elementary). Grade 7 doesn't exist in KANJIDIC's scheme; 9/10 are jinmeiyō
# (name kanji, not jōyō) and are out of scope — see kanji-expansion-plan.md
# §5 for that as a separate, later phase. Grades 1-6 + 8 sum to exactly
# 2,136 — but count alone doesn't prove the SET is right, see
# UNICODE_VARIANT_SUBSTITUTIONS immediately below for the four places it
# wasn't, found by diffing against an independent jōyō character list.
GRADES = (1, 2, 3, 4, 5, 6, 8)
GRADE_8_SUB_UNITS = 6   # secondary jōyō (1,110 kanji) is one KANJIDIC grade
                        # but far too big to be one teaching unit or one lazy-
                        # loaded chunk — split into this many, by frequency
                        # rank, each its own grade-picker tile. See
                        # split_grade_8() and kanji-expansion-plan.md §8.
EXAMPLES_PER_KANJI = 4
MAX_KANJI_PER_WORD = 2      # cap for the general example-word list (grade-appropriate only)
MAX_KANJI_PER_READING_WORD = 3  # looser cap for reading-anchored lookups (see below)
MAX_QUIZ_READINGS = 6   # must match MAX_CORRECT_READINGS in kanji.js

# A handful of jōyō kanji exist at TWO Unicode code points: the one
# KANJIDIC's <grade> field tags as jōyō (a legacy pre-Unicode-consolidation
# "IVS" glyph form), and a second, visually near-identical one that is what
# every IME, font, and real dictionary entry actually uses. JMdict's word
# list lives almost entirely on the second form — e.g. 𠮟 (KANJIDIC's graded
# code point for "scold") has ZERO JMdict entries, so no word could ever
# align to it and it would end up with no quizzable reading at all, even
# though 叱る (the everyday spelling, U+53F1) is common enough to carry an
# `nf` priority band. Confirmed by hand against the fetched sources: both
# code points in every pair below have KanjiVG stroke data, so switching
# which one is taught costs nothing there. Applied as a grade transplant in
# main() — the common code point's own KANJIDIC entry (on/kun/meanings) is
# kept as-is, it just wasn't tagged jōyō before this.
UNICODE_VARIANT_SUBSTITUTIONS = {
    "剝": "剥",  # peel — is what 剥がす actually uses
    "塡": "填",  # fill — 填める
    "頰": "頬",  # cheek — 頬づえ
    "𠮟": "叱",  # scold — 叱る
}

KANJIDIC = SRC / "kanjidic2.xml"
JMDICT = SRC / "JMdict_e"

# KANJIDIC lists the radical's *name* as if it were a meaning: "one radical
# (no.1)", "sun radical (no. 72)". Those are not definitions and shouldn't be
# quizzed. Matched on the "(no. N)" shape rather than the bare word "radical",
# because 根 ("radical", as in a mathematical root) and 基 ("radical (chem)")
# are genuine English definitions that must survive.
RADICAL_MEANING = re.compile(r"radical\s*\(no", re.I)

# Sequential-voicing (rendaku) and its handakuten variant: the first kana of a
# reading is often voiced when the reading appears as the second element of a
# compound (く+かい -> こうかい ... more relevantly 学 がく in 大学 だいがく).
RENDAKU = {
    'か': 'が', 'き': 'ぎ', 'く': 'ぐ', 'け': 'げ', 'こ': 'ご',
    'さ': 'ざ', 'し': 'じ', 'す': 'ず', 'せ': 'ぜ', 'そ': 'ぞ',
    'た': 'だ', 'ち': 'ぢ', 'つ': 'づ', 'て': 'で', 'と': 'ど',
    'は': 'ば', 'ひ': 'び', 'ふ': 'ぶ', 'へ': 'べ', 'ほ': 'ぼ',
}
HANDAKUTEN = {'は': 'ぱ', 'ひ': 'ぴ', 'ふ': 'ぷ', 'へ': 'ぺ', 'ほ': 'ぽ'}
# Gemination (sokuon): a trailing く/つ/ち/き becomes っ before another element
# (がく + こう -> がっこう).
SOKUON_FINALS = 'くつちき'


def is_kanji(ch):
    return '一' <= ch <= '鿿'


def kata_to_hira(text):
    """Convert katakana to hiragana (Unicode block offset, -0x60), leaving
    everything else — including the prolonged-sound mark ー, which has no
    hiragana equivalent — unchanged. KANJIDIC always writes on'yomi in
    katakana, but the words that use them (JMdict) are usually spelled in
    hiragana, so reading-to-word matching needs both forms compared."""
    return ''.join(
        chr(ord(ch) - 0x60) if 'ァ' <= ch <= 'ヶ' else ch
        for ch in text
    )


def reading_parts(raw):
    """Split a KANJIDIC reading into (stem, okurigana), both hiragana.

    Kun'yomi mark the okurigana boundary with '.', e.g. い.きる -> (い, きる),
    and mark bound forms with a leading/trailing '-', which carries no sound.
    On'yomi have no okurigana, so the whole reading is the stem.
    """
    base = raw.replace('-', '')
    if '.' in base:
        stem, okuri = base.split('.', 1)
    else:
        stem, okuri = base, ''
    return kata_to_hira(stem), kata_to_hira(okuri)


def stem_variants(stem):
    """Every phonetic form a stem can take inside a compound."""
    if not stem:
        return set()
    out = {stem}
    first, rest = stem[0], stem[1:]
    for table in (RENDAKU, HANDAKUTEN):
        if first in table:
            out.add(table[first] + rest)
    if len(stem) > 1 and stem[-1] in SOKUON_FINALS:
        for form in list(out):
            out.add(form[:-1] + 'っ')
    return out


def parse_kanjidic():
    """Return {kanji: {'on': [...], 'kun': [...], 'meanings': [...],
    'grade': n|None, 'freq': n|None}} for EVERY kanji in KANJIDIC.

    Every kanji is parsed, not just the graded ones, because word alignment
    needs the readings of whatever else happens to appear in an example word
    (上海 needs 海's readings even when only grade 1 is being built).

    `freq` is KANJIDIC's newspaper-corpus frequency rank (1 = most common),
    present for roughly the top 2,500 kanji — used only to order grade 8
    (secondary jōyō) into sub-units, since KANJIDIC's own grade field puts
    all 1,110 of them in one undifferentiated bucket. See split_grade_8().
    """
    text = KANJIDIC.read_text(encoding="utf-8")
    out = {}
    for block in re.findall(r"<character>.*?</character>", text, re.S):
        literal = re.search(r"<literal>(.*?)</literal>", block).group(1)
        grade_m = re.search(r"<grade>(\d+)</grade>", block)
        freq_m = re.search(r"<freq>(\d+)</freq>", block)
        meanings = [
            html.unescape(m) for m in
            re.findall(r'<meaning>(?!<)(.*?)</meaning>', block)
            # <meaning> with an m_lang attribute is a non-English gloss; the
            # bare tag is English.
        ]
        out[literal] = {
            "on": re.findall(r'<reading r_type="ja_on">(.*?)</reading>', block),
            "kun": re.findall(r'<reading r_type="ja_kun">(.*?)</reading>', block),
            "meanings": [m for m in meanings if not RADICAL_MEANING.search(m)][:4],
            "grade": int(grade_m.group(1)) if grade_m else None,
            "freq": int(freq_m.group(1)) if freq_m else None,
        }
    return out


def build_stem_index(kanjidic):
    """{kanji: set of every stem variant it can contribute to a word}."""
    index = {}
    for kanji, info in kanjidic.items():
        stems = set()
        for raw in info["on"] + info["kun"]:
            stem, _ = reading_parts(raw)
            stems |= stem_variants(stem)
        index[kanji] = stems
    return index


def align_word(keb, reb_hira, stem_index, wildcards=1):
    """Work out which part of a word's reading each kanji contributes.

    Returns a list of (index_in_keb, segment) for the kanji positions, or None
    if the word cannot be aligned. Kana in the written form must match the
    reading literally, which is what anchors the whole thing.

    `wildcards` allows that many kanji to absorb an arbitrary span, so a word
    using a reading KANJIDIC doesn't list still aligns — 上海 (しゃんはい) needs
    it, since はい is not among 海's listed readings. Without this the exact
    rare-reading case the feature exists for would be dropped.
    """
    n, m = len(keb), len(reb_hira)
    found = None

    def rec(i, j, wild_left, acc):
        nonlocal found
        if found is not None:
            return
        if i == n:
            if j == m:
                found = list(acc)
            return
        ch = keb[i]
        if not is_kanji(ch):
            if j < m and reb_hira[j] == kata_to_hira(ch):
                rec(i + 1, j + 1, wild_left, acc)
            return
        # Longest candidate first, so じゅう wins over じ for 十 in 十二.
        for stem in sorted(stem_index.get(ch, ()), key=len, reverse=True):
            if stem and reb_hira.startswith(stem, j):
                acc.append((i, stem))
                rec(i + 1, j + len(stem), wild_left, acc)
                acc.pop()
                if found is not None:
                    return
        if wild_left > 0:
            for length in range(1, m - j + 1):
                acc.append((i, reb_hira[j:j + length]))
                rec(i + 1, j + length, wild_left - 1, acc)
                acc.pop()
                if found is not None:
                    return

    rec(0, 0, wildcards, [])
    return found


def credited_reading(kanji_info, segment, keb, pos):
    """Which of a kanji's own readings the aligned `segment` represents.

    Returns the display form (on'yomi stay katakana, kun'yomi are stripped of
    their okurigana dot) or None if the segment isn't one of this kanji's
    readings at all. Longest match wins, so 二つ credits ふた.つ (ふたつ) rather
    than the bare ふた that is also a prefix of it.
    """
    best = None
    best_len = -1
    candidates = (
        [(raw, raw, False) for raw in kanji_info["on"]]
        + [(raw, raw.replace('-', '').replace('.', ''), True) for raw in kanji_info["kun"]]
    )
    for raw, display, _is_kun in candidates:
        stem, okuri = reading_parts(raw)
        if not stem or segment not in stem_variants(stem):
            continue
        # Okurigana must actually follow the kanji in the written word.
        if okuri and keb[pos + 1:pos + 1 + len(okuri)] != okuri:
            continue
        total = len(stem) + len(okuri)
        if total > best_len:
            best, best_len = display, total
    return best


NF_BAND = re.compile(r"\bnf(\d\d)\b")
TIER_1 = re.compile(r"\b(?:news1|ichi1|spec1|gai1)\b")
TIER_2 = re.compile(r"\b(?:news2|ichi2|spec2|gai2)\b")


def priority_rank(entry):
    """Lower ranks first — how choose_examples() below picks the most
    familiar word, not just the one with the shortest reading.

    `nf##` is JMdict's finest signal: present on roughly the top 24,000 words
    by newspaper-corpus frequency, in bands of 500 (nf01 = top 500). Failing
    that, fall back to the coarser priority-list tags, "1" tier (top half of
    each list) ranked ahead of "2" tier, which is what that suffix means for
    every one of news/ichi/spec/gai. Some priority tag is guaranteed on any
    entry reaching this function — parse_jmdict_words already filtered to
    entries carrying at least one — so the final fallback never actually
    fires; it exists only so this can't crash on a tag shape it doesn't know.
    """
    m = NF_BAND.search(entry)
    if m:
        return int(m.group(1))
    if TIER_1.search(entry):
        return 60
    if TIER_2.search(entry):
        return 80
    return 99


def parse_jmdict_words(known_kanji, kanjidic, stem_index, require_priority=True, targets=None):
    """One pass over JMdict, returning two indexes keyed by kanji character:

    - `general`: common words using ONLY characters in `known_kanji` (plus
      kana), capped at MAX_KANJI_PER_WORD kanji — the grade-appropriate pool
      the kanji-level "example word" panel is drawn from.
    - `by_reading`: {kanji: {reading_display: [(keb, reb, gloss, priority), ...]}} —
      words credited to one specific reading via align_word, with no grade
      restriction on the *other* kanji in the word, since a rare reading's
      only common word may pull in a kanji the learner hasn't met (上海 for
      上's シャン needs 海, grade 2). The word is a memory aid for that one
      reading, not something they're expected to fully read yet.

    `targets`, if given, is used instead of `known_kanji` to decide which
    words are worth aligning at all — `known_kanji` still gates what a
    *found* kanji is allowed to credit. `require_priority=False` drops the
    common-word-only gate entirely. Together these two let main() run a
    second, much narrower pass over JMdict for the handful of kanji that
    came up with no quizzable reading on the first (common-only) pass —
    see UNCOMMON_READING_FALLBACK below. Restricting `targets` to that small
    set keeps the narrow pass cheap even with the gate dropped, since the
    (kanji_in_word & targets) check below still throws out the vast
    majority of JMdict before align_word ever runs.
    """
    text = JMDICT.read_text(encoding="utf-8")
    entries = re.findall(r"<entry>.*?</entry>", text, re.S)

    kana_pattern = re.compile(r"[぀-ゟ゠-ヿー]+")
    kanji_pattern = re.compile(r"[一-鿿]")
    targets = known_kanji if targets is None else targets

    general = {k: [] for k in known_kanji}
    by_reading = {k: {} for k in known_kanji}
    aligned = unaligned = 0

    for entry in entries:
        k_ele = re.search(r"<k_ele>.*?<keb>(.*?)</keb>.*?</k_ele>", entry, re.S)
        if not k_ele:
            continue
        keb = html.unescape(k_ele.group(1))
        kanji_in_word = set(kanji_pattern.findall(keb))
        relevant = kanji_in_word & targets
        if not relevant or len(kanji_in_word) > MAX_KANJI_PER_READING_WORD:
            continue
        # Common-ness: JMdict marks frequent entries with a priority tag
        # (news1/ichi1/spec1/spec2/gai1/nfNN) inside <ke_pri>/<re_pri>.
        if require_priority and "<ke_pri>" not in entry and "<re_pri>" not in entry:
            continue
        r_ele = re.search(r"<r_ele>.*?<reb>(.*?)</reb>.*?</r_ele>", entry, re.S)
        if not r_ele:
            continue
        reb = html.unescape(r_ele.group(1))
        if not kana_pattern.fullmatch(reb):
            continue  # skip readings that are themselves partly kanji
        glosses = re.findall(r"<gloss(?:\s[^>]*)?>(.*?)</gloss>", entry, re.S)
        if not glosses:
            continue
        gloss = html.unescape(glosses[0])
        record = (keb, reb, gloss, priority_rank(entry))

        for k in relevant:
            if kanji_in_word.issubset(known_kanji) and len(kanji_in_word) <= MAX_KANJI_PER_WORD:
                general[k].append(record)

        alignment = align_word(keb, kata_to_hira(reb), stem_index)
        if alignment is None:
            unaligned += 1
            continue
        aligned += 1
        for pos, segment in alignment:
            kanji = keb[pos]
            if kanji not in known_kanji:
                continue
            reading = credited_reading(kanjidic[kanji], segment, keb, pos)
            if reading:
                by_reading[kanji].setdefault(reading, []).append(record)

    print(f"jmdict: aligned {aligned} words, {unaligned} could not be aligned")
    return general, by_reading


def choose_examples(words, limit):
    # Most familiar first, by JMdict's own corpus-frequency signal (see
    # priority_rank) — お父さん is a far more useful first example for 父 than
    # 義父 (father-in-law), even though 義父's reading is shorter. Reading
    # length only breaks a tie among equally common candidates.
    return sorted(words, key=lambda w: (w[3], len(w[1])))[:limit]


def split_grade_8(kanjidic):
    """Secondary jōyō (KANJIDIC grade 8) is 1,110 kanji in one undifferentiated
    bucket — far too many for one teaching unit or one lazy-loaded chunk (see
    kanji-expansion-plan.md §8). Splits it into GRADE_8_SUB_UNITS "8-1".."8-N"
    sub-units by KANJIDIC's own newspaper-frequency rank (most common first;
    kanji with no rank at all sort last, tie-broken by codepoint for
    determinism), each roughly equal in size.

    Returns (unit_of: {kanji: "8-N"}, ordered: [kanji, ...] in the same
    frequency order the split was made from) — `ordered` is also each
    sub-unit's internal teaching order, most useful characters first, same as
    every other unit's order is meaningful (grade 1 opens with 一 not some
    arbitrary kanji).
    """
    grade8 = [k for k, v in kanjidic.items() if v["grade"] == 8]
    ordered = sorted(grade8, key=lambda k: (kanjidic[k]["freq"] or 10 ** 9, k))
    size = -(-len(ordered) // GRADE_8_SUB_UNITS)  # ceil division
    unit_of = {kanji: f"8-{i // size + 1}" for i, kanji in enumerate(ordered)}
    return unit_of, ordered


def main():
    if not KANJIDIC.exists() or not JMDICT.exists():
        raise SystemExit(
            f"Missing source data. Run tools/fetch_kanji_sources.sh first "
            f"(expects {KANJIDIC} and {JMDICT})."
        )

    kanjidic = parse_kanjidic()

    # See UNICODE_VARIANT_SUBSTITUTIONS above. Both entries stay in
    # `kanjidic` either way — the rare one is still needed for word
    # alignment on the off chance some OTHER word's keb uses it as a
    # non-target character — only which one is jōyō (and therefore taught)
    # moves.
    for rare, common in UNICODE_VARIANT_SUBSTITUTIONS.items():
        if rare in kanjidic and common in kanjidic:
            kanjidic[common]["grade"] = kanjidic[rare]["grade"]
            kanjidic[rare]["grade"] = None

    stem_index = build_stem_index(kanjidic)
    graded = {k: v for k, v in kanjidic.items() if v["grade"] in GRADES}
    print(f"kanjidic2: {len(graded)} kanji across grades {GRADES} "
          f"({len(kanjidic)} total parsed for word alignment)")

    grade8_unit, grade8_order = split_grade_8(kanjidic)

    def unit_of(kanji, info):
        return grade8_unit[kanji] if info["grade"] == 8 else str(info["grade"])

    # Elementary grades keep their existing (grade, codepoint) order —
    # unchanged from before grade 8 existed. Grade 8 follows in frequency
    # order (see split_grade_8) rather than being re-sorted alphabetically,
    # so each of its sub-units stays internally ordered most-common-first.
    elementary_order = sorted(
        (k for k, v in graded.items() if v["grade"] != 8),
        key=lambda k: (graded[k]["grade"], k),
    )
    iteration_order = elementary_order + grade8_order

    known = set(graded)
    general_words, words_by_reading = parse_jmdict_words(known, kanjidic, stem_index)

    # Every kanji should have SOMETHING to quiz — a reading nobody can ever
    # be asked about is worse than a reading whose only example is obscure.
    # Find whichever kanji came up with no common-word-backed reading at all
    # on the pass above, then run one more, much narrower pass over JMdict
    # for just those, with the common-word gate dropped — see
    # parse_jmdict_words's require_priority/targets. This is a strict
    # superset of the substitutions above: fixing those first shrinks this
    # set by removing the four kanji that only looked readingless because
    # they were taught under the wrong code point.
    def display(raw):
        return raw.replace('-', '').replace('.', '')

    needs_uncommon = {
        kanji for kanji, info in graded.items()
        if not any(display(r) in words_by_reading.get(kanji, {}) for r in info["on"] + info["kun"])
    }
    if needs_uncommon:
        _, uncommon_by_reading = parse_jmdict_words(
            known, kanjidic, stem_index, require_priority=False, targets=needs_uncommon)
        for kanji, readings in uncommon_by_reading.items():
            words_by_reading.setdefault(kanji, {}).update(readings)
        print(f"uncommon-word fallback used for {len(needs_uncommon)} kanji: "
              f"{''.join(sorted(needs_uncommon))}")

    grades = {}
    dropped_readings = 0
    kept_readings = 0
    no_quiz_readings = []
    for kanji in iteration_order:
        info = graded[kanji]
        reading_words = words_by_reading.get(kanji, {})

        # Only readings that actually show up in a common word are quizzed —
        # a reading with no word to anchor it is not worth a child's time, and
        # has no example to offer when tapped.
        def keep(raw_list):
            kept = []
            for raw in raw_list:
                display = raw.replace('-', '').replace('.', '')
                if display in reading_words and display not in kept:
                    kept.append(display)
            return kept

        quiz_on = keep(info["on"])
        quiz_kun = keep(info["kun"])
        quiz_readings = (quiz_on + quiz_kun)[:MAX_QUIZ_READINGS]
        quiz_on = [r for r in quiz_on if r in quiz_readings]
        quiz_kun = [r for r in quiz_kun if r in quiz_readings]

        all_display = {r.replace('-', '').replace('.', '') for r in info["on"] + info["kun"]}
        dropped_readings += len(all_display) - len(set(quiz_on) | set(quiz_kun))
        kept_readings += len(quiz_readings)
        if not quiz_readings:
            no_quiz_readings.append(kanji)

        reading_examples = {}
        for reading in quiz_readings:
            best = choose_examples(reading_words[reading], 1)[0]
            reading_examples[reading] = {"kanji": best[0], "kana": best[1], "en": best[2]}

        examples = choose_examples(general_words.get(kanji, []), EXAMPLES_PER_KANJI)
        grades.setdefault(unit_of(kanji, info), []).append({
            "kanji": kanji,
            "on": info["on"],
            "kun": info["kun"],
            "meanings": info["meanings"],
            "words": [{"kanji": k, "kana": r, "en": g} for k, r, g, _pri in examples],
            "quizOn": quiz_on,
            "quizKun": quiz_kun,
            "quizReadings": quiz_readings,
            "readingExamples": reading_examples,
        })

    for grade, entries in sorted(grades.items()):
        total_examples = sum(len(e["words"]) for e in entries)
        print(f"grade {grade}: {len(entries)} kanji, {total_examples} example words")
    print(f"quiz readings: {kept_readings} kept (all with an example word), "
          f"{dropped_readings} dropped for having no common word")
    if no_quiz_readings:
        print(f"  {len(no_quiz_readings)} kanji have NO quizzable reading: "
              f"{''.join(no_quiz_readings)}")
    no_meaning = [e["kanji"] for g in grades.values() for e in g if not e["meanings"]]
    if no_meaning:
        print(f"  {len(no_meaning)} kanji have no non-radical meaning: {''.join(no_meaning)}")

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    header = [
        "// Generated by tools/build_kanji_data.py — do not hand-edit.",
        "// Source: KANJIDIC2 and JMdict (c) EDRDG, CC BY-SA 4.0.",
        "// https://www.edrdg.org/wiki/index.php/KANJIDIC_Project",
        "",
    ]

    manifest_units = {}
    no_yomi_chars = []
    for grade in sorted(grades, key=str):
        entries = grades[grade]
        unit = str(grade)
        manifest_units[unit] = [e["kanji"] for e in entries]
        no_yomi_chars.extend(e["kanji"] for e in entries if not e["quizReadings"])

        out_path = DATA_DIR / f"kanji-grade-{unit}.js"
        js = header + [
            "export const KANJI_ENTRIES = " + json.dumps(entries, ensure_ascii=False, indent=2) + ";",
            "",
        ]
        out_path.write_text("\n".join(js), encoding="utf-8")
        print(f"wrote {out_path} ({out_path.stat().st_size} bytes)")

    manifest_path = DATA_DIR / "kanji-manifest.js"
    manifest_js = header + [
        "// KANJI_UNITS: ordered character list per teaching unit — enough to\n"
        "// build the course skeleton (ids, chunks, overview tiles) with no\n"
        "// network wait. The full per-kanji data (readings, meanings, example\n"
        "// words) lives in the matching kanji-grade-<unit>.js, loaded lazily.",
        "export const KANJI_UNITS = " + json.dumps(manifest_units, ensure_ascii=False, indent=2) + ";",
        "",
        "// Every kanji with no quizzable reading at all (see excludeForMode in\n"
        "// src/kanji.js) — kept in the manifest, not the per-unit chunk, since\n"
        "// srs.js consults this during scheduling, before a unit may have ever\n"
        "// been opened.",
        "export const NO_YOMI_CHARS = " + json.dumps(sorted(set(no_yomi_chars)), ensure_ascii=False) + ";",
        "",
    ]
    manifest_path.write_text("\n".join(manifest_js), encoding="utf-8")
    print(f"wrote {manifest_path} ({manifest_path.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
