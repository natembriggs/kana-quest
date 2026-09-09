"""Build src/data/kanji-grade-*.js and src/data/kanji-manifest.js from
KANJIDIC2 and JMdict.

Extracts kanji for the given school grades, plus a "beyond jōyō" names &
places set (jinmeiyō and other common non-jōyō kanji, see
select_beyond_joyo), with their on'yomi/kun'yomi readings, English meanings,
and example words. Writes one data file PER UNIT (`KANJI_ENTRIES`, the full
per-kanji data) plus one small always-loaded manifest (`KANJI_UNITS`, just
the ordered character list per unit, and `NO_YOMI_CHARS`, the handful of
kanji with no quizzable reading at all) — see kanji-expansion-plan.md §4/§5.
`src/kanji.js` loads a unit's `KANJI_ENTRIES` file lazily, on demand; the
manifest is small enough to load eagerly and is enough on its own to build
the app's course skeleton (ids, chunks, overview tiles) without touching the
network.

The hard part is the per-reading example index: the word shown when a learner
taps one specific reading. A naive "does the word's reading start with this
reading" test is badly wrong — 十二 (じゅうに) starts with じ, so it would be
offered as proof that 二 can be read ジ, when in fact 二 is に there and じゅう
belongs to 十. So this script actually aligns each word's kanji against its
reading, using every kanji's readings from KANJIDIC (all of them, not just
the grades being built), and only credits a word to a reading when that
reading is genuinely what the target kanji contributes.

A reading being backed by SOME word is not the same as that reading being
common — plenty of JMdict entries carry a priority tag while still being
obscure (a rare compound, a technical term) relative to the kanji's other
readings. The whole point of quizzing readings at all is to test what a
learner will actually meet, so main()'s per-kanji selection below prefers a
"genuinely common" (see is_written_common/is_spoken) reading over a merely
tagged one, only falling back to the tagged-but-not-common tier when a
category (on'yomi or kun'yomi) has no common reading to offer — see keep()
and _is_common() in main().

Source data (CC BY-SA, The Electronic Dictionary Research and Development
Group, https://www.edrdg.org/) is downloaded by fetch_kanji_sources.sh into
tools/data_src/ and is NOT committed — this script is meant to be re-run
rather than the multi-hundred-MB sources kept in git.

Usage:
    python3 tools/build_kanji_data.py
"""
import html
import json
import math
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "tools" / "data_src"
DATA_DIR = ROOT / "src" / "data"
KANJIVG_DIR = ROOT / "tools" / "data_src" / "kanjivg" / "kanji"

# KANJIDIC's own grade values to include: 1-6 (elementary/Kyoiku), 8
# (secondary jōyō — everything in the 2,136-kanji jōyō set that isn't
# elementary). Grade 7 doesn't exist in KANJIDIC's scheme. Grades 1-6 + 8 sum
# to exactly 2,136 — but count alone doesn't prove the SET is right, see
# UNICODE_VARIANT_SUBSTITUTIONS immediately below for the four places it
# wasn't, found by diffing against an independent jōyō character list.
#
# Jinmeiyō (grades 9/10) and other common non-jōyō kanji are NOT in GRADES —
# they are a separate "beyond jōyō" set, selected by select_beyond_joyo() and
# taught as its own "Names & places" unit group. See kanji-expansion-plan.md
# §5.
GRADES = (1, 2, 3, 4, 5, 6, 8)
GRADE_8_SUB_UNITS = 6   # secondary jōyō (1,110 kanji) is one KANJIDIC grade
                        # but far too big to be one teaching unit or one lazy-
                        # loaded chunk — split into this many, by frequency
                        # rank, each its own grade-picker tile. See
                        # split_grade_8() and kanji-expansion-plan.md §8.
BEYOND_SUB_UNITS = 6    # same reasoning as GRADE_8_SUB_UNITS, applied to the
                        # beyond-jōyō "names & places" set. See split_beyond().
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
TANAKA = SRC / "examples.utf"
SUBTITLE_FREQ = SRC / "ja_subtitle_freq.txt"

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
NEWS1 = re.compile(r"\bnews1\b")
CURATED = re.compile(r"\bichi[12]\b")

