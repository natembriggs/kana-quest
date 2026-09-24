"""Flag story words a learner should not have to spend effort on.

A story may use words the vocabulary list does not teach — the list is a
frequency cut, not a syllabus, and a story needs 提灯 and 魔女 whatever their
corpus counts say. But every such word costs the learner a lookup, so each one
must earn its place: common in real speech or writing, or critical to the
story. 帳面 ("ledger", archaic for a notebook) appeared nineteen times in a
Level 5 story and passed every structural check; this is the check that
would have caught it. See story-writing-guide.md §5a.

For every content word in the BUILT stories (src/data/story-*.js) that the
vocabulary list does not teach, and that tools/story_src/vocab-reviewed.json
has not already approved at that level, it asks JMdict and the two frequency
corpora the build already uses:

  uncommon     no priority tag on this spelling, and rare in both the
               Tanaka Corpus and the subtitle word list
  spelling     JMdict marks this spelling rare, outdated or search-only
               (rK/oK/iK/sK): a real word written an unreal way
  register     JMdict marks the word archaic, obsolete, dated or rare
  kana         normally written in kana, but the story writes it in kanji

It also flags a linked word whose curriculum entry has a different reading
from the story's (家/いえ opening the entry for 家/け), since the reader would
then teach the wrong word.

Phrases and inflected compounds JMdict has no entry for (七時五十二分,
森を出る) are not flagged — they are built from words, not words themselves.
Pass --phrases to list them too.

This is advice, not a gate: a flagged word may be exactly right. Review each
one, then either change the story, add the word to the curriculum
(tools/vocab_src/story_words.tsv, then tools/build_vocab_data.py) or record
the decision in vocab-reviewed.json so it is not raised again.

Usage (from the repo root, after tools/build_story_data.mjs):
    python3 tools/check_story_vocab.py                 # every story
    python3 tools/check_story_vocab.py saigo-no-otehon # ids starting with this
    python3 tools/check_story_vocab.py --level L3 --phrases --json
    python3 tools/check_story_vocab.py --strict        # exit 1 if anything is flagged
"""
import argparse
import glob
import html
import json
import pickle
import re
import sys
from pathlib import Path

TOOLS = Path(__file__).resolve().parent
ROOT = TOOLS.parent
DATA = ROOT / "src" / "data"
REVIEWED = TOOLS / "story_src" / "vocab-reviewed.json"
JMDICT = TOOLS / "data_src" / "JMdict_e"
CACHE = TOOLS / "data_src" / "story-vocab-jmdict.pickle"  # data_src/ is git-ignored

sys.path.insert(0, str(TOOLS))
from build_kanji_data import kata_to_hira, load_subtitle_freq, load_tanaka_freq, subtitle_lookup  # noqa: E402

LEVELS = ["L1", "L2", "L3", "L4", "L5", "L6"]
CONTENT_POS = {"n", "v", "adj", "adv", "int", "interj", "exp", "conj"}
BAD_SPELLING = {"rK", "oK", "iK", "sK"}
BAD_REGISTER = {"arch", "obs", "dated", "rare", "obsc"}
# Past these ranks a word is rare in that corpus: roughly the bottom half of
# the 34,000-word subtitle list, and past the Tanaka Corpus's commonest 10,000.
SUBTITLE_RARE = 20000
TANAKA_RARE = 10000
KANJI_RE = re.compile(r"[㐀-䶿一-鿿]")


def load_js_object(path, name):
    text = Path(path).read_text(encoding="utf-8")
    m = re.search(rf"export const {name} = (.*?);\n", text, re.S)
    return json.loads(m.group(1))


def load_stories():
    stories = []
    for path in sorted(glob.glob(str(DATA / "story-*.js"))):
        if path.endswith("story-manifest.js"):
            continue
        stories.append(load_js_object(path, "STORY"))
    return stories


