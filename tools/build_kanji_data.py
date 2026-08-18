"""Build src/kanji-data.js from KANJIDIC2 and JMdict.

Extracts kanji for a given school grade with their on'yomi/kun'yomi readings,
English meanings, and a handful of common example words (drawn from JMdict,
restricted to words JMdict itself flags as common, and to grade<=N kanji so a
grade-1 example word doesn't lean on a grade-4 kanji the learner hasn't met).

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
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "tools" / "data_src"
OUT = ROOT / "src" / "kanji-data.js"

MAX_GRADE = 6           # grades 1-6: the full elementary-school (Kyoiku) kanji set
EXAMPLES_PER_KANJI = 4
MAX_KANJI_PER_WORD = 2      # cap for the general example-word list (grade-appropriate only)
MAX_KANJI_PER_READING_WORD = 3  # looser cap for reading-anchored lookups (see below)
MAX_CORRECT_READINGS = 6   # must match kanji.js's own cap, so the reading-example
                            # index only stores what the app can ever look up

KANJIDIC = SRC / "kanjidic2.xml"
JMDICT = SRC / "JMdict_e"


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


def parse_kanjidic(max_grade):
    """Return {kanji: {'on': [...], 'kun': [...], 'meanings': [...], 'grade': n}}."""
    text = KANJIDIC.read_text(encoding="utf-8")
    out = {}
    for block in re.findall(r"<character>.*?</character>", text, re.S):
        literal = re.search(r"<literal>(.*?)</literal>", block).group(1)
        grade_m = re.search(r"<grade>(\d+)</grade>", block)
        if not grade_m:
            continue
        grade = int(grade_m.group(1))
        if grade > max_grade:
            continue
        on = re.findall(r'<reading r_type="ja_on">(.*?)</reading>', block)
        kun = re.findall(r'<reading r_type="ja_kun">(.*?)</reading>', block)
        meanings = [
            html.unescape(m) for m in
            re.findall(r'<meaning>(?!<)(.*?)</meaning>', block)
            # meaning elements with m_lang attrs are non-English; the bare
            # <meaning> tag (no attributes) is English.
        ]
        out[literal] = {
            "on": [strip_dot(r) for r in on],
            "kun": [strip_dot(r) for r in kun],
            "meanings": meanings[:4],
            "grade": grade,
        }
    return out


def strip_dot(reading):
    """ja_kun readings mark the okurigana boundary with '.', e.g. つ.ぐ.
    Keep the dot: the app can decide whether to show the boundary, and
    stripping it can't be undone later."""
    return reading


def parse_jmdict_words(known_kanji, max_kanji_per_word, max_kanji_per_reading_word):
    """One pass over JMdict, returning two indexes keyed by kanji character:

    - `general`: common words using ONLY characters in `known_kanji` (plus
      kana), capped at `max_kanji_per_word` kanji — the grade-appropriate
      pool the kanji-level "example word" panel is drawn from.
    - `reading_candidates`: common words containing that kanji at all,
      capped at the looser `max_kanji_per_reading_word`, with no grade
      restriction on the *other* kanji in the word. This exists so a rare
      reading whose only common word pulls in a not-yet-learned kanji (上海
      for 上's シャン reading needs 海, which is grade 2) can still be found —
      the word is shown only as a memory aid for that one reading, not as
      something the learner is expected to fully read yet.

    Each entry is (kanji_form, reading, gloss, {kanji characters in the word}).
    """
    text = JMDICT.read_text(encoding="utf-8")
    entries = re.findall(r"<entry>.*?</entry>", text, re.S)

    kana_pattern = re.compile(r"[぀-ゟ゠-ヿー]+")
    kanji_pattern = re.compile(r"[一-鿿]")

    general = {k: [] for k in known_kanji}
    reading_candidates = {k: [] for k in known_kanji}

    for entry in entries:
        k_ele = re.search(r"<k_ele>.*?<keb>(.*?)</keb>.*?</k_ele>", entry, re.S)
        if not k_ele:
            continue
        keb = html.unescape(k_ele.group(1))
        kanji_in_word = set(kanji_pattern.findall(keb))
        relevant = kanji_in_word & known_kanji
        if not relevant or len(kanji_in_word) > max_kanji_per_reading_word:
            continue
        # Common-ness: JMdict marks frequent entries with a priority tag
        # (news1/ichi1/spec1/spec2/gai1/nfNN) inside <ke_pri>/<re_pri>.
        if "<ke_pri>" not in entry and "<re_pri>" not in entry:
            continue
        r_ele = re.search(r"<r_ele>.*?<reb>(.*?)</reb>.*?</r_ele>", entry, re.S)
        if not r_ele:
            continue
        reading = html.unescape(r_ele.group(1))
        if not kana_pattern.fullmatch(reading):
            continue  # skip readings that are themselves partly kanji
        glosses = re.findall(r"<gloss(?:\s[^>]*)?>(.*?)</gloss>", entry, re.S)
        if not glosses:
            continue
        gloss = html.unescape(glosses[0])

        record = (keb, reading, gloss, kanji_in_word)
        for k in relevant:
            reading_candidates[k].append(record)
            if kanji_in_word.issubset(known_kanji) and len(kanji_in_word) <= max_kanji_per_word:
                general[k].append(record)

    return general, reading_candidates