# Corpus word-frequency counts — nf/news from Mainichi Shimbun, and both of
# spoken_signal's sources below — are all built by machine tokenizers, which
# routinely conflate a bound stem with the words derived from it: 具体的
# ("concrete") and 具体化 ("materialization") are both genuinely common, and
# a tokenizer that splits off 的/化 as a separate morpheme credits every one
# of those occurrences to bare 具体 — a word barely used standalone. JMdict's
# `ichi1`/`ichi2` tags are different in kind: a human-compiled list of
# everyday vocabulary (the "Ichimango goi bunruishuu"), immune to this
# specific miscount because it was never derived from raw token counts. This
# penalty is applied to a word's ORDERING score only (both frequency_bands,
# in choose_examples) — its written/spoken *badges* still reflect the raw,
# possibly-inflated corpus signal, since that's a defensible fact about the
# word's own component forms even when the word itself doesn't carry it.
STEM_PENALTY = 2.5


def curated_common(entry):
    return bool(CURATED.search(entry))

ABSENT_BAND = 60  # a word missing from a frequency source sits mid-pack, not
                  # last — plenty of real, common words are missing from any
                  # one source (see load_tanaka_freq/load_subtitle_freq).


def written_band(entry):
    """Lower is more common in written/newspaper Japanese — one half of the
    two-axis score choose_examples() below sorts by (see spoken_band).

    `nf##` is JMdict's finest signal: present on roughly the top 24,000 words
    by newspaper-corpus frequency (Mainichi Shimbun), in bands of 500 (nf01 =
    top 500). Failing that, fall back to the coarser priority-list tags, "1"
    tier (top half of each list) ranked ahead of "2" tier, which is what that
    suffix means for every one of news/ichi/spec/gai. Some priority tag is
    guaranteed on any entry reaching this function — parse_jmdict_words
    already filtered to entries carrying at least one — so the final
    fallback never actually fires; it exists only so this can't crash on a
    tag shape it doesn't know.
    """
    m = NF_BAND.search(entry)
    if m:
        return int(m.group(1))
    if TIER_1.search(entry):
        return 60
    if TIER_2.search(entry):
        return 80
    return 99


def is_written_common(entry):
    """Badge shown on a word: genuinely common in newspaper/formal written
    Japanese, not just carrying SOME priority tag (ichi1/spec1/gai1 say
    nothing about register). Top half of the newspaper freq list (nf<=24,
    i.e. its top ~12,000 words) or explicitly tagged news1."""
    m = NF_BAND.search(entry)
    if m:
        return int(m.group(1)) <= 24
    return bool(NEWS1.search(entry))


def load_tanaka_freq():
    """Word -> corpus-frequency rank (1 = most common), from how often each
    word is used across the Tanaka Corpus's ~150,000 example sentences —
    translated, conversational-register sentences, unlike JMdict's own
    newspaper-derived nf/news tags. The `B:` line under each sentence gives
    every word in its dictionary (lemma) form followed by `[sense]`,
    `{actual-inflected-surface}`, or reading annotations — splitting each
    token on the first of those characters recovers the lemma even for a
    conjugated verb/adjective, so this needs no separate stemming pass."""
    counts = {}
    for line in TANAKA.read_text(encoding="utf-8").splitlines():
        if not line.startswith("B: "):
            continue
        for token in line[3:].split():
            lemma = re.split(r"[(\[{|~]", token, maxsplit=1)[0]
            if lemma:
                counts[lemma] = counts.get(lemma, 0) + 1
    ranked = sorted(counts, key=counts.get, reverse=True)
    return {word: i + 1 for i, word in enumerate(ranked)}


def load_subtitle_freq():
    """Word -> corpus-frequency rank (1 = most common), from an OpenSubtitles-
    derived Japanese word list (hermitdave/FrequencyWords, CC BY-SA 4.0) —
    real spoken/dialogue register, a signal missing from both JMdict's
    newspaper tags and the Tanaka Corpus's translated-textbook sentences.
    Already sorted by descending frequency, one `word count` pair per line."""
    ranked = []
    for line in SUBTITLE_FREQ.read_text(encoding="utf-8").splitlines():
        word = line.rsplit(" ", 1)[0] if " " in line else None
        if word:
            ranked.append(word)
    return {word: i + 1 for i, word in enumerate(ranked)}


