"""Build src/data/vocab-*.js from JMdict and the already-generated kanji data.

See vocab-plan.md for the design. This script implements phases 0 and 1.

PHASE 0 SOURCING DECISION: the plan's preferred source (§3.5) was an official
exam-board vocabulary specification, hand-transcribed into tools/vocab_src/.
That was not available to this build — and even if it had been, reproducing
a copyrighted specification's word list at the scale needed (order 1,500
words) is not something this script does; the copyright rules this session
operates under cap direct reproduction of copyrighted material at a single
short quote. So this build takes the plan's own stated fallback instead
(§3.5, "If the official list can't be used or obtained"): JMdict's own `nf`
corpus-frequency bands, the same signal `tools/build_kanji_data.py` already
uses for `choose_examples()`. The tier is named "Common words 1" (`lv: 'f'`)
/ "Common words 2" (`lv: 'h'`) rather than "GCSE Foundation" / "Higher" — per
the plan's own naming rule, this is not the GCSE list and must not be
labelled as such.

PHASE 6: a `lv: 'h'` word gets its OWN unit, not a spot in its theme's
existing (now implicitly 'f') unit — vocab-plan.md §2.1 is explicit that a
tile must not silently grow from 40 words to 65 overnight. The 'h' unit for
theme "2.4" is "2.4h", built and size-checked exactly like any other unit
(dropped below MIN_UNIT_SIZE, same as a whole theme would be) — which is why
not every theme ends up with one; the plan itself expects "maybe 18-22 of
the 28". All of them are grouped together under one "Common words 2" browse
group (GROUP_LABELS["H"]) rather than sitting inside their own theme's group
next to the 'f' tile, the same way kanji's secondary-school sub-units sit in
their own group after every primary grade rather than interleaved grade by
grade — so browsing the harder tier of ANY theme is one tap away, not one
tap per theme.

The unit/theme STRUCTURE is unchanged from vocab-plan.md §2.3 — a Core
spine (C1-C6) plus the five GCSE-style theme groups (22 further units). Core
is hand-authored below (CORE_ENTRIES): it is a small, closed, idiomatic set
where automated JMdict lookup by frequency alone picks the wrong homograph
too often (see the module comment above CORE_ENTRIES). The 22 theme units
are populated automatically: JMdict's common-word list, classified by
English-gloss keyword matching (THEME_KEYWORDS) rather than hand-picked one
by one, which is the semi-automatic approach the plan calls for and expects
to need hand-correction later (§3.5).

PHASE 7: A level (§2.3's second table, group tag "A"). The concern the
phase-6 comment above raised — "a frequency cut cannot produce exam-
appropriate abstract vocabulary" — turns out to cut the other way for THIS
tier: JMdict's `nf` bands come from newspaper corpus frequency, which
under-represents everyday GCSE topics (food, pets, clothes) but is a
reasonable proxy for A level's own themes (economy, politics, media,
environment, health) — those ARE what newspapers write about. So A level
reuses the exact same mechanism as phase 6 (THEME_KEYWORDS_A, classify_a()),
just aimed at the next slice of the SAME frequency-ranked candidate list —
whatever phase 6 didn't already claim for 'f'/'h' — rather than a different
technique. A12 "Writing and arguing" is the A-level counterpart of Core
(essay connectives and abstract nouns: したがって, 一方, 客観的...) and is
hand-authored the same way Core is, for the same reason: automated ranking
would as often find the wrong homograph as the right essay-register word.
A13 "The set text and film" is a deliberate stub per the plan (a unit that
only becomes real once a specific text is chosen) and isn't attempted here
at all — it would always be empty, so it's simply never emitted rather than
shipped as a permanently-dead tile.

This is still the plan's fallback, not the exam specification's own list —
the same honesty rule as phase 0 applies: it's labelled "A level" because
that's genuinely the axis it approximates (a third, harder tier beyond
Common words 1/2), but the word SELECTION is JMdict frequency + keyword
classification, not a transcribed syllabus.

Usage:
    python3 tools/build_vocab_data.py
"""
import heapq
import html
import json
import random
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
from build_kanji_data import (  # noqa: E402
    parse_kanjidic, build_stem_index, align_word, credited_reading,
    kata_to_hira, priority_rank, is_kanji, reading_parts, stem_variants,
)

SRC = ROOT / "data_src"
DATA_DIR = ROOT.parent / "src" / "data"
JMDICT = SRC / "JMdict_e"
EXAMPLES = SRC / "examples.utf"  # Tanaka Corpus, via WWWJDIC — see build_examples()

random.seed(20260828)  # reproducible builds — same output until the sources or this script change

WORDS_PER_LEVEL = {"f": 550, "h": 280, "a": 1200}  # frequency-classified theme words; Core/A12 are hand-authored and uncapped
MAX_PER_UNIT = 40
MIN_UNIT_SIZE = 10  # a unit below this is dropped with a warning rather than shipped near-empty
MAX_MIS = 8
MAX_SP = 16

KANA_ONLY_RE = re.compile(r"^[぀-ゟ゠-ヿー]+$")
KANJI_ONLY_RE = re.compile(r"^[一-鿿]+$")

# --- Part-of-speech, coarse ------------------------------------------------
# Only used for buildDefinitionChoices-style "don't offer a verb among nouns"
# filtering (§5.5) — coarse categories are all that needs. JMdict lists a
# word's own pos tags in priority order (most applicable first) WITHIN one
# sense; taking the first recognised tag in that order (not scanning ALL
# tags for a verb match first) matters — a huge number of common nouns are
# ALSO tagged vs/vi/vt for their suru-verb use (勉強: n, vs, vt) and would be
# misclassified as verbs if verb tags were preferred regardless of position.
POS_VERB_RE = re.compile(r"^(v1|v5|v-|vs|vz|vk|vn|vr|aux-v)")
POS_ADJ_RE = re.compile(r"^adj-")
POS_NOUN_RE = re.compile(r"^n(-|$)")
POS_ADV_RE = re.compile(r"^adv")


def pos_category(tags):
    for t in tags:
        if POS_VERB_RE.match(t):
            return "v"
        if POS_ADJ_RE.match(t):
            return "adj"
        if POS_NOUN_RE.match(t):
            return "n"
        if POS_ADV_RE.match(t):
            return "adv"
    return "other"


# --- Senses beyond the first (vocab-plan.md §5.6) --------------------------
#
# The `glosses` field on a candidate stays FIRST-SENSE-ONLY and keeps driving
# everything that decides which words exist and where they live — theme
# classification, the proper-noun screen, `sp` keyword matching. Widening it
# would reshuffle every unit's word list and orphan learners' existing
# progress, for no gain: none of those consumers wants sense 7 of あける.
#
# `senses` is the new, separate field, and feeds only what the learner READS:
# the quiz label, the Recall prompt, the detail screen.

# Senses a beginner meeting 500 words has no use for. Note `uk` is NOT here —
# it is a spelling note, not a register one, and is read off sense 1 for its
# own purposes elsewhere.
SKIP_SENSE_MISC = {
    "arch", "obs", "obsc", "rare", "dated", "sl", "m-sl", "net-sl",
    "vulg", "derog", "X", "joc",
}

MAX_SENSES = 3
MAX_GLOSSES_PER_SENSE = 3
MAX_GLOSSES = 6

# vocab-plan.md §5.6's editorial override: JMdict orders どうして's senses with
# "how" first, but the word is overwhelmingly "why" in current use, and sense
# order decides `en[0]` (the one-line label on chips and lists). Keyed by the
# entry's reading, valued by 1-based JMdict sense numbers in the order they
# should be emitted; senses not named keep their relative order after the
# named ones. Reordering only — a gloss that is not in JMdict never appears.
SENSE_ORDER_OVERRIDES = {
    "どうして": [2, 1],  # why, for what reason / how, in what way
}


def extract_senses(entry_xml, reading):
    """vocab-plan.md §5.6: the glosses of every sense worth teaching, grouped,
    in sense order. Filtered by register (SKIP_SENSE_MISC) and by coarse part
    of speech — a word's noun sense and its interjection sense are different
    words as far as §5.5's "don't offer a verb among nouns" filter is
    concerned, and mixing them into one label would misdescribe both.

    JMdict omits <pos> on a sense that repeats the previous one's, so the last
    seen tags carry forward rather than falling through to "other"."""
    groups = []
    pos_tags = []
    primary_pos = None
    for s in re.findall(r"<sense>.*?</sense>", entry_xml, re.S):
        tags = [t.strip("&;") for t in re.findall(r"<pos>&(.*?);</pos>", s)]
        if tags:
            pos_tags = tags
        pos = pos_category(pos_tags)
        if primary_pos is None:
            primary_pos = pos
        glosses = [html.unescape(g) for g in re.findall(r"<gloss(?:\s[^>]*)?>(.*?)</gloss>", s, re.S)]
        misc = {t.strip("&;") for t in re.findall(r"<misc>&(.*?);</misc>", s)}
        groups.append({"glosses": glosses, "pos": pos, "misc": misc})

    order = SENSE_ORDER_OVERRIDES.get(reading)
    if order:
        named = [i - 1 for i in order if 0 < i <= len(groups)]
        groups = [groups[i] for i in named] + [g for i, g in enumerate(groups) if i not in named]
        # The override moves a sense to the front, so "same pos as sense 1"
        # has to be judged against the sense that now IS first.
        primary_pos = groups[0]["pos"] if groups else primary_pos

    out, total = [], 0
    for g in groups:
        if len(out) >= MAX_SENSES or total >= MAX_GLOSSES:
            break
        if not g["glosses"] or g["misc"] & SKIP_SENSE_MISC or g["pos"] != primary_pos:
            continue
        keep = g["glosses"][:MAX_GLOSSES_PER_SENSE][:MAX_GLOSSES - total]
        out.append(keep)
        total += len(keep)
    return out


# A handful of JMdict's own inflection-info tags mark a kanji spelling as one
# nobody should actually be taught: search-only (sK), irregular (iK),
# out-dated (oK), or rarely-used (rK, e.g. 為る for する, 居る for いる — the
# entries genuinely ARE those, but the kanji spelling is essentially never
# written and offering it as "the word's spelling" would be teaching
# something false). A k_ele carrying any of these is skipped when choosing
# which kanji spelling (if any) to show; if it was the entry's ONLY k_ele,
# the word is treated as kana-only instead — the same as if it had no k_ele
# in the first place. Bare rK is treated less harshly (still eligible if it
# is genuinely the only useful surface): the rK-only fallback below is
# reached exactly for the four core grammar words that need it (する, いる,
# ある's rarer forms are not used, 沢山's this doesn't apply since 沢山 is a
# normal, common kanji spelling with just a `uk` note, not rK).
BAD_KEB_INF = re.compile(r"&(sK|iK|oK);")


def load_js_const(path, name):
    """Extracts one `export const NAME = <JSON>;` from a generated data file —
    these are always valid JSON on the right-hand side (written by
    json.dumps), so this is just finding where the statement ends. A file can
    hold several such consts (kanji-manifest.js has three), so the match ends
    at the first `;` that starts its own line, not at end of file."""
    text = (ROOT.parent / path).read_text(encoding="utf-8")
    m = re.search(rf"export const {name} = (.*?);\n", text, re.S)
    return json.loads(m.group(1))


def load_kanji_quiz_data():
    """char -> set(quizReadings) across every generated kanji-grade-*.js —
    what a vocab word's ruby is allowed to CREDIT (vocab-plan.md §4.5 safeguard
    4): only readings the kanji course itself considers real and quizzable.
    Also returns the full set of taught kanji, used as the fallback pool for
    spelling distractors (§6.3) when a same-reading substitute can't be found."""
    units = load_js_const("src/data/kanji-manifest.js", "KANJI_UNITS")
    quiz_readings = {}
    for unit in units:
        entries = load_js_const(f"src/data/kanji-grade-{unit}.js", "KANJI_ENTRIES")
        for e in entries:
            quiz_readings[e["kanji"]] = set(e["quizReadings"])
    taught_kanji = sorted(quiz_readings.keys())
    return quiz_readings, taught_kanji


# --- JMdict, one pass -------------------------------------------------------

def segment_spans(keb, alignment):
    """align_word (build_kanji_data.py) returns (pos_in_keb, segment) pairs for
    kanji positions only. Reconstruct each one's (start, end) span in the
    READING string too, so a distractor reading can be built by slicing —
    walking `keb` in order and accumulating reading-length is enough: a kana
    character in keb always consumes exactly one character of the reading
    (that's what anchors alignment in the first place), and a kanji
    position's span is exactly the length of its own matched segment."""
    align_map = dict(alignment)
    spans = []
    j = 0
    for i, ch in enumerate(keb):
        if i in align_map:
            seg = align_map[i]
            spans.append((i, seg, j, j + len(seg)))
            j += len(seg)
        else:
            j += 1
    return spans