def choose_examples(words, limit):
    # Shortest reading first: for a beginner, "いち" beats "いちばん".
    return sorted(words, key=lambda w: len(w[1]))[:limit]


def find_reading_example(target_reading, candidates):
    """The shortest common word whose reading starts with `target_reading` —
    checked against both the reading as given and its hiragana form, since
    KANJIDIC writes on'yomi in katakana but most words spell them in
    hiragana (foreign-derived readings like シャン being the exception)."""
    target_hira = kata_to_hira(target_reading)
    matches = [
        c for c in candidates
        if c[1].startswith(target_reading) or c[1].startswith(target_hira)
    ]
    if not matches:
        return None
    best = min(matches, key=lambda c: len(c[1]))
    return {"kanji": best[0], "kana": best[1], "en": best[2]}


def normalize_reading(raw):
    """Must match kanji.js's normalizeReading exactly, so the readings this
    script builds examples for are the same strings the app ever displays."""
    return raw.replace('-', '').replace('.', '')


def main():
    if not KANJIDIC.exists() or not JMDICT.exists():
        raise SystemExit(
            f"Missing source data. Run tools/fetch_kanji_sources.sh first "
            f"(expects {KANJIDIC} and {JMDICT})."
        )

    kanji_info = parse_kanjidic(MAX_GRADE)
    print(f"kanjidic2: {len(kanji_info)} kanji at grade <= {MAX_GRADE}")

    known_kanji = set(kanji_info)
    general_words, reading_candidates = parse_jmdict_words(
        known_kanji, MAX_KANJI_PER_WORD, MAX_KANJI_PER_READING_WORD,
    )

    grades = {}
    missing_reading_examples = 0
    total_reading_examples = 0
    for kanji, info in sorted(kanji_info.items(), key=lambda kv: (kv[1]["grade"], kv[0])):
        examples = choose_examples(general_words.get(kanji, []), EXAMPLES_PER_KANJI)

        # Same on'yomi/kun'yomi + cap + ordering as kanji.js's buildKanjiIndex,
        # so this script only ever computes examples for readings the app can
        # actually display.
        on_readings = list(dict.fromkeys(info["on"]))
        kun_readings = list(dict.fromkeys(normalize_reading(r) for r in info["kun"]))
        quiz_readings = (on_readings + kun_readings)[:MAX_CORRECT_READINGS]

        candidates = reading_candidates.get(kanji, [])
        reading_examples = {}
        for reading in quiz_readings:
            example = find_reading_example(reading, candidates)
            if example:
                reading_examples[reading] = example
                total_reading_examples += 1
            else:
                missing_reading_examples += 1

        entry = {
            "kanji": kanji,
            "on": info["on"],
            "kun": info["kun"],
            "meanings": info["meanings"],
            "words": [{"kanji": k, "kana": r, "en": g} for k, r, g, _ in examples],
            "readingExamples": reading_examples,
        }
        grades.setdefault(info["grade"], []).append(entry)
        if not examples:
            print(f"  warning: no common example word found for {kanji}")

    for grade, entries in sorted(grades.items()):
        total_examples = sum(len(e["words"]) for e in entries)
        print(f"grade {grade}: {len(entries)} kanji, {total_examples} example words")
    print(f"reading examples: {total_reading_examples} found, {missing_reading_examples} readings with none")

    js = []
    js.append("// Generated by tools/build_kanji_data.py — do not hand-edit.")
    js.append("// Source: KANJIDIC2 and JMdict (c) EDRDG, CC BY-SA 4.0.")
    js.append("// https://www.edrdg.org/wiki/index.php/KANJIDIC_Project")
    js.append("")
    js.append("export const KANJI_BY_GRADE = " + json.dumps(grades, ensure_ascii=False, indent=2) + ";")
    js.append("")
    OUT.write_text("\n".join(js) + "\n", encoding="utf-8")
    print(f"wrote {OUT} ({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