def subtitle_lookup(word, table):
    """Exact match first; failing that, strip trailing kana one character at
    a time (up to 3) and retry. Unlike the Tanaka Corpus, this list's own
    tokenizer often splits a conjugated verb/adjective's okurigana off from
    its kanji stem (助ける -> only 助け, 助 etc. appear, not the dictionary
    form) — this recovers a match for those without over-matching kana-only
    words, since stripping stops as soon as no kanji is left in what remains.
    """
    if word in table:
        return table[word]
    stem = word
    for _ in range(3):
        if len(stem) <= 1 or is_kanji(stem[-1]):
            break
        stem = stem[:-1]
        if any(is_kanji(ch) for ch in stem) and stem in table:
            return table[stem]
    return None


def frequency_band(rank):
    return ABSENT_BAND if rank is None else min(99, math.ceil(rank / 500))


# A word only needs to be common in ONE of these to count as "spoken" — they
# cover different weaknesses (Tanaka is textbook-translated and under-covers
# casual/slang; the subtitle list's own tokenizer drops some very common
# words entirely, e.g. bare 君 attaches to whatever precedes it). Thresholds
# are each corpus's own top ~20%, past which the subtitle list in particular
# degrades into single-digit counts and character names.
SPOKEN_RANK_CUTOFF = 8000


def spoken_signal(keb, tanaka_freq, subtitle_freq):
    tanaka_rank = tanaka_freq.get(keb)
    subtitle_rank = subtitle_lookup(keb, subtitle_freq)
    band = min(frequency_band(tanaka_rank), frequency_band(subtitle_rank))
    is_spoken = (
        (tanaka_rank is not None and tanaka_rank <= SPOKEN_RANK_CUTOFF)
        or (subtitle_rank is not None and subtitle_rank <= SPOKEN_RANK_CUTOFF)
    )
    return band, is_spoken