def parse_jmdict():
    text = JMDICT.read_text(encoding="utf-8")
    raw_entries = re.findall(r"<entry>.*?</entry>", text, re.S)
    print(f"JMdict: {len(raw_entries)} entries")

    all_kebs = set()
    readings_by_keb = {}  # keb -> set(reb, hiragana) across every entry sharing that keb
    # Same information, but ORDERED and for every keb rather than just the
    # first: JMdict lists an entry's readings commonest-first, which is the
    # tie-break build_examples() falls back on when neither the corpus nor
    # the entry itself says how a written form is read.
    keb_readings = {}
    candidates = []  # priority-tagged, ready for level/theme classification
    kanji_only_pool = {}  # kanji-count -> [(keb, gloss_tokens, rank)]
    # For the example sentences (build_examples below), which have to say what
    # ANY word in a sentence means, not just the curriculum's own 3,900:
    # written form (or form|reading, or form#entry-id — see glossary_key) ->
    # a short gloss. Built from every entry, not just the priority-tagged
    # ones, because a sentence contains whatever it contains.
    example_glosses = {}
    gloss_is_common = {}  # same keys: whether that gloss came from a priority-tagged entry
    # Same keys again, but every sense rather than only the first, and only
    # for the priority-tagged entries. The corpus's index line names a sense
    # number wherever the word is used in something other than its first
    # sense — と is "if, when" in sense 1 but "with" in sense 3 — and the
    # words that happens to are exactly the common, polysemous ones. Rare
    # entries are left out: they are most of the 990,000 keys here and none
    # of the ones a sentence index ever disambiguates.
    example_senses = {}
    # Written forms JMdict marks as a proverb, idiom, quotation or 四字熟語.
    # A sentence that IS one of these is a poor example of any word in it
    # (see IDIOM_PENALTY): idioms are non-literal and often archaic, which is
    # the opposite of what showing a word in ordinary use is for.
    idiomatic = set()

    stop_tokens = {
        "a", "an", "the", "to", "of", "in", "on", "for", "or", "and", "with",
        "is", "be", "esp", "etc", "usu", "one", "someone", "something",
    }

    for e in raw_entries:
        k_els = re.findall(r"<k_ele>(.*?)</k_ele>", e, re.S)
        kebs_all = [html.unescape(m.group(1)) for k in k_els for m in [re.search(r"<keb>(.*?)</keb>", k)]]
        all_kebs.update(kebs_all)

        r_els = re.findall(r"<r_ele>(.*?)</r_ele>", e, re.S)
        rebs_all = [html.unescape(m.group(1)) for r in r_els for m in [re.search(r"<reb>(.*?)</reb>", r)]]
        if kebs_all and rebs_all:
            readings_by_keb.setdefault(kebs_all[0], set()).update(kata_to_hira(r) for r in rebs_all)
            for k in kebs_all:
                ordered = keb_readings.setdefault(k, [])
                for r in rebs_all:
                    hira = kata_to_hira(r)
                    if hira not in ordered:
                        ordered.append(hira)

        entry_is_common = ("<ke_pri>" in e) or ("<re_pri>" in e)

        # --- Example-sentence glosses and idiom tags, from EVERY entry ---
        all_senses = re.findall(r"<sense>.*?</sense>", e, re.S)
        if all_senses and (kebs_all or rebs_all):
            sense_glosses = [html.unescape(g) for g in
                             re.findall(r"<gloss(?:\s[^>]*)?>(.*?)</gloss>", all_senses[0], re.S)]
            if sense_glosses:
                short = example_gloss(sense_glosses)
                by_sense = None
                if entry_is_common and len(all_senses) > 1:
                    by_sense = []
                    for sense in all_senses:
                        found = [html.unescape(g) for g in
                                 re.findall(r"<gloss(?:\s[^>]*)?>(.*?)</gloss>", sense, re.S)]
                        by_sense.append(example_gloss(found) if found else short)
                seq_m = re.search(r"<ent_seq>(\d+)</ent_seq>", e)
                hira_rebs = [kata_to_hira(r) for r in rebs_all]
                keys = []
                for form in (kebs_all or rebs_all):
                    keys.append(form)
                    keys.extend(f"{form}|{r}" for r in hira_rebs)
                    if seq_m:
                        keys.append(f"{form}#{seq_m.group(1)}")
                for key in keys:
                    # First entry wins, EXCEPT that a priority-tagged entry
                    # displaces an unmarked one: JMdict is ordered by entry
                    # id, not by how common a word is, so the first 彼 to come
                    # past is not necessarily the pronoun anyone means.
                    if key not in example_glosses or (entry_is_common and not gloss_is_common.get(key)):
                        example_glosses[key] = short
                        gloss_is_common[key] = entry_is_common
                        if by_sense:
                            example_senses[key] = by_sense
                        else:
                            example_senses.pop(key, None)
        if re.search(r"<misc>&(proverb|id|quote|yoji);</misc>", e):
            idiomatic.update(kebs_all)
            idiomatic.update(rebs_all)

        if not entry_is_common:
            continue
        if not rebs_all:
            continue
        reb = rebs_all[0]

        # Pick the first k_ele that isn't flagged as a spelling nobody should
        # be taught (see BAD_KEB_INF above); a word with no acceptable k_ele
        # left is treated as kana-only.
        keb = None
        for k in k_els:
            m = re.search(r"<keb>(.*?)</keb>", k)
            if not m:
                continue
            if BAD_KEB_INF.search(k):
                continue
            keb = html.unescape(m.group(1))
            break

        first_sense_m = re.search(r"<sense>.*?</sense>", e, re.S)
        if not first_sense_m:
            continue
        fs = first_sense_m.group(0)
        pos_tags = [t.strip("&;") for t in re.findall(r"<pos>&(.*?);</pos>", fs)]
        glosses = [html.unescape(g) for g in re.findall(r"<gloss(?:\s[^>]*)?>(.*?)</gloss>", fs, re.S)]
        if not glosses:
            continue
        # Scoped to the FIRST sense, not the whole entry: 行く's primary
        # sense ("to go") is written in kanji, but its entry also has a late
        # auxiliary/slang sense ("to continue ...", "to have an orgasm")
        # that IS tagged uk — matching anywhere in `e` picked that up and
        # wrongly hid 行く's kanji spelling entirely.
        uk = ("<misc>&uk;</misc>" in fs) or keb is None
        rank = priority_rank(e)
        # uk ("usually written in kana"): per vocab-plan.md §3.3, these words
        # are shown BY their kana form regardless of whether a kanji spelling
        # exists in JMdict — for する/いる/この/その/あの and friends, that
        # spelling is a rK ("rarely used") form nobody actually writes; for
        # 沢山/綺麗 and the like it exists and is used, just less often than
        # kana. Either way there is no spelling stage and nothing to hide
        # furigana over (§6.2, §5.2).
        surface = reb if uk else keb
        reading = kata_to_hira(reb)
        candidates.append({
            "surface": surface, "keb": None if uk else keb, "reading": reading,
            # First-sense `glosses` and all-sense `senses` are deliberately
            # both kept — see the comment above extract_senses for why the
            # word-selection path must not widen.
            "glosses": glosses, "senses": extract_senses(e, reading),
            "pos": pos_category(pos_tags), "uk": uk,
            "rank": rank,
        })

        if keb and KANJI_ONLY_RE.match(keb) and not BAD_KEB_INF.search(e):
            tokens = {w for w in re.findall(r"[a-z]+", glosses[0].lower()) if w not in stop_tokens}
            kanji_only_pool.setdefault(len(keb), []).append((keb, tokens, rank))

    print(f"  {len(candidates)} priority-tagged candidates, {len(all_kebs)} distinct kanji/kana surfaces")
    print(f"  {len(example_glosses)} example-sentence gloss keys "
          f"({len(example_senses)} of them sense-by-sense), "
          f"{len(idiomatic)} written forms tagged as an idiom, proverb or quotation")
    return (candidates, all_kebs, readings_by_keb, keb_readings, kanji_only_pool,
            example_glosses, example_senses, idiomatic)


def build_entry_index(raw_entries):
    """first-k_ele -> raw entry text, and first-r_ele (for kana-only entries,
    no k_ele at all) -> raw entry text. First entry wins on a collision,
    matching JMdict's own convention that the first sense/entry for a headword
    is its primary one. Used by find_entry() for CORE_ENTRIES lookups."""
    by_keb, by_reb_only = {}, {}
    for e in raw_entries:
        k_els = re.findall(r"<k_ele>(.*?)</k_ele>", e, re.S)
        r_els = re.findall(r"<r_ele>(.*?)</r_ele>", e, re.S)
        if k_els:
            m = re.search(r"<keb>(.*?)</keb>", k_els[0])
            if m:
                by_keb.setdefault(html.unescape(m.group(1)), e)
        elif r_els:
            m = re.search(r"<reb>(.*?)</reb>", r_els[0])
            if m:
                by_reb_only.setdefault(html.unescape(m.group(1)), e)
    return by_keb, by_reb_only


def find_entry(entry_index, keb=None, reb=None):
    """Exact lookup for CORE_ENTRIES: the entry whose first k_ele (or, if
    keb is None, first r_ele with NO k_ele at all) matches exactly. Unlike
    the frequency pass, Core words are specified by their EXACT intended
    surface, not discovered by ranking — see the module comment above
    CORE_ENTRIES for why that matters for words like する/いる, whose
    best-ranked reading match by pure priority number is a same-sounding but
    wrong-meaning homograph."""
    by_keb, by_reb_only = entry_index
    e = by_keb.get(keb) if keb else by_reb_only.get(reb)
    if e is None:
        return None
    rebs_all = [html.unescape(x) for x in re.findall(r"<reb>(.*?)</reb>", e)]
    first_sense_m = re.search(r"<sense>.*?</sense>", e, re.S)
    fs = first_sense_m.group(0) if first_sense_m else e
    pos_tags = [t.strip("&;") for t in re.findall(r"<pos>&(.*?);</pos>", fs)]
    glosses = [html.unescape(g) for g in re.findall(r"<gloss(?:\s[^>]*)?>(.*?)</gloss>", fs, re.S)]
    uk = ("<misc>&uk;</misc>" in fs) or keb is None  # first sense only — see parse_jmdict's note on 行く
    reading = kata_to_hira(rebs_all[0])
    return {
        "surface": reading if uk else keb, "keb": None if uk else keb, "reading": reading,
        "glosses": glosses, "senses": extract_senses(e, reading),
        "pos": pos_category(pos_tags), "uk": uk,
    }


# --- Core: hand-specified, looked up for its real glosses -----------------
#
# vocab-plan.md §2.3's Core group (C1-C6) — a small, closed, idiomatic set
# where JMdict has exactly the entries needed but ranking by raw frequency
# number often surfaces the WRONG homograph (see the module comment at the
# top of this file: する's best-nf reading-match is 擦る "to rub", not the
# auxiliary verb at all). So each entry here names its target explicitly —
# by keb when the word has a real kanji headword worth disambiguating on
# (even an rK one, since find_entry only uses it to pick the right entry;
# uk still governs what's actually displayed), by reb when it doesn't.
# glosses/pos still come from the real JMdict entry, not typed by hand.
#
# (unit, keb_or_None, reb_or_None)
CORE_ENTRIES = {
    "C1": [
        ("こんにちは", "今日は", None), ("おはよう", "お早う", None),
        ("こんばんは", "今晩は", None), ("さようなら", "左様なら", None),
        ("ありがとう", "有難う", None), ("すみません", "済みません", None),
        ("お願いします", "お願いします", None), ("はい", None, "はい"),
        ("いいえ", None, "いいえ"), ("分かる", "分かる", None),
        ("質問", "質問", None),
    ],
    "C2": [
        ("一", "一", None), ("二", "二", None), ("三", "三", None), ("四", "四", None),
        ("五", "五", None), ("六", "六", None), ("七", "七", None), ("八", "八", None),
        ("九", "九", None), ("十", "十", None), ("百", "百", None), ("千", "千", None),
        ("万", "万", None),
        ("月曜日", "月曜日", None), ("火曜日", "火曜日", None), ("水曜日", "水曜日", None),
        ("木曜日", "木曜日", None), ("金曜日", "金曜日", None), ("土曜日", "土曜日", None),
        ("日曜日", "日曜日", None),
        ("今日", "今日", None), ("明日", "明日", None), ("昨日", "昨日", None),
        ("年", "年", None), ("月", "月", None), ("日", "日", None),
        ("時間", "時間", None), ("分", "分", None),
    ],
    "C3": [
        ("何", "何", None), ("誰", "誰", None), ("どこ", "何処", None), ("いつ", "何時", None),
        ("どう", "如何", None), ("どうして", "如何して", None), ("どちら", "何方", None),
        ("どの", "何の", None), ("この", "此の", None), ("その", "其の", None),
        ("あの", "彼の", None), ("これ", "此れ", None), ("それ", "其れ", None),
        ("あれ", "彼", None), ("どれ", "何れ", None),
    ],
    "C4": [
        ("でも", None, "でも"), ("そして", "然して", None), ("だから", None, "だから"),
        ("しかし", "然し", None), ("それから", "其れから", None), ("または", "又は", None),
        ("もし", "若し", None), ("から", None, "から"), ("まで", "迄", None),
        ("と", None, "と"), ("や", None, "や"),
    ],
    "C5": [
        ("する", "為る", None), ("ある", "有る", None), ("いる", "居る", None),
        ("行く", "行く", None), ("来る", "来る", None), ("帰る", "帰る", None),
        ("見る", "見る", None), ("聞く", "聞く", None), ("話す", "話す", None),
        ("読む", "読む", None), ("書く", "書く", None), ("食べる", "食べる", None),
        ("飲む", "飲む", None), ("買う", "買う", None), ("作る", "作る", None),
        ("使う", "使う", None), ("持つ", "持つ", None), ("会う", "会う", None),
        ("住む", "住む", None), ("働く", "働く", None), ("寝る", "寝る", None),
        ("起きる", "起きる", None), ("思う", "思う", None), ("言う", "言う", None),
        ("知る", "知る", None), ("できる", "出来る", None),
    ],
    "C6": [
        ("大きい", "大きい", None), ("小さい", "小さい", None), ("いい", "良い", None),
        ("悪い", "悪い", None), ("高い", "高い", None), ("安い", "安い", None),
        ("新しい", "新しい", None), ("古い", "古い", None), ("楽しい", "楽しい", None),
        ("難しい", "難しい", None), ("簡単", "簡単", None), ("忙しい", "忙しい", None),
        ("元気", "元気", None), ("好き", "好き", None), ("嫌い", "嫌い", None),
        ("とても", "迚も", None), ("少し", "少し", None), ("たくさん", "沢山", None),
        ("ちょっと", "一寸", None), ("いつも", "何時も", None), ("よく", "良く", None),
        ("あまり", "余り", None),
    ],
}