def load_vocab_readings():
    """vocab id -> the word's readings, for the linked-entry reading check:
    its own, then the other readings JMdict gives the same entry
    (VOCAB_READINGS — 頭 あたま is also かしら)."""
    readings = {}
    for path in glob.glob(str(DATA / "vocab-*.js")):
        if path.endswith(("vocab-manifest.js", "vocab-lookup.js")):
            continue
        for entry in load_js_object(path, "VOCAB_ENTRIES"):
            readings[entry["id"]] = [kata_to_hira(entry["r"])]
    for wid, alt in load_js_object(DATA / "vocab-lookup.js", "VOCAB_READINGS").items():
        readings[wid] += [kata_to_hira(r) for r in alt]
    return readings


def reads_as(token, wid, readings):
    """Whether a story token reads as the vocabulary word it links to — the
    same rule as readsAs() in tools/build_story_data.mjs. From where the
    word's spelling starts in the token, the token's reading must begin with
    one of the word's readings, up to any trailing kana: 途中で is 途中,
    開いた is 開く|ひらく, but 家/いえ is not 家/け."""
    spelling = wid.split("|")[0]
    reading = kata_to_hira(token["k"])
    start = token["s"].find(spelling[0])
    if start > 0:
        ruby = dict((i, kana) for i, kana in token.get("ruby") or [])
        prefix = ""
        for i in range(start):
            if i in ruby:
                prefix += kata_to_hira(ruby[i])
            elif KANJI_RE.match(token["s"][i]):
                prefix = None
                break
            else:
                prefix += kata_to_hira(token["s"][i])
        if prefix is not None and reading.startswith(prefix):
            reading = reading[len(prefix):]
    tail = re.search(r"[ぁ-ゖ]*$", spelling).group(0)
    if tail == spelling:
        return True
    for r in readings:
        stem = r[:len(r) - len(tail)] if tail and r.endswith(tail) else r
        if spelling.endswith("来る") and stem.endswith("く"):
            if reading.startswith(stem[:-1]) and reading[len(stem) - 1:len(stem)] in ("く", "き", "こ"):
                return True
        elif reading.startswith(stem):
            return True
    return False


def load_jmdict():
    """spelling -> [(priority tags on THIS spelling, its info tags,
    first-sense misc tags, the entry's readings)], cached beside JMdict."""
    if CACHE.exists() and CACHE.stat().st_mtime > JMDICT.stat().st_mtime:
        with CACHE.open("rb") as f:
            return pickle.load(f)
    index = {}
    text = JMDICT.read_text(encoding="utf-8")
    for e in re.findall(r"<entry>.*?</entry>", text, re.S):
        sense = re.search(r"<sense>.*?</sense>", e, re.S)
        misc = tuple(re.findall(r"<misc>&(.*?);</misc>", sense.group(0))) if sense else ()
        readings = tuple(kata_to_hira(html.unescape(r)) for r in re.findall(r"<reb>(.*?)</reb>", e))
        for tag, pri_tag, inf_tag in (("keb", "ke_pri", "ke_inf"), ("reb", "re_pri", "re_inf")):
            element = tag[0] + "_ele"
            for el in re.findall(rf"<{element}>(.*?)</{element}>", e, re.S):
                form = html.unescape(re.search(rf"<{tag}>(.*?)</{tag}>", el).group(1))
                index.setdefault(form, []).append((
                    tuple(re.findall(rf"<{pri_tag}>(.*?)</{pri_tag}>", el)),
                    tuple(re.findall(rf"<{inf_tag}>&(.*?);</{inf_tag}>", el)),
                    misc, readings, tag == "keb",
                ))
    with CACHE.open("wb") as f:
        pickle.dump(index, f)
    return index