def parse_jmdict_words(known_kanji, kanjidic, stem_index, tanaka_freq, subtitle_freq,
                        require_priority=True, targets=None):
    """One pass over JMdict, returning two indexes keyed by kanji character:

    - `general`: common words using ONLY characters in `known_kanji` (plus
      kana), capped at MAX_KANJI_PER_WORD kanji — the grade-appropriate pool
      the kanji-level "example word" panel is drawn from.
    - `by_reading`: {kanji: {reading_display: [record, ...]}} — words
      credited to one specific reading via align_word, with no grade
      restriction on the *other* kanji in the word, since a rare reading's
      only common word may pull in a kanji the learner hasn't met (上海 for
      上's シャン needs 海, grade 2). The word is a memory aid for that one
      reading, not something they're expected to fully read yet.

    Each `record` is (keb, reb, gloss, written_band, is_written, spoken_band,
    is_spoken) — see written_band/is_written_common/spoken_signal above.

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
        spoken_band, is_spoken = spoken_signal(keb, tanaka_freq, subtitle_freq)
        order_written, order_spoken = written_band(entry), spoken_band
        if not curated_common(entry):
            order_written *= STEM_PENALTY
            order_spoken *= STEM_PENALTY
        record = (keb, reb, gloss, order_written, is_written_common(entry),
                   order_spoken, is_spoken)

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


# Hand-curated exceptions to is_written_common/is_spoken (indices 4/6 of the
# record tuple — see parse_jmdict_words), for a word that clears one of
# those thresholds on paper but reads as obscure to an actual learner.
# Started from one real report (kana-quest-feedback #7, again, after
# fd6bd2b (2026-09-07) already fixed the near-identical "zero-tag" case but
# left this narrower one standing): 出納 ("receipts and expenditure", a
# bookkeeping term) is 出's ONLY candidate word for its スイ reading, and
# carries nf24 + news1 + ichi1 — genuinely tagged as common by JMdict's own
# scheme, on the strength of appearing in financial/newspaper writing and an
# old core-vocabulary list, not because a learner would recognise it. Tried
# and rejected: tightening the shared written-frequency threshold instead
# (nf<=24 -> nf<=12) — regenerating with that change dropped several
# genuinely basic words right alongside it (七つ "seven", よん as a reading
# of 四, 八百屋 "greengrocer", 九九 "multiplication table", 小雨 "light
# rain" all score in the SAME newspaper-frequency band as 出納, because
# newspapers underrepresent exactly the everyday/children's vocabulary this
# app teaches) — so there is no clean numeric axis that separates this case
# from those. A short, deliberately curated list, extended by hand as real
# reports come in, is the safe fix; the same shape of exception as
# `vocab-plan.md`'s CORE_ENTRIES/A12_ENTRIES for "automated ranking finds
# the wrong answer as often as the right one for a set this idiomatic."
OBSCURE_WORD_OVERRIDE = {
    "出納",  # すいとう — receipts and expenditure; 出's only スイ candidate
    "建立",  # こんりゅう — erecting (a temple); 立's only リュウ candidate.
             # Same shape as 出納: nf23 + news1 on the strength of newspaper
             # coverage of temples, and it sits at Tanaka rank 11,296 /
             # subtitle rank 17,391, well past SPOKEN_RANK_CUTOFF. 立 has
             # 40-odd リツ words carrying BOTH badges (独立, 成立, 国立...),
             # so nothing is lost by dropping リュウ.
}


def _word_is_common(record):
    """One word clears the "genuinely common" bar: written-common or
    spoken-common (indices 4/6 of the record tuple — see parse_jmdict_words),
    and not hand-flagged as obscure. The single definition of "common" for a
    word, shared by the reading gate (_is_common) and example ORDERING
    (choose_examples) — those two used to disagree, which is what let a
    reading be kept on the strength of word X and then illustrated with a
    less common word Y that showed no register badge in the app."""
    return (record[4] or record[6]) and record[0] not in OBSCURE_WORD_OVERRIDE


def _is_common(candidates):
    """A reading's candidate word list clears the bar if ANY of its words
    does — one strong word is enough to anchor a reading, even if the rest
    of its matches are obscure."""
    return any(_word_is_common(c) for c in candidates)


def choose_examples(words, limit, prefer_common=False):
    # Most familiar first, blending written commonness (written_band, from
    # JMdict's newspaper-corpus nf/news tags) with spoken commonness
    # (spoken_band, from the Tanaka Corpus and an OpenSubtitles-derived word
    # list — see spoken_signal). The geometric mean rewards a word for
    # scoring well on BOTH axes and punishes one that's lopsided — 具体
    # ("concreteness") is a strong nf03 in newspapers but never used as a
    # freestanding word in speech, so it used to rank above 具合 ("condition")
    # and 道具 ("tool"), both everyday spoken words with a weaker newspaper
    # presence. A plain average would let 具体's newspaper strength paper
    # over its near-total absence from speech; sqrt(a*b) does not. Reading
    # length only breaks a tie among equally common candidates.
    #
    # `prefer_common` puts _word_is_common ahead of the bands, for the ONE
    # caller that needs the two to agree: a reading is kept because some word
    # clears that boolean (_is_common), so the example illustrating it must
    # clear it too. The bands are continuous and the badge is a threshold on
    # a partly different signal, so they could disagree — for 65 readings the
    # band score picked a badge-less word (風下 for 下's しも) over a badge-
    # carrying sibling (下期) from the very same list, and the learner saw an
    # example the app itself would not call common.
    #
    # Off by default, because the per-kanji "Common words" list answers to no
    # such gate and the bands rank it better: forcing the boolean first there
    # promoted 冬場 over 冬休み and 替え玉 over 玉ねぎ — technically better
    # newspaper scores, worse words to meet 冬 and 玉 through.
    def key(w):
        rank = (math.sqrt(w[3] * w[5]), len(w[1]))
        return (0 if _word_is_common(w) else 1, *rank) if prefer_common else rank
    return sorted(words, key=key)[:limit]


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


def has_stroke_data(kanji):
    return (KANJIVG_DIR / f"{ord(kanji):05x}.svg").exists()


def select_beyond_joyo(kanjidic):
    """Candidate characters for "beyond jōyō": kanji worth knowing that
    aren't in the 2,136-character jōyō set taught above. Two KANJIDIC
    signals, unioned (kanji-expansion-plan.md §5):

    - **Jinmeiyō** (grades 9-10) — the official supplementary set legally
      permitted in personal names. The dominant contributor (~860 kanji).
    - **Non-jōyō kanji with a `<freq>` newspaper-frequency rank** — no grade
      tag at all, but common enough (top ~2,500) to be worth knowing, e.g.
      prefecture-name components that never made either jōyō list.

    Returns the RAW candidate set — see has_stroke_data filtering in main(),
    which is what actually decides which of these get taught.
    """
    return {
        k for k, v in kanjidic.items()
        if v["grade"] in (9, 10) or (v["grade"] is None and v["freq"] is not None)
    }


def split_beyond(kanjidic, beyond):
    """Splits the beyond-jōyō set into BEYOND_SUB_UNITS "9-1".."9-N"
    sub-units — same scheme as split_grade_8: most common (lowest freq rank)
    first, kanji with no freq rank at all last, tie-broken by codepoint for
    determinism. Returns (unit_of, ordered), same shape as split_grade_8."""
    ordered = sorted(beyond, key=lambda k: (kanjidic[k]["freq"] or 10 ** 9, k))
    size = -(-len(ordered) // BEYOND_SUB_UNITS)  # ceil division
    unit_of = {kanji: f"9-{i // size + 1}" for i, kanji in enumerate(ordered)}
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

    # See select_beyond_joyo's docstring for the two signals unioned into the
    # candidate set. Requiring KanjiVG stroke data (has_stroke_data) is what
    # actually cuts it down to a teachable set — every candidate this drops
    # turns out to be a legacy/CJK-compatibility duplicate codepoint of a
    # kanji already taught elsewhere, which KanjiVG (correctly) never drew a
    # second diagram for.
    beyond_candidates = select_beyond_joyo(kanjidic)
    beyond = {k for k in beyond_candidates if has_stroke_data(k)}
    print(f"beyond jōyō (names & places): {len(beyond)} of {len(beyond_candidates)} "
          f"candidates have KanjiVG stroke data; "
          f"{len(beyond_candidates) - len(beyond)} dropped as un-drawable "
          f"duplicate codepoints")
    beyond_unit, beyond_order = split_beyond(kanjidic, beyond)

    # graded now covers everything taught: the 2,136-kanji jōyō set plus the
    # beyond-jōyō "names & places" set. Every downstream use of `graded`
    # (word alignment's `known` set, the main per-kanji loop, the
    # no-quiz-reading fallback pass) is written generically enough that this
    # single update is all that's needed to bring beyond-jōyō kanji along.
    graded.update({k: kanjidic[k] for k in beyond})

    def unit_of(kanji, info):
        if kanji in beyond_unit:
            return beyond_unit[kanji]
        return grade8_unit[kanji] if info["grade"] == 8 else str(info["grade"])

    # Elementary grades keep their existing (grade, codepoint) order —
    # unchanged from before grade 8 existed. Grade 8 follows in frequency
    # order (see split_grade_8) rather than being re-sorted alphabetically,
    # so each of its sub-units stays internally ordered most-common-first.
    # Beyond-jōyō kanji are excluded here (their own `info["grade"]` is None
    # or 9/10, which would break the (grade, codepoint) sort key) and instead
    # follow in their own frequency order, same reasoning as grade 8.
    elementary_order = sorted(
        (k for k, v in graded.items() if v["grade"] != 8 and k not in beyond),
        key=lambda k: (graded[k]["grade"], k),
    )
    iteration_order = elementary_order + grade8_order + beyond_order

    known = set(graded)
    print("Loading Tanaka Corpus and subtitle word-frequency data...")
    tanaka_freq = load_tanaka_freq()
    subtitle_freq = load_subtitle_freq()
    general_words, words_by_reading = parse_jmdict_words(
        known, kanjidic, stem_index, tanaka_freq, subtitle_freq)

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
            known, kanjidic, stem_index, tanaka_freq, subtitle_freq,
            require_priority=False, targets=needs_uncommon)
        # parse_jmdict_words's `relevant` gate is "ANY target kanji in the
        # word", not "every kanji is a target" — a word like 一葉楓 (found
        # because 楓 ∈ needs_uncommon) also credits 一 and 葉's OWN readings
        # as a side effect of alignment, even though neither needed this
        # fallback pass at all. Restricting the merge to kanji actually IN
        # needs_uncommon is what keeps this fallback from overwriting an
        # already-good, common-word-backed reading on a collateral kanji
        # with this pass's priority-gate-dropped (i.e. worse) pick. Safe to
        # unconditionally .update() for a kanji that IS in needs_uncommon,
        # since by definition every one of its own readings had zero
        # backing beforehand — there's nothing there to clobber.
        for kanji, readings in uncommon_by_reading.items():
            if kanji not in needs_uncommon:
                continue
            words_by_reading.setdefault(kanji, {}).update(readings)
        print(f"uncommon-word fallback used for {len(needs_uncommon)} kanji: "
              f"{''.join(sorted(needs_uncommon))}")

    grades = {}
    dropped_readings = 0
    kept_readings = 0
    strong_kept_readings = 0
    weak_kept_readings = 0
    fallback_kept_readings = 0
    uncommon_kept_readings = 0
    kanji_with_uncommon = 0
    no_quiz_readings = []
    for kanji in iteration_order:
        info = graded[kanji]
        reading_words = words_by_reading.get(kanji, {})

        # A reading is quizzed only if it shows up in SOME word (a reading
        # with no example to offer when tapped is not worth a child's time at
        # all), but "some word" is a low bar — plenty of tagged JMdict entries
        # are themselves obscure. So each category (on'yomi, kun'yomi) is
        # judged on its own: if it has any genuinely common reading (see
        # _is_common), only those are kept and the merely-tagged ones in that
        # same category are dropped; a category with NO common reading falls
        # back to keeping its tagged ones rather than offering nothing. This
        # runs on whatever `reading_words` holds, so for a kanji that went
        # through the needs_uncommon fallback above, every candidate is
        # already from that priority-gate-dropped pass — there is no common
        # tier to prefer, and everything found is kept as a last resort.
        def keep(raw_list):
            strong, weak, seen = [], [], set()
            for raw in raw_list:
                display = raw.replace('-', '').replace('.', '')
                if display not in reading_words or display in seen:
                    continue
                seen.add(display)
                bucket = strong if _is_common(reading_words[display]) else weak
                bucket.append(display)
            # weak is only ever a real "leftover" when strong exists to prefer
            # it over — see uncommon_readings below. When strong is empty, weak
            # IS the kept tier (the last-resort fallback), so there is nothing
            # left over from this category alone.
            return (strong, weak, True) if strong else (weak, [], False)

        quiz_on, extra_on, on_is_strong = keep(info["on"])
        quiz_kun, extra_kun, kun_is_strong = keep(info["kun"])

        # keep() judges each category alone, which leaves a kanji quizzing a
        # reading the build itself scored as uncommon while a genuinely
        # common one sits right next to it: every one of 玉's ギョク words
        # (玉砕, 玉露, 珠玉, 玉音) fails both commonness axes, yet ギョク was
        # kept as the on'yomi category's weak-tier fallback even though たま
        # has 玉 and 目玉 with both badges. When one category IS strong, the
        # other's weak-tier fallback has stopped being a fallback — there is
        # something worth asking about — so drop it from the quizzed pool.
        # Only fires when a strong category exists, so no kanji is ever left
        # with nothing to quiz, and never for a needs_uncommon kanji (both
        # categories weak there). The dropped category is not thrown away
        # entirely though — kanji-expansion-plan.md's "uncommon yomi" work —
        # it survives as `uncommon_readings` below, same as any other
        # weak-tier reading, just no longer tested by default.
        if on_is_strong and not kun_is_strong:
            extra_kun = extra_kun + quiz_kun
            quiz_kun = []
        elif kun_is_strong and not on_is_strong:
            extra_on = extra_on + quiz_on
            quiz_on = []

        combined = quiz_on + quiz_kun
        quiz_readings = combined[:MAX_QUIZ_READINGS]
        # MAX_QUIZ_READINGS trims a small number of kanji with more than 6
        # genuinely-common readings — the trimmed tail is still common, just
        # not tested for lack of room, so it goes to uncommon_readings too
        # rather than disappearing outright.
        overflow = combined[MAX_QUIZ_READINGS:]
        quiz_on = [r for r in quiz_on if r in quiz_readings]
        quiz_kun = [r for r in quiz_kun if r in quiz_readings]
        # Every real (word-backed) reading this kanji has that isn't in the
        # default quizzed pool — an advanced learner can opt into testing
        # these (kanji.js's effectiveQuizReadings), but a child is never
        # shown them by default. Excludes readings with literally no word
        # anywhere (dropped_readings below still counts those; they have
        # nothing to show if tapped, so kanji.js/app.js never offer them).
        uncommon_readings = [r for r in dict.fromkeys(extra_on + extra_kun + overflow) if r not in quiz_readings]

        all_display = {r.replace('-', '').replace('.', '') for r in info["on"] + info["kun"]}
        dropped_readings += len(all_display) - len(set(quiz_on) | set(quiz_kun) | set(uncommon_readings))
        kept_readings += len(quiz_readings)
        if kanji in needs_uncommon:
            # Everything here came from the require_priority=False fallback
            # pass, not from the strong/weak split above — see needs_uncommon.
            fallback_kept_readings += len(quiz_readings)
        else:
            strong_kept_readings += (len(quiz_on) if on_is_strong else 0) + \
                (len(quiz_kun) if kun_is_strong else 0)
            weak_kept_readings += (len(quiz_on) if not on_is_strong else 0) + \
                (len(quiz_kun) if not kun_is_strong else 0)
        if not quiz_readings:
            no_quiz_readings.append(kanji)
        if uncommon_readings:
            uncommon_kept_readings += len(uncommon_readings)
            kanji_with_uncommon += 1

        reading_examples = {}
        # Built for quiz_readings AND uncommon_readings alike — an advanced
        # learner tapping an uncommon reading deserves the same example-word
        # treatment as any quizzed one (kanji-expansion-plan.md's "uncommon
        # yomi" work). uncommon_readings is already filtered to readings with
        # a `reading_words` entry (see its construction above), so this never
        # indexes a reading with nothing to show.
        for reading in quiz_readings + uncommon_readings:
            best = choose_examples(reading_words[reading], 1, prefer_common=True)[0]
            # Same shape as a `words` entry below, register badges included —
            # app.js's buildRegisterBadges() reads exactly these two keys, so
            # leaving them off (as this did) meant a reading example could
            # never show a badge even when the word plainly earned one: 独立
            # carried both in 立's "Common words" list and neither as リツ's
            # reading example, on the same screen.
            reading_examples[reading] = {
                "kanji": best[0], "kana": best[1], "en": best[2],
                "written": best[4], "spoken": best[6],
            }

        examples = choose_examples(general_words.get(kanji, []), EXAMPLES_PER_KANJI)
        grades.setdefault(unit_of(kanji, info), []).append({
            "kanji": kanji,
            "on": info["on"],
            "kun": info["kun"],
            "meanings": info["meanings"],
            "words": [
                {"kanji": k, "kana": r, "en": g, "written": w, "spoken": s}
                for k, r, g, _wb, w, _sb, s in examples
            ],
            "quizOn": quiz_on,
            "quizKun": quiz_kun,
            "quizReadings": quiz_readings,
            # Real readings this kanji has beyond the default quizzed pool —
            # not tested unless a learner opts in (kanji.js's
            # effectiveQuizReadings) — see the "uncommon yomi" work in
            # kanji-expansion-plan.md.
            "uncommonReadings": uncommon_readings,
            "readingExamples": reading_examples,
        })

    for grade, entries in sorted(grades.items()):
        total_examples = sum(len(e["words"]) for e in entries)
        print(f"grade {grade}: {len(entries)} kanji, {total_examples} example words")
    print(f"quiz readings: {kept_readings} kept (all with an example word), "
          f"{dropped_readings} dropped for having no example word at all")
    print(f"  of those kept: {strong_kept_readings} genuinely common (strong tier), "
          f"{weak_kept_readings} merely tagged, no common reading in that category "
          f"(weak-tier fallback), {fallback_kept_readings} from the zero-tag "
          f"needs_uncommon fallback")
    print(f"uncommon readings kept (word-backed, not quizzed by default — see "
          f"kanji-expansion-plan.md's \"uncommon yomi\" work): "
          f"{uncommon_kept_readings} across {kanji_with_uncommon} kanji")
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
    no_meaning_chars = []
    for grade in sorted(grades, key=str):
        entries = grades[grade]
        unit = str(grade)
        manifest_units[unit] = [e["kanji"] for e in entries]
        no_yomi_chars.extend(e["kanji"] for e in entries if not e["quizReadings"])
        no_meaning_chars.extend(e["kanji"] for e in entries if not e["meanings"])

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
        "// Every kanji with no non-radical English meaning at all — a handful of\n"
        "// beyond-jōyō characters (see kanji-expansion-plan.md §5) whose only\n"
        "// KANJIDIC gloss is their own radical name (e.g. \"dancing radical (no.\n"
        "// 136)\" for 舛), which build_kanji_data.py's RADICAL_MEANING filter\n"
        "// correctly strips as not a real definition. Same role as\n"
        "// NO_YOMI_CHARS, for Definition mode instead of Yomi.",
        "export const NO_MEANING_CHARS = " + json.dumps(sorted(set(no_meaning_chars)), ensure_ascii=False) + ";",
        "",
    ]
    manifest_path.write_text("\n".join(manifest_js), encoding="utf-8")
    print(f"wrote {manifest_path} ({manifest_path.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