# vocab-plan.md §2.3: A12 "Writing and arguing" is A level's Core-equivalent
# — essay connectives and the abstract nouns that go with them, not exam
# vocabulary in the ordinary sense. Same hand-authoring rationale as
# CORE_ENTRIES: automated frequency ranking would find the wrong homograph
# as often as the right one for a set this idiomatic (もっとも's best keb
# match by raw frequency is 最も "most", not the conjunction "but then/
# although" this actually wants — the rK-marked 尤も keb picks the right
# entry the same way CORE_ENTRIES' keb-not-reb choices do throughout).
A12_ENTRIES = [
    # Kana-only in normal use, but NOT kana-only entries in JMdict itself —
    # each has a rarely-written k_ele, which is exactly why keb (not reb) is
    # used to find them: find_entry's by-reading index only covers entries
    # with NO k_ele at all (see its own docstring), so a plain reb lookup on
    # any of these silently misses (caught by this file's own missing_a12
    # warning the first time this ran with reb here instead).
    ("したがって", "従って", None), ("なぜなら", "何故なら", None),
    ("それゆえ", "それ故", None),
    ("にもかかわらず", "にも関わらず", None), ("むしろ", "寧ろ", None),
    ("もっとも", "尤も", None), ("要するに", "要するに", None),
    ("つまり", "詰まり", None), ("さらに", "更に", None),
    ("このように", "この様に", None), ("そのため", "その為", None),
    ("ただし", "但し", None), ("考察", "考察", None),
    ("主張", "主張", None), ("根拠", "根拠", None),
    ("結論", "結論", None), ("議論", "議論", None),
    ("反論", "反論", None), ("論点", "論点", None),
    ("観点", "観点", None), ("要因", "要因", None),
    ("傾向", "傾向", None), ("具体的", "具体的", None),
    ("抽象的", "抽象的", None), ("客観的", "客観的", None),
    ("主観的", "主観的", None), ("深刻", "深刻", None),
]

CORE_GROUP_LABEL = "Core"
GROUP_LABELS = {
    "C": "Core",
    "1": "Identity and culture",
    "2": "Local area, holiday and travel",
    "3": "School",
    "4": "Future aspirations, study and work",
    "5": "International and global dimension",
    # Every 'h' (Common words 2) unit lives here, regardless of which theme
    # it belongs to — see unit_group() below and phase 6's comment above.
    "H": "Common words 2",
    # Every A-level unit (A1..A12) lives here — see phase 7's module-
    # docstring comment. Unlike "H", A level isn't a second tile for an
    # existing theme; its 13 units (§2.3's second table) are their own
    # group, the same shape Core already is relative to groups 1-5.
    "A": "A level",
    # "K<n>" units — not part of §2.3's structure at all. See the "Kanji
    # words" section below main(): words already shown on a primary-school
    # kanji's own page (its "Common words" list) that have no vocab entry of
    # their own anywhere above, so tapping "Add" on the kanji page does
    # nothing today. This group exists purely so those words gain a real
    # entry to be added TO — optional bonus reinforcement of words already
    # met, not curriculum.
    "K": "From kanji pages",
}
UNIT_LABELS = {
    "C1": "Classroom and survival", "C2": "Numbers, counters, time, dates",
    "C3": "Question words and pointers", "C4": "Joining words and particles",
    "C5": "The verbs you cannot avoid", "C6": "The adjectives and adverbs you cannot avoid",
    "1.1": "Me, my family and pets", "1.2": "Describing people",
    "1.3": "Friends, relationships, feelings", "1.4": "Free time",
    "1.5": "Phones, media, social media", "1.6": "Food and drink",
    "1.7": "Clothes, shopping and money", "1.8": "Festivals and customs",
    "2.1": "Home and my room", "2.2": "My town and the countryside",
    "2.3": "Directions and getting around", "2.4": "Travel and transport",
    "2.5": "Holidays", "2.6": "Weather and seasons",
    "3.1": "Subjects and the timetable", "3.2": "The school building and kit",
    "3.3": "School life and clubs", "3.4": "Exams and opinions about school",
    "4.1": "Jobs and workplaces", "4.2": "Part-time work and work experience",
    "4.3": "After school", "4.4": "Ambitions and plans",
    "5.1": "Japan and the UK", "5.2": "Environment and nature",
    "5.3": "Global problems and helping", "5.4": "Health and the body",
    # A13 "The set text and film" is deliberately absent — see phase 7's
    # module-docstring comment; it has no keyword list below and would
    # always be empty.
    "A1": "Family and society changing", "A2": "Work and the economy",
    "A3": "Education and young people", "A4": "Media and the digital world",
    "A5": "Arts and popular culture", "A6": "Regions, cities and depopulation",
    "A7": "Environment and disaster", "A8": "Politics and civil society",
    "A9": "Health, welfare and care", "A10": "Immigration and diversity",
    "A11": "History and memory", "A12": "Writing and arguing",
}


def unit_group(unit):
    # A theme's 'h' unit ("2.4h") is grouped by TIER, not by theme — see
    # phase 6's module-docstring comment. Checked before the "C"/"A"/"K"
    # tests only because it's cheap to check first; none of Core, A level or
    # the kanji-words group ever has an 'h' unit of its own.
    if unit.endswith("h"):
        return "H"
    if unit.startswith("A") and unit[1:].isdigit():
        return "A"
    if unit.startswith("K") and unit[1:].isdigit():
        return "K"
    return "C" if unit.startswith("C") else unit.split(".")[0]


# --- Theme classification ---------------------------------------------------
#
# English-gloss keyword matching over the (already frequency-filtered)
# candidate pool. Semi-automatic and imperfect by construction — see
# vocab-plan.md §3.5, which expects exactly this and expects hand-correction
# later. Checked in the order units are listed below; a word is claimed by
# the FIRST unit whose keyword list matches any of its glosses, so more
# specific units (e.g. 2.4 "train station") should be checked before more
# general ones that might also match (kept in mind when ordering below, but
# not perfectly disjoint — some overlap is inevitable with substring
# matching and is a known limitation, not a bug to chase to zero here).
#
# Keywords are matched as whole words against the lowercased, first-two
# glosses of a candidate (see classify()) — plain substring containment,
# not regex, so keep multi-word phrases exact.
THEME_KEYWORDS = {
    "1.1": [
        "father", "mother", "parent", "brother", "sister", "grandfather",
        "grandmother", "grandparent", "son", "daughter", "husband", "wife",
        "family", "cousin", "uncle", "aunt", "sibling", "child", "baby",
        "dog", "cat", "pet", "puppy", "kitten", "goldfish", "rabbit",
        "hamster", "twin", "relative", "nephew", "niece",
    ],
    "1.2": [
        "tall", "short", "hair", "eyes", "beard", "moustache", "handsome",
        "beautiful", "pretty", "cute", "kind", "gentle", "friendly", "shy",
        "cheerful", "lazy", "hard-working", "diligent", "serious", "funny",
        "appearance", "personality", "character", "smile", "slim", "fat",
        "muscular", "wear glasses",
    ],
    "1.3": [
        "friend", "friendship", "quarrel", "argue", "fight", "trust",
        "happy", "sad", "angry", "afraid", "worried", "lonely", "jealous",
        "excited", "nervous", "relationship", "boyfriend", "girlfriend",
        "emotion", "feeling", "love", "hate", "cry", "laugh", "smile",
    ],
    "1.4": [
        "hobby", "sport", "football", "soccer", "baseball", "tennis",
        "swim", "swimming", "run", "jog", "music", "guitar", "piano",
        "sing", "song", "dance", "game", "video game", "read a book",
        "novel", "manga", "comic", "draw", "paint", "photograph", "camera",
        "collect", "team", "club activity", "practice", "leisure",
    ],
    "1.5": [
        "phone", "telephone", "smartphone", "mobile", "app", "internet",
        "website", "e-mail", "email", "message", "text message", "social media",
        "television", "tv", "movie", "film", "video", "youtube", "streaming",
        "screen", "camera", "photo", "upload", "download", "online",
    ],
    "1.6": [
        "food", "eat", "drink", "meal", "breakfast", "lunch", "dinner",
        "restaurant", "menu", "rice", "bread", "meat", "fish", "vegetable",
        "fruit", "chicken", "beef", "pork", "egg", "milk", "tea", "coffee",
        "water", "juice", "sweet", "cake", "chopsticks", "cook", "cooking",
        "recipe", "delicious", "taste", "hungry", "thirsty", "order",
        "waiter", "bill", "noodle", "soup", "curry",
    ],
    "1.7": [
        "clothes", "clothing", "shirt", "trousers", "pants", "skirt",
        "dress", "shoes", "socks", "coat", "jacket", "hat", "size",
        "shop", "store", "buy", "sell", "price", "money", "yen", "pound",
        "expensive", "cheap", "pay", "cash", "receipt", "shopping",
        "wear", "fashion", "wallet",
    ],
    "1.8": [
        "festival", "new year", "birthday", "present", "gift", "custom",
        "tradition", "ceremony", "celebrate", "celebration", "wedding",
        "temple", "shrine", "fireworks", "flower viewing", "holiday",
    ],
    "2.1": [
        "house", "home", "room", "bedroom", "kitchen", "bathroom",
        "garden", "furniture", "table", "chair", "bed", "sofa", "window",
        "door", "wall", "floor", "roof", "clean", "tidy", "chore",
        "apartment", "flat", "living room",
    ],
    "2.2": [
        "town", "city", "village", "countryside", "shop", "store",
        "supermarket", "market", "park", "station", "hospital", "bank",
        "post office", "library", "museum", "building", "street", "road",
        "bridge", "farm", "mountain", "river", "lake", "sea", "forest",
    ],
    "2.3": [
        "left", "right", "straight ahead", "near", "far", "direction",
        "map", "corner", "traffic light", "crossing", "intersection",
        "north", "south", "east", "west", "distance",
    ],
    "2.4": [
        "train", "bus", "bicycle", "bike", "taxi", "airplane",
        "plane", "airport", "ticket", "platform", "railway station", "subway",
        "underground", "ship", "boat", "ride a", "public transport",
        "traffic", "passenger",
    ],
    "2.5": [
        "travel", "trip", "vacation", "holiday", "hotel", "luggage",
        "suitcase", "passport", "tourist", "sightseeing", "abroad",
        "reservation", "book a room", "souvenir", "camp", "camping",
    ],
    "2.6": [
        "weather", "rain", "snow", "wind", "cloud", "sunny", "cloudy",
        "typhoon", "temperature", "hot", "cold", "cool", "warm", "spring",
        "summer", "autumn", "fall", "winter", "season", "forecast", "storm",
        "humid",
    ],
    "3.1": [
        "subject", "mathematics", "maths", "math", "science", "history",
        "geography", "english", "japanese language", "art", "music class",
        "physical education", "timetable", "lesson", "period", "class",
        "textbook", "homework",
    ],
    "3.2": [
        "classroom", "blackboard", "whiteboard", "desk", "chair",
        "school bag", "pencil", "pen", "eraser", "ruler", "notebook",
        "uniform", "gymnasium", "playground", "library", "schoolyard",
    ],
    "3.3": [
        "club activity", "break time", "recess", "school rule", "principal",
        "teacher", "classmate", "student", "term", "semester", "school year",
        "graduate", "graduation", "enter school",
    ],
    "3.4": [
        "exam", "examination", "test", "grade", "score", "mark", "pass",
        "fail", "study for", "result", "report card", "pressure", "stress",
        "opinion", "difficult subject",
    ],
    "4.1": [
        "job", "occupation", "profession", "work", "office", "company",
        "doctor", "nurse", "teacher", "engineer", "police officer",
        "firefighter", "chef", "cook", "lawyer", "salesperson", "employee",
        "employer", "boss", "factory", "farmer",
    ],
    "4.2": [
        "part-time job", "salary", "wage", "pay", "shift", "employee",
        "work experience", "internship", "customer", "duty",
    ],
    "4.3": [
        "university", "college", "apprenticeship", "qualification",
        "application", "apply", "career", "graduate school",
    ],
    "4.4": [
        "future", "dream", "ambition", "hope", "plan", "goal", "become",
        "want to", "wish", "aim",
    ],
    "5.1": [
        "country", "nation", "nationality", "foreign", "abroad", "culture",
        "language", "britain", "england", "japan", "japanese people",
        "compare", "custom",
    ],
    "5.2": [
        "environment", "pollution", "recycle", "recycling", "energy",
        "nature", "animal", "forest", "climate", "global warming",
        "protect", "waste", "plastic", "endangered",
    ],
    "5.3": [
        "poverty", "poor", "charity", "volunteer", "help", "donate",
        "problem", "homeless", "hunger", "disaster", "war", "peace",
    ],
    "5.4": [
        "health", "healthy", "illness", "sick", "disease", "doctor",
        "hospital", "medicine", "body", "head", "arm", "leg", "stomach",
        "exercise", "diet", "sleep", "injury", "pain",
    ],
}