def judge(lemma, reading, jmdict, tanaka, subtitle):
    """Reasons this word needs a human look, or [] if it is plainly common.
    None means JMdict has no entry: a phrase, not a word."""
    matches = jmdict.get(lemma)
    if not matches:
        return None
    if reading:
        by_reading = [m for m in matches if kata_to_hira(reading) in m[3]]
        matches = by_reading or matches
    reasons = []
    common = any(m[0] for m in matches)
    if KANJI_RE.search(lemma) and all("uk" in m[2] for m in matches) and not common:
        reasons.append("kana")
    if not common:
        sub_rank = subtitle_lookup(lemma, subtitle)
        tan_rank = tanaka.get(lemma)
        if (sub_rank is None or sub_rank > SUBTITLE_RARE) and (tan_rank is None or tan_rank > TANAKA_RARE):
            reasons.append("uncommon")
        spelling = sorted(set().union(*(m[1] for m in matches)) & BAD_SPELLING)
        if spelling and all(set(m[1]) & BAD_SPELLING for m in matches):
            reasons.append("spelling:" + ",".join(spelling))
        register = set.intersection(*(set(m[2]) for m in matches)) & BAD_REGISTER
        if register:
            reasons.append("register:" + ",".join(sorted(register)))
    return reasons


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("story", nargs="?", default="", help="only stories whose id starts with this")
    parser.add_argument("--level", choices=LEVELS, help="only stories at this level")
    parser.add_argument("--phrases", action="store_true", help="also list phrases JMdict has no entry for")
    parser.add_argument("--all", action="store_true", help="ignore vocab-reviewed.json")
    parser.add_argument("--json", action="store_true", help="machine-readable output")
    parser.add_argument("--strict", action="store_true", help="exit 1 if anything is flagged")
    args = parser.parse_args()

    lookup = load_js_object(DATA / "vocab-lookup.js", "VOCAB_LOOKUP")
    vocab_readings = load_vocab_readings()
    reviewed = {} if args.all else {word: decision for word, decision
                                    in json.loads(REVIEWED.read_text(encoding="utf-8")).items()
                                    if not word.startswith("_")}
    jmdict = load_jmdict()
    tanaka, subtitle = load_tanaka_freq(), load_subtitle_freq()

    findings = {}  # (story id, lemma) -> finding
    for story in load_stories():
        if not story["id"].startswith(args.story) or (args.level and story["level"] != args.level):
            continue
        level = LEVELS.index(story["level"])
        for p, paragraph in enumerate(story["body"]):
            for s, sentence in enumerate(paragraph):
                text = "".join(t["s"] for t in sentence["t"])
                for token in sentence["t"]:
                    if token["pos"] not in CONTENT_POS:
                        continue
                    lemma = token.get("df") or token["s"]
                    reasons = None
                    if token.get("d"):
                        linked = vocab_readings.get(token["d"])
                        if linked and not reads_as(token, token["d"], linked):
                            reasons = [f"linked:{token['d']} is read {'/'.join(linked)}"]
                    elif lemma not in lookup and token["s"] not in lookup:
                        ok = reviewed.get(lemma)
                        if ok and LEVELS.index(ok["from"]) <= level:
                            continue
                        reasons = judge(lemma, None if token.get("df") else token["k"], jmdict, tanaka, subtitle)
                        if reasons is None:
                            reasons = ["phrase"] if args.phrases else []
                    if not reasons:
                        continue
                    key = (story["id"], lemma)
                    if key in findings:
                        findings[key]["count"] += 1
                        continue
                    findings[key] = {
                        "story": story["id"], "level": story["level"], "where": f"p{p + 1}s{s + 1}",
                        "word": lemma, "reading": token["k"], "gloss": token["g"], "reasons": reasons,
                        "count": 1, "sentence": text, "en": sentence["en"],
                    }

    ordered = sorted(findings.values(), key=lambda f: (f["level"], f["story"], f["where"]))
    if args.json:
        print(json.dumps(ordered, ensure_ascii=False, indent=2))
    else:
        story = None
        for f in ordered:
            if f["story"] != story:
                story = f["story"]
                print(f"\n{f['level']} {story}")
            times = f" ×{f['count']}" if f["count"] > 1 else ""
            print(f"  {f['word']}〔{f['reading']}〕{times}  {' / '.join(f['reasons'])}  — {f['gloss']}")
            print(f"      {f['where']} {f['sentence']}")
        words = len({f["word"] for f in ordered})
        print(f"\n{len(ordered)} findings, {words} distinct words" if ordered else "No words flagged.")
    if args.strict and ordered:
        sys.exit(1)


if __name__ == "__main__":
    main()
