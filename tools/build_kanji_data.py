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

MAX_GRADE = 1          # build grade 1 for now; re-run with higher grade as needed
EXAMPLES_PER_KANJI = 4
MAX_KANJI_PER_WORD = 2  # skip compounds that would slow a first-grader down

KANJIDIC = SRC / "kanjidic2.xml"
JMDICT = SRC / "JMdict_e"


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


def parse_jmdict_common_words(known_kanji, max_kanji_per_word):
    """Return {kanji: [(kanji_form, reading, gloss), ...]} for common JMdict
    entries whose kanji form uses only characters in `known_kanji` (plus kana),
    to keep example words within what a grade-1..N learner has met."""
    text = JMDICT.read_text(encoding="utf-8")
    entries = re.findall(r"<entry>.*?</entry>", text, re.S)

    kana_pattern = re.compile(r"[぀-ゟ゠-ヿー]")
    kanji_pattern = re.compile(r"[一-鿿]")

    by_kanji = {k: [] for k in known_kanji}

    for entry in entries:
        k_ele = re.search(r"<k_ele>.*?<keb>(.*?)</keb>.*?</k_ele>", entry, re.S)
        if not k_ele:
            continue
        keb = html.unescape(k_ele.group(1))
        kanji_in_word = set(kanji_pattern.findall(keb))
        if not kanji_in_word or not kanji_in_word.issubset(known_kanji):
            continue
        if len(kanji_in_word) > max_kanji_per_word:
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
        for k in kanji_in_word:
            by_kanji[k].append((keb, reading, gloss))

    return by_kanji


def choose_examples(words, limit):
    # Shortest reading first: for a beginner, "いち" beats "いちばん".
    return sorted(words, key=lambda w: len(w[1]))[:limit]


def main():
    if not KANJIDIC.exists() or not JMDICT.exists():
        raise SystemExit(
            f"Missing source data. Run tools/fetch_kanji_sources.sh first "
            f"(expects {KANJIDIC} and {JMDICT})."
        )

    kanji_info = parse_kanjidic(MAX_GRADE)
    print(f"kanjidic2: {len(kanji_info)} kanji at grade <= {MAX_GRADE}")

    words_by_kanji = parse_jmdict_common_words(set(kanji_info), MAX_KANJI_PER_WORD)

    grades = {}
    for kanji, info in sorted(kanji_info.items(), key=lambda kv: (kv[1]["grade"], kv[0])):
        examples = choose_examples(words_by_kanji.get(kanji, []), EXAMPLES_PER_KANJI)
        entry = {
            "kanji": kanji,
            "on": info["on"],
            "kun": info["kun"],
            "meanings": info["meanings"],
            "words": [{"kanji": k, "kana": r, "en": g} for k, r, g in examples],
        }
        grades.setdefault(info["grade"], []).append(entry)
        if not examples:
            print(f"  warning: no common example word found for {kanji}")

    for grade, entries in sorted(grades.items()):
        total_examples = sum(len(e["words"]) for e in entries)
        print(f"grade {grade}: {len(entries)} kanji, {total_examples} example words")

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