# A level's own themes (vocab-plan.md §2.3's second table, phase 7) — checked
# in a SEPARATE pass over whatever THEME_KEYWORDS above didn't already claim
# (see classify_a() and its call site in main()), so a keyword here can
# safely overlap one above in spirit (e.g. "environment" vs 5.2's own) since
# a given candidate word can only ever be classified once, by whichever pass
# reaches it first. Picked and spot-checked against JMdict's actual gloss
# wording rather than just semantically-plausible English — e.g. "national
# diet" (Japan's parliament) was dropped in favour of "parliament"/"cabinet
# minister" because plain "diet" already belongs to 5.4's food sense above
# and would misroute every match to Health and the body instead.
THEME_KEYWORDS_A = {
    "A1": [
        "marriage", "married", "divorce", "birth rate", "birthrate",
        "aging society", "ageing society", "elderly", "nuclear family",
        "gender equality", "gender role", "child-rearing", "childcare",
        "pension", "generation gap", "household", "population decline",
        "unmarried", "spouse", "single-person",
    ],
    "A2": [
        "unemployment", "recession", "inflation", "deflation", "wage",
        "labor market", "labour market", "lifetime employment", "overtime",
        "resignation", "retirement", "workforce", "gross domestic product",
        "export", "import", "trade deficit", "trade surplus",
        "work-life balance", "corporation", "economic growth",
    ],
    "A3": [
        "cram school", "curriculum", "bullying", "truancy", "truant",
        "juvenile delinquency", "adolescent", "tutoring", "scholarship",
        "academic pressure", "entrance examination",
    ],
    "A4": [
        "mass media", "journalism", "broadcast", "misinformation",
        "fake news", "artificial intelligence", "cyberspace", "cybercrime",
        "online privacy", "surveillance camera", "algorithm", "censorship",
        "social networking service", "live streaming",
    ],
    "A5": [
        "novelist", "poetry", "manga artist", "animation", "film director",
        "fine arts", "exhibition", "subculture", "popular culture",
        "entertainment industry", "celebrity", "otaku",
    ],
    "A6": [
        "depopulation", "rural area", "urban area", "metropolitan area",
        "regional revitalization", "migration", "prefecture", "ghost town",
        "urbanization", "overcrowding",
    ],
    "A7": [
        "tsunami", "natural disaster", "volcanic eruption", "climate change",
        "global warming", "renewable energy", "nuclear power plant",
        "carbon dioxide", "taking refuge", "evacuation shelter",
        "flooding", "drought", "ecosystem",
    ],
    "A8": [
        "parliament", "cabinet minister", "general election",
        "political party", "democracy", "constitution", "demonstration",
        "protest", "human rights", "civil rights",
        "non-governmental organization", "referendum", "diplomacy",
    ],
    "A9": [
        "nursing care", "caregiver", "elderly care", "hospice",
        "disability", "mental illness", "social security", "health insurance",
        "nursing home", "life expectancy",
    ],
    "A10": [
        "immigration", "immigrant", "multicultural", "cultural diversity",
        "refugee", "ethnic minority", "racial discrimination", "xenophobia",
        "assimilation", "foreign resident", "coexist", "minority group",
        "ethnic discrimination", "naturalization", "naturalisation",
        "asylum", "illegal immigration", "migrant worker", "cultural exchange",
        "internationalization", "internationalisation", "stateless",
        "prejudice", "prejudiced", "stereotype",
    ],
    "A11": [
        "world war", "postwar", "occupation", "atomic bomb", "colonial",
        "war memorial", "wartime", "reconstruction", "war crime",
        "testimony", "legacy",
    ],
}


def classify_a(candidate):
    """A-level counterpart of classify() — same shape, own keyword table.
    Kept separate rather than merged into one dict-of-dicts: the two passes
    run at different points in main() over different remaining pools (see
    phase 7's module-docstring comment), and keeping them as two flat dicts
    means neither classify() nor THEME_KEYWORDS needs to know phase 7
    exists at all."""
    if looks_like_proper_noun(candidate["glosses"]):
        return None
    text = " ".join(candidate["glosses"][:2]).lower()
    for unit, keywords in THEME_KEYWORDS_A.items():
        if any(_kw_re(kw).search(text) for kw in keywords):
            return unit
    return None


WORD_BOUNDARY_CACHE = {}


def _kw_re(kw):
    if kw not in WORD_BOUNDARY_CACHE:
        WORD_BOUNDARY_CACHE[kw] = re.compile(r"\b" + re.escape(kw) + r"\b")
    return WORD_BOUNDARY_CACHE[kw]


PROPER_NOUN_RE = re.compile(r"\b[A-Z][a-zA-Z]*\b")


def looks_like_proper_noun(glosses):
    """Keyword matching runs on LOWERCASED text (so "House of Councillors"
    can match a plain keyword "house"), which throws away the one signal
    that would have caught it: JMdict only capitalises genuine proper nouns
    and institution names — 2+ capitalised words in the first gloss ("House
    of Representatives", "Ministry of Labour", "Japan Defense Agency") is
    reliably that, not a common word that happens to start a sentence (an
    ordinary gloss is lowercase throughout, e.g. "train", "kindergarten").
    Filtered out of the classification pool entirely rather than assigned to
    a unit — an administrative-institution word is not GCSE-style vocabulary
    regardless of which topic keyword it happened to also contain."""
    return len(PROPER_NOUN_RE.findall(glosses[0])) >= 2


def classify(candidate):
    """First theme unit (in THEME_KEYWORDS' own order) whose keyword list
    matches any of this candidate's first two glosses. None if nothing
    matches — an unmatched word is simply left out of this first pass rather
    than forced into a wrong unit; see the module docstring."""
    if looks_like_proper_noun(candidate["glosses"]):
        return None
    text = " ".join(candidate["glosses"][:2]).lower()
    for unit, keywords in THEME_KEYWORDS.items():
        if any(_kw_re(kw).search(text) for kw in keywords):
            return unit
    return None


# --- Per-word generation: ruby, mis (reading distractors), sp (spelling
# --- distractors) -----------------------------------------------------------

def build_ruby(surface, reading, kanjidic, stem_index, quiz_readings):
    """vocab-plan.md §3.2/§4.5: per-kanji [pos, displayed_kana, credits?]
    triples, or None for a word with no kanji at all, or one that could not
    be aligned (jukujikun — 大人, 今日, ...). `credits`, when present, is the
    exact string form that appears in that kanji's OWN quizReadings — see
    load_kanji_quiz_data — so a correct, unrevealed answer can write straight
    to `recognition:<kanji>:<credits>` at runtime with no further lookup."""
    if not any(is_kanji(ch) for ch in surface):
        return None
    alignment = align_word(surface, reading, stem_index)
    if alignment is None:
        return None
    spans = segment_spans(surface, alignment)
    ruby = []
    for pos, _seg, start_j, end_j in spans:
        kanji = surface[pos]
        displayed = reading[start_j:end_j]
        credited = credited_reading(kanjidic[kanji], _seg, surface, pos)
        entry = [pos, displayed]
        if credited and credited in quiz_readings.get(kanji, ()):
            entry.append(credited)
        ruby.append(entry)
    return ruby


def build_mis(surface, reading, spans, kanjidic, homograph_readings):
    """vocab-plan.md §5.4 (was §5.3): up to MAX_MIS wrong kana readings for
    the yomi follow-up question. For each kanji position, splice in one of
    that kanji's OTHER on/kun readings (or a rendaku/handakuten toggle of its
    OWN correct one), leaving the rest of the word's reading untouched — see
    segment_spans above for why that splice is safe. Never the correct
    reading, and never another real word's reading for the same surface
    (homograph_readings) — that would be marking a right answer wrong."""
    candidates = []
    for pos, seg, start_j, end_j in spans:
        kanji = surface[pos]
        info = kanjidic.get(kanji)
        if not info:
            continue
        # Other readings contribute their PLAIN form only — voicing/gemination
        # toggles are applied below, but only to the kanji's own correct
        # reading. Toggling every alternate too (an earlier version of this
        # did) produces a combinatorial pile of forms nobody would plausibly
        # guess (ぱべる, ぐべる for 食べる) — the plan's intent (でんぐるま) is
        # specifically "another real reading" OR "this reading, mis-voiced",
        # not both compounded together.
        alt_stems = set()
        for raw in info["on"] + info["kun"]:
            stem, _okuri = reading_parts(raw)
            if stem:
                alt_stems.add(kata_to_hira(stem))
        alt_stems.discard(seg)
        # Rendaku/handakuten/gemination toggle of the kanji's OWN correct
        # segment — the でんぐるま-style distractor where the substitution is
        # "this reading, but voiced/unvoiced" rather than a different reading.
        alt_stems |= (stem_variants(seg) - {seg})
        # Sorted, not raw set order: Python randomises string hashing per
        # process, so iterating the set directly fed random.shuffle a
        # different starting order on every run and `mis` came out reordered
        # even when nothing had changed — churning hundreds of entries per
        # rebuild despite the fixed seed at the top of this file.
        for alt in sorted(alt_stems):
            candidate = reading[:start_j] + alt + reading[end_j:]
            if candidate == reading:
                continue
            candidates.append(candidate)
    bad = homograph_readings.get(surface, set())
    out, seen = [], set()
    for c in candidates:
        if c in seen or c in bad or c == reading:
            continue
        seen.add(c)
        out.append(c)
    random.shuffle(out)
    return out[:MAX_MIS]


STOP_GLOSS_TOKENS = {
    "a", "an", "the", "to", "of", "in", "on", "for", "or", "and", "with",
    "is", "be", "esp", "etc", "usu", "one", "someone", "something",
}


def gloss_tokens(glosses):
    text = " ".join(glosses[:2]).lower()
    return {w for w in re.findall(r"[a-z]+", text) if w not in STOP_GLOSS_TOKENS}


def build_sp(surface, glosses, spans, all_kebs, reading_to_kanji, taught_kanji, kanji_only_pool):
    """vocab-plan.md §6.3: up to MAX_SP candidate wrong spellings for the
    Recall spelling stage. Two shapes, per the surface's own composition.

    Mixed kanji+kana (食べる): swap ONE kanji character for another, keeping
    every other character — including the okurigana — identical. Preferring
    a substitute that is itself readable the SAME WAY the original kanji was
    AT THAT POSITION — looked up via `spans` (the position's actual reading
    segment, e.g. "た" for 食 in 食べる, not the character 食 itself) against
    `reading_to_kanji` — so the substitute cannot be eliminated by the
    reading the learner just produced. `spans` is empty for a jukujikun word
    (alignment failed — see build_ruby), which falls straight through to the
    any-taught-kanji fallback for every position; that is intended, not a
    special case: there is no "this position's reading" to match against.

    Kanji-only (電車): real JMdict words of the SAME kanji count, built from
    `kanji_only_pool`, excluding anything whose gloss shares a content word
    with the target's own gloss (a synonym would be marking a right answer
    wrong).

    Either shape: a generated mixed-word candidate is discarded if it turns
    out to already be a real word (`all_kebs`) — see the module docstring on
    why membership-in-JMdict-at-all is the check, not a reading match.
    """
    kanji_positions = [i for i, ch in enumerate(surface) if is_kanji(ch)]
    if not kanji_positions:
        return []

    if KANJI_ONLY_RE.match(surface):
        pool = kanji_only_pool.get(len(surface), [])
        target_tokens = gloss_tokens(glosses)
        target_chars = set(surface)
        shared, other = [], []
        for cand_keb, cand_tokens, _rank in pool:
            if cand_keb == surface:
                continue
            if target_tokens & cand_tokens:
                continue  # likely synonym — would mark a right answer wrong
            (shared if target_chars & set(cand_keb) else other).append(cand_keb)
        # Sharing a kanji with the target always wins (电car/汽车-style — a
        # candidate that LOOKS like a plausible spelling of the same idea).
        # A single-kanji word can never land in that tier (a 1-character
        # candidate either IS the target or shares nothing), which would
        # otherwise mean every one-kanji word draws from the SAME top-ranked
        # slice of the pool regardless of its own meaning — shuffled rather
        # than rank-sorted, so different one-kanji words at least get
        # different distractor sets across a build.
        random.shuffle(shared)
        random.shuffle(other)
        return (shared + other)[:MAX_SP]

    # Mixed kanji + kana.
    seg_by_pos = {pos: seg for pos, seg, _s, _e in spans}
    out, seen = [], set()
    for i in kanji_positions:
        original = surface[i]
        seg = seg_by_pos.get(i)
        same_reading = sorted(reading_to_kanji.get(seg, set()) - {original}) if seg else []
        random.shuffle(same_reading)
        fallback = list(taught_kanji)
        random.shuffle(fallback)
        for substitute in same_reading + fallback:
            if substitute == original:
                continue
            candidate = surface[:i] + substitute + surface[i + 1:]
            if candidate in seen or candidate == surface or candidate in all_kebs:
                continue
            seen.add(candidate)
            out.append(candidate)
            if len([c for c in out]) >= MAX_SP:
                break
        if len(out) >= MAX_SP:
            break
    return out[:MAX_SP]


