"""Build src/kanji-data.js from KANJIDIC2 and JMdict.

Extracts kanji for the given school grades with their on'yomi/kun'yomi
readings, English meanings, and example words.

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
OUT = ROOT / "src" / "kanji-data.js"

MAX_GRADE = 6           # grades 1-6: the full elementary-school (Kyoiku) kanji set
EXAMPLES_PER_KANJI = 4
MAX_KANJI_PER_WORD = 2      # cap for the general example-word list (grade-appropriate only)
MAX_KANJI_PER_READING_WORD = 3  # looser cap for reading-anchored lookups (see below)
MAX_QUIZ_READINGS = 6   # must match MAX_CORRECT_READINGS in kanji.js

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
    'grade': n|None}} for EVERY kanji in KANJIDIC.

    Every kanji is parsed, not just the graded ones, because word alignment
    needs the readings of whatever else happens to appear in an example word
    (上海 needs 海's readings even when only grade 1 is being built).
    """
    text = KANJIDIC.read_text(encoding="utf-8")
    out = {}
    for block in re.findall(r"<character>.*?</character>", text, re.S):
        literal = re.search(r"<literal>(.*?)</literal>", block).group(1)
        grade_m = re.search(r"<grade>(\d+)</grade>", block)
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


def parse_jmdict_words(known_kanji, kanjidic, stem_index):
    """One pass over JMdict, returning two indexes keyed by kanji character:

    - `general`: common words using ONLY characters in `known_kanji` (plus
      kana), capped at MAX_KANJI_PER_WORD kanji — the grade-appropriate pool
      the kanji-level "example word" panel is drawn from.
    - `by_reading`: {kanji: {reading_display: [(keb, reb, gloss), ...]}} —
      words credited to one specific reading via align_word, with no grade
      restriction on the *other* kanji in the word, since a rare reading's
      only common word may pull in a kanji the learner hasn't met (上海 for
      上's シャン needs 海, grade 2). The word is a memory aid for that one
      reading, not something they're expected to fully read yet.
    """
    text = JMDICT.read_text(encoding="utf-8")
    entries = re.findall(r"<entry>.*?</entry>", text, re.S)

    kana_pattern = re.compile(r"[぀-ゟ゠-ヿー]+")
    kanji_pattern = re.compile(r"[一-鿿]")

    general = {k: [] for k in known_kanji}
    by_reading = {k: {} for k in known_kanji}
    aligned = unaligned = 0

    for entry in entries:
        k_ele = re.search(r"<k_ele>.*?<keb>(.*?)</keb>.*?</k_ele>", entry, re.S)
        if not k_ele:
            continue
        keb = html.unescape(k_ele.group(1))
        kanji_in_word = set(kanji_pattern.findall(keb))
        relevant = kanji_in_word & known_kanji
        if not relevant or len(kanji_in_word) > MAX_KANJI_PER_READING_WORD:
            continue
        # Common-ness: JMdict marks frequent entries with a priority tag
        # (news1/ichi1/spec1/spec2/gai1/nfNN) inside <ke_pri>/<re_pri>.
        if "<ke_pri>" not in entry and "<re_pri>" not in entry:
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
        record = (keb, reb, gloss)

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
    # Shortest reading first: for a beginner, "いち" beats "いちばん".
    return sorted(words, key=lambda w: len(w[1]))[:limit]


def main():
    if not KANJIDIC.exists() or not JMDICT.exists():
        raise SystemExit(
            f"Missing source data. Run tools/fetch_kanji_sources.sh first "
            f"(expects {KANJIDIC} and {JMDICT})."
        )

    kanjidic = parse_kanjidic()
    stem_index = build_stem_index(kanjidic)
    graded = {k: v for k, v in kanjidic.items() if v["grade"] and v["grade"] <= MAX_GRADE}
    print(f"kanjidic2: {len(graded)} kanji at grade <= {MAX_GRADE} "
          f"({len(kanjidic)} total parsed for word alignment)")

    known = set(graded)
    general_words, words_by_reading = parse_jmdict_words(known, kanjidic, stem_index)

    grades = {}
    dropped_readings = 0
    kept_readings = 0
    no_quiz_readings = []
    for kanji, info in sorted(graded.items(), key=lambda kv: (kv[1]["grade"], kv[0])):
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
        grades.setdefault(info["grade"], []).append({
            "kanji": kanji,
            "on": info["on"],
            "kun": info["kun"],
            "meanings": info["meanings"],
            "words": [{"kanji": k, "kana": r, "en": g} for k, r, g in examples],
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

    js = [
        "// Generated by tools/build_kanji_data.py — do not hand-edit.",
        "// Source: KANJIDIC2 and JMdict (c) EDRDG, CC BY-SA 4.0.",
        "// https://www.edrdg.org/wiki/index.php/KANJIDIC_Project",
        "",
        "export const KANJI_BY_GRADE = " + json.dumps(grades, ensure_ascii=False, indent=2) + ";",
        "",
    ]
    OUT.write_text("\n".join(js), encoding="utf-8")
    print(f"wrote {OUT} ({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