# --- Example sentences (Tanaka Corpus) --------------------------------------
#
# Up to three real sentences per word, glossed the way this app glosses
# Japanese everywhere else: furigana over every kanji in them, an English
# translation of the whole sentence, and — since everything in this app that
# can be tapped is tapped — every word in the sentence its own tap target,
# with its reading, its dictionary form and what it means.
#
# THREE, not one. A single sentence is a single usage, and one usage is often
# the least representative thing about a word: ご招待をありがとうございます is a
# correct and useful sentence for 招待, but it is a set phrase and says nothing
# about 招待する. Three sentences, chosen to differ from each other (see
# choose_examples), stand a much better chance of covering how a word is
# actually used.
#
# SOURCE: the Tanaka Corpus as distributed with WWWJDIC (examples.utf),
# ~148,000 Japanese/English pairs, from the same EDRDG family of sources as
# JMdict and KANJIDIC2 above. Chosen over Tatoeba's own larger export for one
# reason: every sentence here carries an index line naming the dictionary
# form of each word in it, with a reading wherever that form is ambiguous. No
# Japanese tokeniser is available to this build (the story data's own header
# says the same thing), and without one that index is the only way to put
# furigana over a whole SENTENCE — or to make every word in one tappable.
#
# ACCURACY: a wrong reading taught confidently is worse than no example at
# all, so a reading comes from, in order: the index line's own annotation
# (which the corpus adds precisely where a written form is ambiguous — 人, 日
# and 中 carry one on essentially every occurrence); failing that, the reading
# the corpus itself uses most often for that form elsewhere; failing that,
# JMdict's first-listed reading, and only then counted as certain if JMdict
# lists exactly one. A sentence needing a guess is scored down rather than
# banned; one that leaves any kanji unglossed is used only when nothing better
# exists — and never when the unglossed kanji is in the taught word itself.
#
# WHAT MAKES A GOOD EXAMPLE, in the order these matter:
#   - it is not an idiom or proverb. 一寸の虫にも五分の魂 ("tread on a worm and
#     it will turn") is a fine proverb and a terrible example sentence: it is
#     non-literal, partly archaic, and its English translation teaches nothing
#     about any word in it. JMdict tags these (proverb/id/quote/yoji) and
#     IDIOM_PENALTY all but removes them; where one survives because a word
#     has nothing else (一寸 is itself almost only used idiomatically), it is
#     marked `"i": 1` so the app can label it as an idiom rather than pass it
#     off as ordinary usage.
#   - its translation is literal. A translation far shorter than its Japanese
#     is usually an idiomatic equivalent rather than a rendering of what the
#     sentence says, which is no use to a learner trying to match the two.
#   - the REST of its words are words this app teaches, so the sentence can
#     actually be pieced together rather than merely read past.
#   - it is short, and the corpus flags it as a good example of this word.

EXAMPLES_PER_WORD = 3
EXAMPLE_LEN_IDEAL = 18  # characters of Japanese: a real sentence, still one phone line
EXAMPLE_LEN_RANGE = (6, 44)
EXAMPLE_LEN_RANGE_RELAXED = (6, 70)  # second pass, for a word few sentences contain
EXAMPLE_EN_MAX = 110
EXAMPLE_EN_MAX_RELAXED = 140
EXAMPLE_CANDIDATE_READINGS = 4  # JMdict readings tried per written form before giving up
EXAMPLE_SHORTLIST = 20  # candidates kept per word for choose_examples to pick from
EXAMPLE_GLOSS_MAX = 60  # characters of English per word in the tap-a-word glossary

IDIOM_PENALTY = 60.0     # enough that an idiom is only ever a last resort
# English characters per Japanese character. A literal translation runs about
# 2.5; well under that, the English is giving the sentence's SENSE rather than
# saying what it says ("滑り出しが好調なら事は半ば成就したのに等しい。" = "Well
# begun is half done."), which is no use to a learner trying to match the two
# halves up. Penalised below the first, refused below the second.
LITERAL_MIN_RATIO = 1.6
LITERAL_FLOOR_RATIO = 1.2
LITERAL_PENALTY = 25.0
FAMILIAR_WEIGHT = 20.0   # applied to the share of a sentence's words that this app teaches
SAME_FORM_PENALTY = 15.0 # a second sentence using the taught word in the same written form as one already picked
OVERLAP_PENALTY = 25.0   # applied to the share of words a candidate shares with one already picked

# "headword(reading)[sense]{surface as written}~", everything after the
# headword optional. The reading slot doubles as an entry-id slot on some
# tokens ("で(#2028980)"), which is not a reading but does say exactly which
# JMdict entry is meant — see glossary_key.
B_TOKEN_RE = re.compile(r"^([^()\[\]{}~]+)(?:\(([^)]*)\))?(?:\[(\d+)\])?(?:\{([^}]*)\})?(~)?$")

# A run of characters that one indivisible reading can sit over. Digits and
# the repeat mark 々 belong to it: ４月 is しがつ across both characters and
# 人々 is ひとびと across both, and neither divides per character.
KANJI_RUN_RE = re.compile(r"[㐀-䶿一-鿿々0-9０-９]+")

SENTENCE_END_RE = re.compile(r"[。．.!！?？…]+$")

# Quoted dialogue and trailing-off ellipses: a corpus sentence built out of
# these is usually a fragment of a conversation rather than a sentence that
# stands on its own, which is what an example has to be.
FRAGMENTARY_RE = re.compile(r"[「」『』]")
FRAGMENTARY_PENALTY = 18.0
# Not a penalty but a rule: a sentence that trails off is not a sentence, and
# no amount of being the only candidate makes one a good example.
ELLIPSIS_RE = re.compile(r"・・・|\.\.\.|…|〜$|～$")

# This is an app for children (see README). The corpus is a general-purpose
# translation corpus and has plenty in it that is not for them, so a sentence
# whose English hits this is passed over. The taught word is exempt from its
# own filter (see build_examples): 戦争 is in the curriculum, and a word
# meaning "war" cannot be given an example that avoids saying "war".
UNSUITABLE_EN = re.compile(
    r"\b(sex|sexual|rape|raped|porn|nude|naked|breast|breasts|penis|virgin|"
    r"kill|kills|killed|killing|murder|murdered|suicide|corpse|slaughter|"
    r"drunk|drunken|beer|whisky|whiskey|wine|liquor|alcohol|cigarette|cigarettes|smoking|"
    r"drug|drugs|heroin|cocaine|damn|damned|hell|bastard|bitch|shit|fuck|"
    r"prostitute|prostitution|brothel|mistress|adultery|abortion|"
    r"gun|guns|pistol|rifle|shoot|bomb|bombs|stabbed|bullet|bullets|knife|"
    r"wound|wounded|weapon|weapons|drinking|drank|sake|pub|tavern|tobacco|cigar|"
    r"idiot|stupid|fool|ugly|divorce|divorced|hate|hates|hated|toilet|toilets)\b", re.I)


def example_gloss(glosses):
    """A word's meaning, short enough to sit under a sentence on a phone.
    Up to three senses; a trailing parenthetical is dropped before the string
    is cut, since that usually recovers the plain meaning intact (the same
    trick shorten_label makes for the quiz's answer labels)."""
    text = ", ".join(glosses[:3])
    if len(text) > EXAMPLE_GLOSS_MAX:
        text = ", ".join(glosses[:2])
    if len(text) > EXAMPLE_GLOSS_MAX:
        text = re.sub(r"\s*\([^()]*\)\s*$", "", glosses[0]).strip() or glosses[0]
    if len(text) > EXAMPLE_GLOSS_MAX:
        text = text[:EXAMPLE_GLOSS_MAX - 1].rstrip() + "…"
    return text


def parse_examples():
    """(sentences, prior): sentences as (japanese, english, tokens), plus the
    corpus's own majority reading for every written form it ever annotates."""
    if not EXAMPLES.exists():
        raise SystemExit(f"Missing {EXAMPLES} — run tools/fetch_kanji_sources.sh first.")
    lines = EXAMPLES.read_text(encoding="utf-8").split("\n")
    sentences = []
    seen_readings = defaultdict(Counter)
    i = 0
    while i < len(lines) - 1:
        if not lines[i].startswith("A: "):
            i += 1
            continue
        japanese, _, rest = lines[i][3:].partition("\t")
        english = rest.split("#ID=")[0].strip()
        tokens = []
        for raw in lines[i + 1][3:].split(" "):
            m = B_TOKEN_RE.match(raw) if raw else None
            if not m:
                continue
            head, reading, sense, surface, good = m.groups()
            seq = None
            if reading and reading.startswith("#"):
                seq, reading = reading[1:], None  # an entry id, not a reading
            reading = kata_to_hira(reading) if reading else None
            tokens.append({"head": head, "reading": reading, "seq": seq,
                           "sense": int(sense) if sense else None,
                           "surface": surface or head, "good": bool(good)})
            if reading:
                seen_readings[head][reading] += 1
        sentences.append((japanese, english, tokens))
        i += 2
    prior = {head: counts.most_common(1)[0][0] for head, counts in seen_readings.items()}
    print(f"Tanaka Corpus: {len(sentences)} sentences, "
          f"{len(prior)} written forms with an observed reading")
    return sentences, prior


def resolve_reading(head, annotated, keb_readings, prior):
    """(reading, certain) for one dictionary form as used here — the three
    sources of the ACCURACY note above, in that order."""
    if annotated:
        return annotated, True
    if head in prior:
        return prior[head], True
    listed = keb_readings.get(head, [])
    if not listed:
        return None, False
    return listed[0], len(listed) == 1


def example_token_ruby(head, annotated, surface, keb_readings, prior, stem_index):
    """([(pos_in_surface, length, kana)], certain) for one word of a sentence,
    or None when its reading could not be established. An empty list means
    there was nothing to gloss — the word is written in kana."""
    if not any(is_kanji(ch) for ch in surface):
        return [], True
    head_last = max((i for i, ch in enumerate(head) if is_kanji(ch)), default=-1)
    surface_last = max((i for i, ch in enumerate(surface) if is_kanji(ch)), default=-1)
    # Inflection only ever rewrites the okurigana AFTER the last kanji, so
    # everything up to and including it has to match for the dictionary form's
    # alignment to carry across to the inflected form unchanged. 書き留める ->
    # 書き留めた is that same word bent; 召使い -> 召し使い is a different
    # spelling of it, and lining those two up slides every reading along by a
    # character.
    if head_last < 0 or head[:head_last + 1] != surface[:surface_last + 1]:
        return None
    first, certain = resolve_reading(head, annotated, keb_readings, prior)
    listed = keb_readings.get(head, [])[:EXAMPLE_CANDIDATE_READINGS]
    for reading in [first] + [r for r in listed if r != first]:
        if not reading:
            continue
        # Per kanji wherever the reading divides (生活 -> 生[せい]活[かつ]),
        # exactly as build_ruby splits a headword for the word screens.
        for wildcards in (0, 1):
            alignment = align_word(head, reading, stem_index, wildcards=wildcards)
            if alignment:
                return [(pos, 1, kana) for pos, kana in alignment], certain
        # Jukujikun (風邪 = かぜ, 昨日 = きのう): no per-kanji division exists,
        # so one reading sits over the whole run — the same fallback the word
        # screens make when build_ruby comes back None, applied to a word
        # inside a sentence rather than to the headword itself.
        runs = [m.span() for m in KANJI_RUN_RE.finditer(head)]
        if len(runs) == 1:
            start, end = runs[0]
            before, after = head[:start], head[end:]
            if reading.startswith(before) and reading.endswith(after) \
                    and len(reading) > len(before) + len(after):
                inner = reading[len(before):len(reading) - len(after)] if after else reading[len(before):]
                return [(start, end - start, inner)], certain
        certain = False  # anything past the first candidate is a guess by definition
    return None


def locate_tokens(japanese, tokens):
    """[(start, token)] — where each word of the index line actually sits in
    the sentence. The index lists them in the order they appear, so searching
    forward from the end of the last one keeps a word that occurs twice (は,
    人) on its own copy of itself. A token the sentence doesn't contain (the
    two occasionally disagree) is dropped."""
    placed = []
    cursor = 0
    for token in tokens:
        at = japanese.find(token["surface"], cursor)
        if at < 0:
            at = japanese.find(token["surface"])
            if at < 0:
                continue
        cursor = at + len(token["surface"])
        placed.append((at, token))
    return placed


def example_ruby(japanese, tokens, keb_readings, prior, stem_index):
    """(ruby, unglossed, guesses) for a whole sentence. `ruby` is a list of
    [start, length, kana] over the sentence string — the same shape as a
    word's own `ruby`, widened to a span because a sentence contains readings
    that do not divide character by character."""
    ruby = []
    guesses = 0
    for at, token in locate_tokens(japanese, tokens):
        resolved = example_token_ruby(token["head"], token["reading"], token["surface"],
                                      keb_readings, prior, stem_index)
        if resolved is None:
            continue
        segments, certain = resolved
        if segments and not certain:
            guesses += 1
        for offset, length, kana in segments:
            ruby.append([at + offset, length, kana])
    ruby.sort()
    glossed = {pos for start, length, _ in ruby for pos in range(start, start + length)}
    unglossed = tuple(i for i, ch in enumerate(japanese) if is_kanji(ch) and i not in glossed)
    return ruby, unglossed, guesses


def glossary_key(token, reading, example_glosses, example_senses, keb_readings):
    """Which entry of the tap-a-word glossary this word of a sentence means,
    or None if JMdict has nothing for it.

    Built up in layers, each added only when it pins something down: the
    written form; "開く|ひらく" when that form has more than one reading;
    "で#2028980" when the corpus names the exact JMdict entry (it does this
    for the particles, where a bare で would as likely find the copula); and
    a trailing "@3" when the corpus names a sense other than the first (と is
    "if, when" in sense 1 and "with" in sense 3, and which one a sentence
    means is not something a dictionary lookup can recover). The app strips
    at the first of | # @ to get the dictionary form back to display — none
    of the three occurs in Japanese, which is what makes them safe.
    """
    head = token["head"]
    key = None
    if token["seq"] and f"{head}#{token['seq']}" in example_glosses:
        key = f"{head}#{token['seq']}"
    elif reading and len(keb_readings.get(head, [])) > 1 and f"{head}|{reading}" in example_glosses:
        key = f"{head}|{reading}"
    elif head in example_glosses:
        key = head
    if key is None:
        return None
    sense = token["sense"]
    if sense and sense > 1 and len(example_senses.get(key, ())) >= sense:
        return f"{key}@{sense}"
    # An unannotated particle is the one case where a single sense is worse
    # than none of them. と is six senses in one entry — "if", "and", "with",
    # quoting — the corpus only names which one about a third of the time,
    # and a learner tapping と wants to know it is that whole range, not to
    # be told flatly that it means "if". "@*" is every sense at once; see the
    # glossary construction in build_examples.
    if not sense and len(example_senses.get(key, ())) > 1 \
            and len(head) <= 2 and not any(is_kanji(ch) for ch in head):
        return f"{key}@*"
    return key


def example_words(japanese, tokens, keb_readings, prior, example_glosses, example_senses):
    """[[start, length] or [start, length, key]] — every word of the sentence
    the app can make tappable, in order. The key is left off when it is the
    written form itself, which is the common case and the whole reason this
    is not simply a list of keys."""
    spans = []
    for at, token in locate_tokens(japanese, tokens):
        surface = token["surface"]
        reading, _certain = resolve_reading(token["head"], token["reading"], keb_readings, prior)
        key = glossary_key(token, reading, example_glosses, example_senses, keb_readings)
        if key is None:
            continue
        spans.append([at, len(surface)] if key == surface else [at, len(surface), key])
    return spans


def example_score(japanese, english, unglossed, guesses, flagged, as_written,
                  is_idiom, familiar):
    """Bigger is better. The ideal being scored against: a short, fully
    glossed, literally translated sentence made of words this app teaches,
    flagged by the corpus as a good example of the word, using it in the form
    the learner is taught. See the WHAT MAKES A GOOD EXAMPLE note above."""
    score = 40.0 if not unglossed else -12.0 * len(unglossed)
    score -= 6.0 * guesses
    score += 12.0 if flagged else 0.0
    score += 10.0 if as_written else 0.0
    score -= abs(len(japanese) - EXAMPLE_LEN_IDEAL) * 1.2
    score -= max(0, len(english) - 60) * 0.15
    if is_idiom:
        score -= IDIOM_PENALTY
    if FRAGMENTARY_RE.search(japanese):
        score -= FRAGMENTARY_PENALTY
    if len(english) / len(japanese) < LITERAL_MIN_RATIO:
        score -= LITERAL_PENALTY
    score += FAMILIAR_WEIGHT * familiar
    return score


def familiar_share(tokens, taught_forms):
    """What fraction of a sentence's words the learner could already know:
    words this app teaches, plus the kana-only grammar (particles, copula,
    する/ある) that no vocabulary list needs to cover for a sentence to be
    readable. This is what "piece a sentence together from what you know"
    actually measures."""
    if not tokens:
        return 0.0
    known = sum(1 for t in tokens
                if t["head"] in taught_forms or not any(is_kanji(ch) for ch in t["head"]))
    return known / len(tokens)


def choose_examples(shortlist, sentences):
    """Up to EXAMPLES_PER_WORD sentences that are each good AND unlike the
    others. Greedy: take the best, then re-rank what is left against what has
    already been taken, penalising a sentence that uses the taught word in the
    same written form as one already chosen (招待し after 招待し teaches nothing
    new about 招待する) or that is largely the same words in the same order."""
    remaining = sorted(shortlist, reverse=True)
    picked = []
    seen = set()
    while remaining and len(picked) < EXAMPLES_PER_WORD:
        best_index, best_adjusted = None, None
        for index, (score, sentence_index, written) in enumerate(remaining):
            # The corpus holds the same pair more than once under different
            # ids, and two copies of one sentence is not two examples. A
            # rule rather than a penalty: a duplicate is never acceptable,
            # however much better than the alternatives it scores.
            if sentences[sentence_index][0] in seen:
                continue
            adjusted = score
            words = {t["head"] for t in sentences[sentence_index][2]}
            for _s, picked_index, picked_written in picked:
                if written == picked_written:
                    adjusted -= SAME_FORM_PENALTY
                picked_words = {t["head"] for t in sentences[picked_index][2]}
                if words and picked_words:
                    overlap = len(words & picked_words) / min(len(words), len(picked_words))
                    adjusted -= OVERLAP_PENALTY * overlap
            if best_adjusted is None or adjusted > best_adjusted:
                best_index, best_adjusted = index, adjusted
        if best_index is None:
            break  # everything left is a copy of something already picked
        chosen = remaining.pop(best_index)
        seen.add(sentences[chosen[1]][0])
        picked.append(chosen)
    return picked


def build_examples(unit_records, keb_readings, stem_index, example_glosses,
                   example_senses, idiomatic):
    """Give every word the `ex` sentences its detail screen shows, wherever
    the corpus has them, and return the glossary the app needs to answer a tap
    on any word inside one.

    Two passes over the same sentences: the first insists on a short one with
    furigana over every kanji in it; the second, for a word the first found
    fewer than EXAMPLES_PER_WORD of, will take a longer sentence, or one with
    an unglossed kanji elsewhere in it, or the word appearing inside a longer
    token instead of as one of its own — but never a sentence that fails to
    gloss the taught word itself."""
    sentences, prior = parse_examples()

    # (surface, reading) -> every record teaching that word; a word can be
    # taught in more than one unit, and all of its records get the same
    # sentences. Records are held by reference and written into directly.
    records_for = defaultdict(list)
    glosses = {}
    for records in unit_records.values():
        for record in records:
            records_for[(record["w"], record["r"])].append(record)
            glosses[(record["w"], record["r"])] = " ".join(record["en"]).lower()
    taught_forms = {surface for surface, _reading in records_for}
    wanted = defaultdict(set)
    for surface, reading in records_for:
        wanted[surface].add(reading)
    total = len(records_for)

    ruby_cache = {}   # sentence index -> (unglossed, guesses); the ruby itself is rebuilt for the few that are chosen
    idiom_cache = {}
    familiar_cache = {}
    shortlists = defaultdict(list)
    shortlist_texts = defaultdict(set)

    def pass_over(relaxed):
        min_len, max_len = EXAMPLE_LEN_RANGE_RELAXED if relaxed else EXAMPLE_LEN_RANGE
        max_en = EXAMPLE_EN_MAX_RELAXED if relaxed else EXAMPLE_EN_MAX
        for index, (japanese, english, tokens) in enumerate(sentences):
            if not english or not (min_len <= len(japanese) <= max_len) or len(english) > max_en:
                continue
            if ELLIPSIS_RE.search(japanese):
                continue
            if len(english) / len(japanese) < LITERAL_FLOOR_RATIO:
                continue
            # (surface, token, token-is-the-dictionary-form). A None token is
            # the relaxed pass's "the word is in there somewhere" — 予備校
            # inside a longer token the index never breaks up.
            hits = []
            for token in tokens:
                if token["head"] in wanted:
                    hits.append((token["head"], token, True))
                if token["surface"] != token["head"] and token["surface"] in wanted:
                    hits.append((token["surface"], token, False))
            if relaxed and not hits:
                # Whole words only. Unchecked, this finds the noun 買い
                # ("buying") inside 買う{買いました} and offers three sentences
                # about buying things as examples of a noun none of them
                # contains, or the word 宿駅 inside the place name 新宿駅.
                # The index's own token edges are the only word boundaries
                # Japanese offers; where a word sits inside a token rather
                # than at its edge, the character alongside decides. A
                # hiragana one after it is okurigana continuing a word
                # (買い|ました); a kanji one before it is the other half of a
                # compound (新|宿駅). Either way what was found is not the
                # word being looked for. A kanji after it, on the other hand,
                # is a compound this word is genuinely part of (予備校|生).
                edges = locate_tokens(japanese, tokens)
                starts = {at for at, _t in edges}
                ends = {at + len(t["surface"]) for at, t in edges}
                for word in wanted:
                    at = japanese.find(word)
                    if at < 0:
                        continue
                    end = at + len(word)
                    if at not in starts and (at == 0 or is_kanji(japanese[at - 1])):
                        continue
                    if end not in ends and (end == len(japanese) or KANA_ONLY_RE.match(japanese[end])):
                        continue
                    hits.append((word, None, False))
            if not hits:
                continue
            for surface, token, is_head in hits:
                for reading in wanted[surface]:
                    # The sentence has to read the word the way THIS entry
                    # says it is read: 開く is ひらく in one entry and あく in
                    # another, and a sentence belongs to only one of them.
                    if is_head and any(is_kanji(ch) for ch in surface):
                        used, _certain = resolve_reading(surface, token["reading"], keb_readings, prior)
                        if used is not None and used != reading:
                            continue
                    # Matched on the written form rather than the dictionary
                    # form, which is right for a spelling variant (今日は
                    # written こんにちは — the index's own word, read the same)
                    # and wrong for a collision (the noun 買い, "buying", is
                    # not what 買う{買い}たい contains). The index's word has
                    # to be read the way this entry is for it to BE this
                    # entry.
                    elif token is not None and not is_head:
                        head_reading, _certain = resolve_reading(
                            token["head"], token["reading"], keb_readings, prior)
                        if head_reading != reading:
                            continue
                    gloss = glosses[(surface, reading)]
                    if any(m.group(0).lower() not in gloss for m in UNSUITABLE_EN.finditer(english)):
                        continue
                    if index not in ruby_cache:
                        _ruby, unglossed, guesses = example_ruby(
                            japanese, tokens, keb_readings, prior, stem_index)
                        ruby_cache[index] = (unglossed, guesses)
                        idiom_cache[index] = SENTENCE_END_RE.sub("", japanese) in idiomatic
                        familiar_cache[index] = familiar_share(tokens, taught_forms)
                    unglossed, guesses = ruby_cache[index]
                    written = token["surface"] if token else surface
                    if unglossed:
                        if not relaxed:
                            continue
                        at = japanese.find(written)
                        if at >= 0 and any(at <= pos < at + len(written) for pos in unglossed):
                            continue
                    score = example_score(japanese, english, unglossed, guesses,
                                          bool(token) and token["good"],
                                          bool(token) and token["surface"] == surface,
                                          idiom_cache[index], familiar_cache[index])
                    # A bounded worst-first heap of the best candidates so
                    # far, kept free of the corpus's duplicate pairs (the
                    # same sentence appears under several ids) so that 20
                    # candidates really are 20 different sentences for
                    # choose_examples to pick three unlike ones from.
                    shortlist = shortlists[(surface, reading)]
                    texts = shortlist_texts[(surface, reading)]
                    if japanese in texts:
                        continue
                    candidate = (score, index, written)
                    if len(shortlist) < EXAMPLE_SHORTLIST:
                        heapq.heappush(shortlist, candidate)
                        texts.add(japanese)
                    elif candidate > shortlist[0]:
                        texts.discard(sentences[heapq.heapreplace(shortlist, candidate)[1]][0])
                        texts.add(japanese)

    pass_over(relaxed=False)
    strict_full = sum(1 for lst in shortlists.values() if len(lst) >= EXAMPLES_PER_WORD)
    print(f"Examples: {len(shortlists)} words matched a short, fully-glossed sentence "
          f"({strict_full} of them matched at least {EXAMPLES_PER_WORD})")
    short_of = {key for key, lst in shortlists.items() if len(lst) < EXAMPLES_PER_WORD}
    short_of |= set(records_for) - set(shortlists)
    wanted = defaultdict(set)
    for surface, reading in short_of:
        wanted[surface].add(reading)
    pass_over(relaxed=True)
    print(f"          the relaxed second pass brought {len(shortlists)} words to at least one")

    glossary = {}
    counts = Counter()
    for key, shortlist in shortlists.items():
        chosen = []
        for _score, index, _written in choose_examples(shortlist, sentences):
            japanese, english, tokens = sentences[index]
            ruby, _unglossed, _guesses = example_ruby(
                japanese, tokens, keb_readings, prior, stem_index)
            words = example_words(japanese, tokens, keb_readings, prior,
                                  example_glosses, example_senses)
            example = {"j": japanese, "en": english, "r": ruby, "w": words}
            if idiom_cache[index]:
                example["i"] = 1  # labelled as an idiom in the app rather than passed off as ordinary usage
            chosen.append(example)
            for span in words:
                glossary_word = span[2] if len(span) > 2 else japanese[span[0]:span[0] + span[1]]
                if glossary_word not in glossary:
                    base, _, sense = glossary_word.partition("@")
                    dictionary_form = re.split(r"[|#]", base)[0]
                    reading, _certain = resolve_reading(
                        dictionary_form, None, keb_readings, prior)
                    if sense == "*":
                        # First gloss of each sense, up to four: "if · and ·
                        # with · used for quoting" rather than one of those
                        # four presented as the answer.
                        seen_senses = []
                        for text in example_senses[base]:
                            # Parentheticals first, then the comma: splitting
                            # "used for quoting (thoughts, speech, etc.)" on
                            # its first comma otherwise cuts it off inside
                            # the bracket.
                            first = re.sub(r"\s*\([^()]*\)", "", text).split(",")[0].strip()
                            if first and first not in seen_senses:
                                seen_senses.append(first)
                        meaning = " · ".join(seen_senses[:4])
                    elif sense:
                        meaning = example_senses[base][int(sense) - 1]
                    else:
                        meaning = example_glosses[base]
                    glossary[glossary_word] = [reading or dictionary_form, meaning]
        counts[len(chosen)] += 1
        for record in records_for[key]:
            record["ex"] = chosen

    covered = len(shortlists)
    idioms = sum(1 for records in unit_records.values() for r in records
                 for e in r.get("ex", []) if e.get("i"))
    print(f"          {covered} of {total} words have at least one example sentence "
          f"({100 * covered / total:.1f}%) — "
          + ", ".join(f"{counts[n]} with {n}" for n in sorted(counts, reverse=True))
          + f"; {idioms} idioms kept for want of anything better")
    print(f"          {len(glossary)} distinct words across every sentence, for tap-a-word")
    return glossary


# --- Assembly ----------------------------------------------------------------

MEANING_LABEL_MAX = 45  # vocab-plan.md §5.1: en[0] is the Meaning-mode answer label


def shorten_label(gloss):
    """vocab-plan.md §5.1: en[0] is the quiz answer label and has to fit a
    two-column phone layout — enforced at build time rather than trusted, the
    same call the plan makes for the reason it makes it (many JMdict glosses
    carry a long parenthetical elaboration, e.g. "crane (any bird of the
    family Gruidae, esp. ...)"). Dropping a trailing "(...)" first is tried
    before a hard truncation, since it usually recovers the real short label
    intact rather than mangling it mid-word."""
    if len(gloss) <= MEANING_LABEL_MAX:
        return gloss
    stripped = re.sub(r"\s*\([^()]*\)\s*$", "", gloss).strip()
    if stripped and len(stripped) <= MEANING_LABEL_MAX:
        return stripped
    return gloss[:MEANING_LABEL_MAX - 1].rstrip() + "…"


def make_record(unit, level, surface, reading, glosses, senses, pos, uk,
                 kanjidic, stem_index, quiz_readings, all_kebs, readings_by_keb,
                 reading_to_kanji, taught_kanji, kanji_only_pool):
    ruby = None if uk else build_ruby(surface, reading, kanjidic, stem_index, quiz_readings)
    spans = segment_spans(surface, align_word(surface, reading, stem_index) or []) if ruby else []
    mis = build_mis(surface, reading, spans, kanjidic, readings_by_keb) if spans else []
    # First-sense glosses only, deliberately — `sp`'s keyword matching wants
    # what the word mainly means, not its tenth sense (§5.6).
    sp = [] if uk else build_sp(surface, glosses, spans, all_kebs, reading_to_kanji, taught_kanji, kanji_only_pool)
    # vocab-plan.md §5.6: `en` is every kept sense's glosses flattened in
    # sense order, `sn` the size of each group so the flat list reads back as
    # groups. extract_senses can come back empty (every sense filtered out, or
    # a pos-only entry) — fall back to the first-sense glosses this has always
    # used, so no word can end up with no meaning at all.
    groups = senses or [glosses[:4]]
    groups = [[shorten_label(g) for g in grp] for grp in groups]
    en = [g for grp in groups for g in grp]
    record = {
        "w": surface, "r": reading, "en": en, "pos": pos, "th": unit, "lv": level,
    }
    # Omitted for the single-sense majority — a `sn` of [n] says nothing the
    # length of `en` doesn't, and these files ship to a phone.
    if len(groups) > 1:
        record["sn"] = [len(grp) for grp in groups]
    if uk:
        record["uk"] = True
    if ruby is not None:
        record["ruby"] = ruby
    if mis:
        record["mis"] = mis
    if sp:
        record["sp"] = sp
    return record


def assign_ids(records):
    """vocab-plan.md §3.3: id is the surface form, or surface|reading on a
    within-unit homograph collision (開く|ひらく vs 開く|あく)."""
    by_surface = {}
    for r in records:
        by_surface.setdefault(r["w"], []).append(r)
    out = {}
    for surface, group in by_surface.items():
        if len(group) == 1:
            out[surface] = group[0]
        else:
            for r in group:
                out[f"{surface}|{r['r']}"] = r
    return out


def main():
    if not JMDICT.exists():
        raise SystemExit(f"Missing {JMDICT} — run tools/fetch_kanji_sources.sh first.")

    print("Loading kanji course data (quiz readings, taught-kanji pool)...")
    quiz_readings, taught_kanji = load_kanji_quiz_data()
    print(f"  {len(taught_kanji)} taught kanji")

    print("Parsing KANJIDIC2...")
    kanjidic = parse_kanjidic()
    stem_index = build_stem_index(kanjidic)

    reading_to_kanji = {}
    for kanji in taught_kanji:
        for raw in kanjidic[kanji]["on"] + kanjidic[kanji]["kun"]:
            stem, _okuri = reading_parts(raw)
            if not stem:
                continue
            for variant in stem_variants(stem):
                reading_to_kanji.setdefault(variant, set()).add(kanji)

    (candidates, all_kebs, readings_by_keb, keb_readings, kanji_only_pool,
     example_glosses, example_senses, idiomatic) = parse_jmdict()

    print("Building entry index for Core lookups...")
    text = JMDICT.read_text(encoding="utf-8")
    raw_entries = re.findall(r"<entry>.*?</entry>", text, re.S)
    entry_index = build_entry_index(raw_entries)
    del text, raw_entries

    # Keyed by OUTPUT unit id, not theme — a theme's 'h' words land under
    # "<theme>h" (see phase 6's module-docstring comment), a separate id from
    # its 'f' sibling, created on first use rather than pre-populated here
    # since not every theme ends up with a Higher unit at all.
    unit_records = defaultdict(list)
    for unit in UNIT_LABELS:
        unit_records[unit] = []

    # --- Core: hand-specified, always level 'f' ---
    core_surfaces = set()
    missing_core = []
    for unit, items in CORE_ENTRIES.items():
        for label, keb, reb in items:
            entry = find_entry(entry_index, keb=keb, reb=reb)
            if entry is None:
                missing_core.append((unit, label))
                continue
            record = make_record(
                unit, "f", entry["surface"], entry["reading"], entry["glosses"], entry["senses"], entry["pos"], entry["uk"],
                kanjidic, stem_index, quiz_readings, all_kebs, readings_by_keb,
                reading_to_kanji, taught_kanji, kanji_only_pool,
            )
            unit_records[unit].append(record)
            core_surfaces.add(entry["surface"])
    if missing_core:
        print(f"WARNING: {len(missing_core)} Core lookups failed: {missing_core}")
    print(f"Core: {sum(len(unit_records[u]) for u in CORE_ENTRIES)} words across {len(CORE_ENTRIES)} units")

    # --- A12: hand-specified, always level 'a' (phase 7's Core-equivalent).
    # Looked up now (its surfaces have to be excluded from the 'f'/'h' pass
    # below), but make_record() is deliberately DEFERRED to after that pass
    # — see the comment where it's actually called. ---
    a12_lookups = []
    a12_surfaces = set()
    missing_a12 = []
    for label, keb, reb in A12_ENTRIES:
        entry = find_entry(entry_index, keb=keb, reb=reb)
        if entry is None:
            missing_a12.append(label)
            continue
        a12_lookups.append(entry)
        a12_surfaces.add(entry["surface"])
    if missing_a12:
        print(f"WARNING: {len(missing_a12)} A12 lookups failed: {missing_a12}")
    print(f"A12: {len(a12_lookups)} words")

    # --- Theme units: frequency order, keyword-classified ---
    excluded_surfaces = core_surfaces | a12_surfaces
    candidates = [c for c in candidates if c["surface"] not in excluded_surfaces]
    candidates.sort(key=lambda c: (c["rank"], len(c["reading"])))

    level_counts = {"f": 0, "h": 0}
    unit_level_counts = {}
    unclassified = 0
    used_surfaces = set()
    for c in candidates:
        if level_counts["f"] >= WORDS_PER_LEVEL["f"] and level_counts["h"] >= WORDS_PER_LEVEL["h"]:
            break
        unit = classify(c)
        if unit is None:
            unclassified += 1
            continue
        key_f, key_h = (unit, "f"), (unit, "h")
        per_unit_f = unit_level_counts.get(key_f, 0)
        per_unit_h = unit_level_counts.get(key_h, 0)
        level = None
        if level_counts["f"] < WORDS_PER_LEVEL["f"] and per_unit_f < MAX_PER_UNIT:
            level = "f"
        elif level_counts["h"] < WORDS_PER_LEVEL["h"] and per_unit_h < MAX_PER_UNIT // 2:
            level = "h"
        if level is None:
            continue
        record = make_record(
            unit, level, c["surface"], c["reading"], c["glosses"], c["senses"], c["pos"], c["uk"],
            kanjidic, stem_index, quiz_readings, all_kebs, readings_by_keb,
            reading_to_kanji, taught_kanji, kanji_only_pool,
        )
        # `record["th"]` stays the bare theme id either way — it names what
        # the word is ABOUT, unaffected by which tile it ends up sorted
        # into. `out_unit` is the OUTPUT unit id — a theme's 'h' words are a
        # separate unit ("2.4h") from its 'f' words, see phase 6's
        # module-docstring comment.
        out_unit = f"{unit}h" if level == "h" else unit
        unit_records[out_unit].append(record)
        level_counts[level] += 1
        unit_level_counts[(unit, level)] = unit_level_counts.get((unit, level), 0) + 1
        used_surfaces.add(c["surface"])

    print(f"Theme words: {level_counts['f']} at 'f', {level_counts['h']} at 'h' "
          f"({unclassified} common candidates matched no theme and were left out of this pass)")

    # --- A12 record-building, deferred until here (see the lookup pass
    # above): make_record()'s mis/sp distractor pools are built by shuffling
    # a shared, seeded `random` stream, so calling it any earlier would shift
    # every GCSE-tier word's own shuffle later in this run. Deferring this
    # keeps A12 itself from adding to that churn, though excluding its 27
    # surfaces from the 'f'/'h' candidate pool above (correctly — a word
    # like 議論 must not also land in some GCSE theme) still shifts later
    # units' distractor shuffles whenever an excluded surface would otherwise
    # have consumed one of the 'f'/'h' pass's own random draws. Harmless:
    # `mis`/`sp` are reshuffled again at quiz time by vocab.js's own
    # `shuffle()` (buildYomiChoices, buildSpellingChoices), so this is
    # build-time-only diff noise, not a behaviour change — see those two call
    # sites if this comment is ever doubted. ---
    for entry in a12_lookups:
        record = make_record(
            "A12", "a", entry["surface"], entry["reading"], entry["glosses"], entry["senses"], entry["pos"], entry["uk"],
            kanjidic, stem_index, quiz_readings, all_kebs, readings_by_keb,
            reading_to_kanji, taught_kanji, kanji_only_pool,
        )
        unit_records["A12"].append(record)

    # --- A level (A1-A11): next slice of the SAME frequency-ranked pool,
    # picking up wherever the 'f'/'h' pass above left off (its own
    # WORDS_PER_LEVEL cap, not necessarily having scanned every candidate) —
    # see phase 7's module-docstring comment for why a frequency signal that
    # is a poor fit for GCSE topics is a reasonable one for A level's. ---
    a_count = 0
    a_unit_counts = {}
    a_unclassified = 0
    for c in candidates:
        if a_count >= WORDS_PER_LEVEL["a"]:
            break
        if c["surface"] in used_surfaces:
            continue
        unit = classify_a(c)
        if unit is None:
            a_unclassified += 1
            continue
        if a_unit_counts.get(unit, 0) >= MAX_PER_UNIT:
            continue
        record = make_record(
            unit, "a", c["surface"], c["reading"], c["glosses"], c["senses"], c["pos"], c["uk"],
            kanjidic, stem_index, quiz_readings, all_kebs, readings_by_keb,
            reading_to_kanji, taught_kanji, kanji_only_pool,
        )
        unit_records[unit].append(record)
        a_count += 1
        a_unit_counts[unit] = a_unit_counts.get(unit, 0) + 1
        used_surfaces.add(c["surface"])

    print(f"A level words: {a_count} at 'a' "
          f"({a_unclassified} remaining candidates matched no A-level theme either)")

    # --- Kanji words (K1, K2, ...): not part of vocab-plan.md §2.3 at all —
    # a user-requested bonus group, not a curriculum tier. A kanji's own
    # detail page shows up to EXAMPLES_PER_KANJI "Common words" (see
    # choose_examples() above; already frequency-ordered), each with a
    # one-tap Add button in the app — EXCEPT that button only exists when
    # the word also has a real entry somewhere in the vocab curriculum
    # (buildWordRow() in app.js gates it on vocabTargetForWord() finding
    # one). Most don't: of every distinct common word shown across the six
    # primary-school kanji grades, roughly 2,700 have no vocab entry at all.
    # This walks those six grades in teaching order (grade 1's 一 before
    # grade 6's anything), each kanji's own words in their already-chosen
    # frequency order, skipping anything already claimed above (Core, A12,
    # 'f'/'h'/'a'), and chunks the result into KANJI_WORD_UNIT_SIZE-word
    # units — so K1 is the most-common words tied to the earliest grade-1
    # kanji, working forward from there. No topic to classify by (unlike
    # every group above), so there is nothing here resembling classify()/
    # classify_a() — just exhaustion of a fixed, ordered source list.
    #
    # A surface here is looked up via find_entry (exact keb match, the same
    # mechanism CORE_ENTRIES/A12_ENTRIES use) rather than trusting the
    # {kanji, kana, en} triple kanji-data already carries for it — that
    # triple lacks the multi-sense breakdown, ruby, and mis/sp distractor
    # pools every other vocab word gets, and find_entry gives the SAME
    # record shape as everything else via make_record(). A surface CAN be
    # a homograph, though (石 is both こく, a unit of measure, and いし,
    # "stone") — find_entry always resolves to whichever entry's FIRST
    # k_ele matches, which is occasionally not the reading kanji-data's own
    # alignment actually credited this word for. Checked against kanji-
    # data's own `kana` field (ground truth for what that word's kanji page
    # actually shows) and skipped on a mismatch — about 1% of candidates,
    # not worth teaching a reading the kanji page itself doesn't display.
    KANJI_WORD_UNIT_SIZE = 40
    kanji_manifest = load_js_const("src/data/kanji-manifest.js", "KANJI_UNITS")
    primary_grades = [g for g in kanji_manifest if g.isdigit() and 1 <= int(g) <= 6]

    already_covered = {r["w"] for recs in unit_records.values() for r in recs}
    k_seen = set(already_covered)
    k_unit_labels = {}
    k_chunk_index = 0
    k_current = []
    k_current_grades = set()
    k_total = 0
    k_mismatches = 0

    def flush_kanji_words():
        nonlocal k_chunk_index, k_current, k_current_grades
        if not k_current:
            return
        k_chunk_index += 1
        uid = f"K{k_chunk_index}"
        unit_records[uid] = k_current
        grades_sorted = sorted(k_current_grades, key=int)
        grade_label = f"Grade {grades_sorted[0]}" if len(grades_sorted) == 1 \
            else f"Grade {grades_sorted[0]}-{grades_sorted[-1]}"
        # Base label only — a single grade spans many KANJI_WORD_UNIT_SIZE
        # chunks (grade 1 alone fills five), so several units share this
        # exact string; the "(part N)" suffix that disambiguates them is
        # added in one pass below, once every unit's base label is known.
        k_unit_labels[uid] = f"{grade_label} kanji words"
        k_current = []
        k_current_grades = set()

    for grade in primary_grades:
        kentries = load_js_const(f"src/data/kanji-grade-{grade}.js", "KANJI_ENTRIES")
        for kentry in kentries:
            for w in kentry["words"]:
                surface = w["kanji"]
                if surface in k_seen:
                    continue
                k_seen.add(surface)
                entry = find_entry(entry_index, keb=surface)
                if entry is None or entry["reading"] != w["kana"]:
                    k_mismatches += 1
                    continue
                record = make_record(
                    f"K{k_chunk_index + 1}", "k", entry["surface"], entry["reading"], entry["glosses"], entry["senses"], entry["pos"], entry["uk"],
                    kanjidic, stem_index, quiz_readings, all_kebs, readings_by_keb,
                    reading_to_kanji, taught_kanji, kanji_only_pool,
                )
                k_current.append(record)
                k_current_grades.add(grade)
                k_total += 1
                if len(k_current) >= KANJI_WORD_UNIT_SIZE:
                    flush_kanji_words()
    flush_kanji_words()

    # Disambiguate: "Grade 1 kanji words" alone would be the SAME course
    # name and native label on 5 different units (grade 1 fills that many
    # 40-word chunks by itself) — every other unit in this app gets its
    # label from a distinct theme, but there is no theme here, only a
    # running position through the grade's own word list. uid order (K1,
    # K2, ...) is already teaching order, so "(part N)" numbers correctly
    # without re-deriving anything.
    by_base_label = defaultdict(list)
    for uid, label in k_unit_labels.items():
        by_base_label[label].append(uid)
    for label, uids in by_base_label.items():
        if len(uids) == 1:
            continue
        for i, uid in enumerate(sorted(uids, key=lambda u: int(u[1:])), start=1):
            k_unit_labels[uid] = f"{label} (part {i} of {len(uids)})"

    UNIT_LABELS.update(k_unit_labels)
    print(f"Kanji words: {k_total} words across {k_chunk_index} units "
          f"({k_mismatches} skipped — find_entry's homograph did not match the kanji page's own reading)")

    # --- Drop near-empty units, report sizes ---
    dropped = []
    for unit in list(unit_records):
        if unit.startswith("C") or unit == "A12":
            continue
        if len(unit_records[unit]) < MIN_UNIT_SIZE:
            dropped.append((unit, len(unit_records[unit])))
            del unit_records[unit]
    if dropped:
        print(f"Dropped {len(dropped)} units below MIN_UNIT_SIZE={MIN_UNIT_SIZE}: {dropped}")

    total_words = sum(len(v) for v in unit_records.values())
    print(f"\n{len(unit_records)} units, {total_words} words total:")
    # GROUP_ORDER, not alphabetical: unit_group() already returns a group TAG
    # ("C", "1".."5", "H", "A"), but sorting tags as plain strings would put
    # "C"/"H"/"A" out of teaching order — fine for the manifest (compareUnits
    # in vocab.js sorts for real at runtime) but confusing to read here.
    group_order = {g: i for i, g in enumerate(["C", "1", "2", "3", "4", "5", "H", "A", "K"])}
    # (group order, then the unit's own trailing number — e.g. "1.1" -> 1,
    # "1.8" -> 8, "K10" -> 10 -- so "K10" sorts after "K2" the way it should;
    # a plain string sort would put it before, since "1" < "2" character by
    # character. This is report ordering only — compareUnits() in vocab.js
    # is what the app itself actually uses to browse.
    unit_number = lambda u: int(re.search(r"(\d+)h?$", u).group(1))  # noqa: E731
    for unit in sorted(unit_records, key=lambda u: (group_order[unit_group(u)], unit_number(u))):
        recs = unit_records[unit]
        f_n = sum(1 for r in recs if r["lv"] == "f")
        h_n = sum(1 for r in recs if r["lv"] == "h")
        a_n = sum(1 for r in recs if r["lv"] == "a")
        k_n = sum(1 for r in recs if r["lv"] == "k")
        label = UNIT_LABELS[unit[:-1]] if unit.endswith("h") else UNIT_LABELS[unit]
        print(f"  {unit:6} {label:40} {len(recs):3} words ({f_n} f / {h_n} h / {a_n} a / {k_n} k)")

    # --- Example sentences, once every unit's records exist ---
    example_glossary = build_examples(unit_records, keb_readings, stem_index,
                                      example_glosses, example_senses, idiomatic)

    # --- Assign ids (collision-safe) and write files ---
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    header = [
        "// Generated by tools/build_vocab_data.py — do not hand-edit.",
        "// Source: JMdict (c) EDRDG, CC BY-SA 4.0 — see build script for the",
        "// frequency-based word-selection approach (vocab-plan.md §3.5 fallback).",
        "// https://www.edrdg.org/wiki/index.php/JMdict-EDICT_Dictionary_Project",
        "// Example sentences (`ex`): the Tanaka Corpus, as distributed with",
        "// WWWJDIC and maintained by the Tatoeba Project, CC BY 2.0 FR.",
        "// https://www.edrdg.org/wiki/index.php/Tanaka_Corpus",
        "",
    ]

    # A unit that existed in a PREVIOUS run but not this one (a theme's word
    # count moved below MIN_UNIT_SIZE, or a level split like phase 6's moved
    # its words to a new "<unit>h" id) leaves its old vocab-<unit>.js file
    # behind otherwise — nothing referencing it from the fresh manifest, but
    # still sitting in the repo as dead weight.
    for stale in DATA_DIR.glob("vocab-*.js"):
        stem = stale.stem[len("vocab-"):]
        if stem not in ("manifest", "lookup") and stem not in unit_records:
            stale.unlink()
            print(f"Removed stale {stale.name} (unit no longer produced)")

    def encode_entries(entries_out):
        """json.dumps(indent=2) with one exception: the [start, length, kana]
        and [start, length, key] triples inside `ex` are kept on one line
        each. Spread over five lines apiece they are most of the file — a
        unit goes from 117 KB to about half that — and a sentence's furigana
        offsets are no more readable stacked vertically than they are inline.
        Everything else keeps the shape every other generated file here has.
        """
        inline = {}

        def stash(value):
            token = f"@@{len(inline)}@@"
            inline[token] = json.dumps(value, ensure_ascii=False)
            return token

        prepared = []
        for entry in entries_out:
            entry = dict(entry)
            if "ex" in entry:
                entry["ex"] = [{**example,
                                "r": [stash(span) for span in example["r"]],
                                "w": [stash(span) for span in example["w"]]}
                               for example in entry["ex"]]
            prepared.append(entry)
        text = json.dumps(prepared, ensure_ascii=False, indent=2)
        return re.sub(r'"(@@\d+@@)"', lambda m: inline[m.group(1)], text)

    manifest_units = {}
    lookup = {}
    for unit, recs in unit_records.items():
        by_id = assign_ids(recs)
        manifest_units[unit] = list(by_id.keys())
        entries_out = [{"id": wid, **rec} for wid, rec in by_id.items()]
        for wid in by_id:
            lookup[by_id[wid]["w"]] = unit  # last unit wins on a cross-unit surface clash — rare, acceptable for v1
        out_path = DATA_DIR / f"vocab-{unit}.js"
        js = header + [
            "export const VOCAB_ENTRIES = " + encode_entries(entries_out) + ";",
            "",
        ]
        out_path.write_text("\n".join(js), encoding="utf-8")

    manifest_path = DATA_DIR / "vocab-manifest.js"
    manifest_js = header + [
        "// VOCAB_UNITS: ordered word-id list per unit — small enough to load\n"
        "// eagerly, enough to build the course skeleton with no network wait.\n"
        "// The full per-word data (reading, glosses, ruby, distractors) lives in\n"
        "// the matching vocab-<unit>.js, loaded lazily — same pattern as\n"
        "// kanji-manifest.js / kanji-grade-*.js, see kanji-expansion-plan.md §4.",
        "export const VOCAB_UNITS = " + json.dumps(manifest_units, ensure_ascii=False, indent=2) + ";",
        "",
        "export const VOCAB_GROUP_LABELS = " + json.dumps(GROUP_LABELS, ensure_ascii=False, indent=2) + ";",
        "",
        # No separate label per 'h' unit — "2.4h" describes the same theme as
        # "2.4", just the rarer-word tile, and unitLabel() in vocab.js
        # strips the trailing 'h' before this lookup rather than needing a
        # duplicate entry here for every theme that has a Higher tile.
        "export const VOCAB_UNIT_LABELS = " + json.dumps(
            {u: UNIT_LABELS[u] for u in manifest_units if not u.endswith("h")},
            ensure_ascii=False, indent=2) + ";",
        "",
    ]
    manifest_path.write_text("\n".join(manifest_js), encoding="utf-8")

    lookup_path = DATA_DIR / "vocab-lookup.js"
    lookup_js = header + [
        "// surface -> home unit id, for cross-unit lookup with no grade\n"
        "// context (word detail links, and later story annotation — see\n"
        "// vocab-plan.md §3.4/§10).",
        "export const VOCAB_LOOKUP = " + json.dumps(lookup, ensure_ascii=False, indent=2) + ";",
        "",
    ]
    lookup_path.write_text("\n".join(lookup_js), encoding="utf-8")

    # One shared file rather than a gloss inlined on every token of every
    # sentence: the same few thousand words (は, 私, 行く) recur across all
    # ~9,000 sentences, so inlining would repeat them thousands of times and
    # bloat every single lazily-loaded unit file. Loaded once, on the first
    # tap of a word in a sentence, and cached from then on.
    words_path = DATA_DIR / "example-words.js"
    words_js = header + [
        "// Every distinct word appearing in any example sentence, so a tap on\n"
        "// one can answer with its reading and meaning: key -> [reading,\n"
        "// meaning]. The key is the written form, or form|reading, or\n"
        "// form#entry-id where JMdict needed pinning down; the app strips at\n"
        "// the first | or # to get the dictionary form back (neither\n"
        "// character occurs in Japanese). Loaded lazily and once — see\n"
        "// ensureExampleWordsLoaded() in app.js.",
        "export const EXAMPLE_WORDS = {",
        # One line per word: 8,900 entries at four lines each is a 600 KB
        # file for 300 KB of data, and this one is fetched whole.
        *(f" {json.dumps(key, ensure_ascii=False)}: {json.dumps(value, ensure_ascii=False)},"
          for key, value in sorted(example_glossary.items())),
        "};",
        "",
    ]
    words_path.write_text("\n".join(words_js), encoding="utf-8")

    print(f"\nwrote {manifest_path.name}, {lookup_path.name}, {words_path.name} "
          f"({words_path.stat().st_size // 1024} KB), and {len(unit_records)} "
          f"vocab-<unit>.js files to {DATA_DIR}")


if __name__ == "__main__":
    main()
