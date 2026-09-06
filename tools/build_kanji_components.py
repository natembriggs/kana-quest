"""Build src/data/components.js and src/data/kanji-components-*.js from
KanjiVG's component metadata plus KANJIDIC2.

KanjiVG's SVGs are not just stroke paths: every character's strokes are
grouped into nested <g> elements carrying kvg:element (which component this
group draws), kvg:position (how it sits against its siblings — top, bottom,
left, right, tare, nyo, kamae), kvg:radical and kvg:phon. build_stroke_data.py
reads the same files for their <path d="..."> outlines and throws these
wrappers away; this script reads the wrappers and ignores the paths.

Output, per kanji: a memory hint, and — where KanjiVG can name the parts
reliably — those parts in spatial reading order, each with a standardized
English keyword, plus a normalized arrangement. A kanji with no usable
decomposition still gets an entry carrying a hint about how the character
LOOKS, since a learner needs something to hang 犬 or 母 on too; it simply has
no tiles. See kanji-mnemonic-plan.md §3.

Every hint written here is a DEFAULT. A learner can replace any of them with
their own wording in the app, stored per profile and synced across their
devices — see profile.mnemonics in src/store.js and §10 of the plan. Nothing
in this file is the last word on any character.

Three deliberate conservatisms, because a wrong breakdown is worse than no
breakdown:

  * A component is only kept if it is a single renderable character.
    KanjiVG names some elements with non-Unicode CDP-#### placeholders
    (原's lower half, for one); there is nothing to draw on a tile for those.
  * A kanji whose parts ALL lack kvg:position is dropped. That flag turns
    out to be a reliable marker of stroke-grouping artifacts rather than
    real decomposition — 五 = 二+二, 州 = 丶+川 three times over, 東 =
    木+日+木, 母 = 毋+毋. Roughly 35 kanji in grades 1-3, almost all of them
    simple enough to need no mnemonic anyway.
  * A kanji with any unnameable part is dropped whole rather than shown
    with a gap. Partial breakdowns teach a wrong decomposition.

Mnemonic text comes from tools/kanji_src/kanji-mnemonics.tsv, hand-authored
per kanji from the component keywords (or, for a kanji with no breakdown,
from the shape of the character itself) and nothing else. A kanji with a
breakdown but no authored line falls back to a mechanical arrangement
template, so the pipeline always produces a complete dataset and the authored
text is an *input* to the build rather than something maintained outside it.

Source data: KanjiVG (c) Ulrich Apel, CC BY-SA 3.0, downloaded by
fetch_kanjivg.sh; KANJIDIC2 (c) EDRDG, CC BY-SA 4.0, by fetch_kanji_sources.sh.
Neither is committed.

Usage:
    python3 tools/build_kanji_components.py
"""
import html
import json
import re
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "tools" / "data_src"
DATA_DIR = ROOT / "src" / "data"
KANJIVG_DIR = SRC / "kanjivg" / "kanji"
KANJIDIC = SRC / "kanjidic2.xml"
MANIFEST = DATA_DIR / "kanji-manifest.js"
KEYWORDS_TSV = ROOT / "tools" / "kanji_src" / "component-keywords.tsv"
MNEMONICS_TSV = ROOT / "tools" / "kanji_src" / "kanji-mnemonics.tsv"

# First-pass coverage, per kanji-mnemonic-plan.md §8. Extending this to the
# rest of the jōyō set is a one-line change here plus authored mnemonics for
# the new units in kanji-mnemonics.tsv — the rest of the pipeline is
# unit-agnostic.
UNITS = ("1", "2", "3", "4", "5", "6")

# Kanji whose KanjiVG decomposition is structurally valid but useless to a
# learner, and which the automatic guards below don't catch. Each was read
# and rejected by hand: 漢's right-hand side collapses to just its 艹 top,
# losing everything under it; 表 comes apart as 二+丨+二+衣 and 寒 as
# 宀+三+三+八+冫, both of which are stroke bookkeeping rather than parts
# anyone would name; 午 as 丿+干+干 says nothing about a character that is
# three strokes and a vertical. These still get an appearance-based hint
# like any other kanji with no breakdown — they just get no tiles. The
# grades 4-6 additions below were read and rejected the same way.
HAND_SUPPRESSED = set(
    # grades 1-3
    "漢表寒午"
    # grades 4-6: parts that do not cover the whole character, so the tiles
    # teach a character with pieces missing — 徳 comes apart as just 彳+心,
    # 散 as 月+攵, 官 as 宀+口, 倉 as 人+口, 存 as 亻+子, 展 as 尸+廾, 従 as
    # 彳+疋, 穀 as 禾+殳, 衆 as 血+亻, 覧 as 臣+見, 革 as 廿+口, 鹿 as 广+比.
    "徳散官倉存展従穀衆覧革鹿"
    # the same element named twice where KanjiVG splits it around what it
    # encloses: 修 (攸 left AND right), 準 (隼 twice), 術 (行 twice), 蔵 (戈
    # twice), 裏 (衣 twice), 興 (𦥑 twice). 常 is worse than twice — its 尚
    # and 吊 overlap on the same 口.
    "修準術蔵裏興常"
    # stroke bookkeeping rather than parts anyone would name: 兆 = 儿+冫+儿,
    # 以 = 丶+人, 低 = 亻+氏+一, 候 = 亻+丨+矢, 別 = 口+勹+刂, 印 = 丿+丨+卩,
    # 無 = 丿+一+灬, 専 = 由+寸 (its top is 叀, not 由), 難 = 艹+口+夫+隹.
    "兆以低候別印無専難"
    # a part whose only defensible keyword is useless or wrong in tone:
    # 任 (壬 "9th calendar sign"), 就 (尤 "reasonable"), 敬 (苟 "any"),
    # 熟 (孰 "which"), 保 (呆 "be amazed"), 補 (甫 "for the first time"),
    # 接 (妾 "concubine").
    "任就敬熟保補接"
)

# KANJIDIC lists a radical's own NAME as if it were a meaning ("one radical
# (no.1)"). Same regex, same reason, as build_kanji_data.py:93.
RADICAL_MEANING = re.compile(r"radical\s*\(no", re.I)

# kvg:position values, and what each means spatially. KanjiVG pairs an
# enclosing element with the thing it encloses using an "…c" suffix:
# tare/tarec, nyo/nyoc, kamae/kamaec.
WRAPPERS = {"tare", "nyo", "kamae"}
CONTENTS = {"tarec", "nyoc", "kamaec"}


def is_single_char(el):
    """KanjiVG names most components with the component's own character, but
    falls back to CDP-#### placeholders (and, rarely, multi-character
    strings) where no single Unicode character exists. Only real characters
    can be shown on a tile."""
    return len(el) == 1 and not unicodedata.category(el).startswith("C")


def kanji_units():
    text = MANIFEST.read_text(encoding="utf-8")
    return json.loads(re.search(r"KANJI_UNITS = (\{.*?\});", text, re.S).group(1))


def parse_kanjidic_meanings():
    """{kanji: [english glosses]} — the same parse build_kanji_data.py does,
    kept independent rather than imported because that script is a top-level
    build entry point, not a library, and this needs only one of its fields."""
    text = KANJIDIC.read_text(encoding="utf-8")
    out = {}
    for block in re.findall(r"<character>.*?</character>", text, re.S):
        literal = re.search(r"<literal>(.*?)</literal>", block).group(1)
        meanings = [
            html.unescape(m)
            for m in re.findall(r"<meaning>(?!<)(.*?)</meaning>", block)
        ]
        out[literal] = [m for m in meanings if not RADICAL_MEANING.search(m)]
    return out


def load_keywords():
    """Curated component → keyword overrides. See the header of the TSV for
    the sourcing rule every entry has to satisfy."""
    out = {}
    if not KEYWORDS_TSV.exists():
        return out
    for line in KEYWORDS_TSV.read_text(encoding="utf-8").splitlines():
        if not line.strip() or line.startswith("#"):
            continue
        cols = line.split("\t")
        if len(cols) < 2 or not cols[1].strip():
            continue
        out[cols[0].strip()] = cols[1].strip()
    return out


def load_mnemonics():
    out = {}
    if not MNEMONICS_TSV.exists():
        return out
    for line in MNEMONICS_TSV.read_text(encoding="utf-8").splitlines():
        if not line.strip() or line.startswith("#"):
            continue
        cols = line.split("\t")
        if len(cols) < 2 or not cols[1].strip():
            continue
        out[cols[0].strip()] = cols[1].strip()
    return out


def top_level_groups(char):
    """The direct children of the outermost <g kvg:element="{char}">, in
    document order — which for KanjiVG is also stroke order.

    Parsed with a tag scanner rather than an XML library on purpose: the
    files carry an inline DTD that Python's stdlib XML parsers refuse to
    resolve entities from, and build_stroke_data.py already reads these same
    files this way.
    """
    path = KANJIVG_DIR / f"{ord(char):05x}.svg"
    if not path.exists():
        return None
    text = path.read_text(encoding="utf-8")
    body = text[text.index("<svg"):]
    depth = 0
    root_depth = None
    children = []       # (attrs, [grandchild attrs]) in document order
    for closing, name, rest in re.findall(r"<(/?)(g|path)\b([^>]*)>", body):
        if name == "path":
            continue
        if closing:
            depth -= 1
            continue
        attrs = dict(re.findall(r'([\w:]+)="([^"]*)"', rest))
        depth += 1
        if root_depth is None and attrs.get("kvg:element") == char:
            root_depth = depth
        elif root_depth is not None and depth == root_depth + 1:
            children.append((attrs, []))
        elif root_depth is not None and depth == root_depth + 2 and children:
            children[-1][1].append(attrs)

    # An UNNAMED top-level group is a grouping wrapper, not a component:
    # KanjiVG boxes a phonetic element up without naming it (学's whole top
    # is one such group, tagged only kvg:phon, with ⺍ and 冖 inside it), so
    # reading only the top level would find one named child and call the
    # kanji atomic. Its children are the components; splice them in where
    # the wrapper sat, keeping document order. Only one level down — a
    # NAMED group's own children are that component's internals, not
    # siblings of it, and belong to a drill-down this doesn't do.
    flattened = []
    for attrs, grandchildren in children:
        if attrs.get("kvg:element"):
            flattened.append(attrs)
        else:
            flattened.extend(g for g in grandchildren if g.get("kvg:element"))
    return flattened


def merge_split_groups(groups):
    """KanjiVG splits an enclosure into two groups — the strokes drawn before
    the contents and the one drawn after — both tagged kamae with the same
    element (回 is 囗 kamae, 口, 囗 kamae). Fold those back into one part, so
    the breakdown says "囗 encloses 口" rather than naming 囗 twice."""
    merged = []
    for g in groups:
        prev = next(
            (m for m in merged
             if m["el"] == g["el"] and m["pos"] == g["pos"] and g["pos"] in WRAPPERS),
            None,
        )
        if prev is None:
            merged.append(g)
    return merged


def display_order(parts):
    """Spatial reading order. For left/right and top/bottom that is already
    stroke order, but an enclosure's contents are written before the strokes
    that close it, and 辶-style wraps are written last of all — so a wrapper
    is moved to the front, where a reader's eye actually starts."""
    wrappers = [p for p in parts if p["pos"] in WRAPPERS]
    rest = [p for p in parts if p["pos"] not in WRAPPERS]
    return wrappers + rest if wrappers else parts


def arrangement_of(parts):
    positions = [p["pos"] for p in parts]
    have = set(positions)
    if have & WRAPPERS:
        wrapper = next(p for p in positions if p in WRAPPERS)
        return {"tare": "tare", "nyo": "nyo", "kamae": "enclosure"}[wrapper]
    if len(parts) == 2:
        if positions == ["top", "bottom"]:
            return "top-bottom"
        if positions == ["left", "right"]:
            return "left-right"
    if have <= {"top", "middle", "bottom"}:
        return "stacked"
    if have <= {"left", "middle", "right"}:
        return "side-by-side"
    return "other"


def resolve_keyword(component, overrides, meanings):
    """Two-tier, per kanji-mnemonic-plan.md §2.3: the curated table first,
    then the component's own KANJIDIC entry. Never invented — a component
    that hits neither returns None and takes its kanji out of the dataset."""
    if component in overrides:
        return overrides[component], "curated"
    glosses = meanings.get(component) or []
    for gloss in glosses:
        # KANJIDIC glosses are comma-separated lists of senses; the first
        # sense is the keyword. Parenthetical qualifiers are dropped.
        first = re.sub(r"\s*\([^)]*\)", "", gloss.split(",")[0]).strip()
        if first and len(first) <= 18:
            return first, "kanjidic"
    return None, None


def cap(text):
    return text[0].upper() + text[1:] if text else text


def join_list(items):
    if len(items) == 1:
        return items[0]
    return ", ".join(items[:-1]) + " and " + items[-1]


def template_mnemonic(parts, meaning):
    """Mechanical fallback for any kanji with no authored line. Deliberately
    plain — its job is to never be wrong, not to be memorable."""
    words = [p["keyword"] for p in parts]
    arrangement = parts[0]["arrangement"]
    if arrangement == "top-bottom":
        return f"{cap(words[0])} above {words[1]} — together they make {meaning}."
    if arrangement == "left-right":
        return f"{cap(words[0])} beside {words[1]} — together they make {meaning}."
    if arrangement == "enclosure":
        return f"{cap(words[0])} encloses {join_list(words[1:])} — together they make {meaning}."
    if arrangement == "tare":
        return f"{cap(words[0])} hangs over {join_list(words[1:])} — together they make {meaning}."
    if arrangement == "nyo":
        return f"{cap(words[0])} runs beneath {join_list(words[1:])} — together they make {meaning}."
    if arrangement == "stacked":
        return f"{cap(words[0])} above {join_list(words[1:])} — together they make {meaning}."
    if arrangement == "side-by-side":
        return f"{cap(words[0])} beside {join_list(words[1:])} — together they make {meaning}."
    return f"Made from {join_list(words)}: {meaning}."


def decompose(char, overrides, meanings, stats):
    groups = top_level_groups(char)
    if groups is None:
        stats["no-svg"].append(char)
        return None
    named = [
        {"el": g["kvg:element"], "pos": g.get("kvg:position", "")}
        for g in groups
        if g.get("kvg:element")
    ]
    if len(named) < 2:
        stats["atomic"].append(char)
        return None
    if not any(p["pos"] for p in named):
        stats["unpositioned"].append(char)
        return None
    if any(not is_single_char(p["el"]) for p in named):
        stats["unrenderable-part"].append(char)
        return None
    if char in HAND_SUPPRESSED:
        stats["hand-suppressed"].append(char)
        return None

    parts = display_order(merge_split_groups(named))
    if len({p["el"] for p in parts}) < 2:
        stats["single-component"].append(char)
        return None

    arrangement = arrangement_of(parts)
    out = []
    for p in parts:
        keyword, source = resolve_keyword(p["el"], overrides, meanings)
        if keyword is None:
            stats["no-keyword"].append(f"{char}({p['el']})")
            return None
        stats[f"keyword-{source}"].append(p["el"])
        out.append({
            "c": p["el"],
            "pos": p["pos"] or "part",
            "keyword": keyword,
            "arrangement": arrangement,
        })
    return out


def main():
    if not KANJIVG_DIR.exists():
        raise SystemExit(f"Missing source data. Run tools/fetch_kanjivg.sh first ({KANJIVG_DIR}).")
    if not KANJIDIC.exists():
        raise SystemExit(f"Missing {KANJIDIC}. Run tools/fetch_kanji_sources.sh first.")
    if not MANIFEST.exists():
        raise SystemExit(f"Missing {MANIFEST}. Run tools/build_kanji_data.py first.")

    overrides = load_keywords()
    authored = load_mnemonics()
    meanings = parse_kanjidic_meanings()
    units = kanji_units()

    header = [
        "// Generated by tools/build_kanji_components.py — do not hand-edit.",
        "// Component shapes and positions: KanjiVG (c) Ulrich Apel, CC BY-SA 3.0.",
        "// Component meanings: KANJIDIC2 (c) EDRDG, CC BY-SA 4.0, and the",
        "// traditional Kangxi radical names. Mnemonic text is this project's own.",
        "",
    ]

    stats = {k: [] for k in (
        "no-svg", "atomic", "unpositioned", "unrenderable-part",
        "single-component", "no-keyword", "hand-suppressed",
        "keyword-curated", "keyword-kanjidic",
    )}
    used_keywords = {}
    covered = []
    total = 0
    with_parts = 0
    templated = []
    unused = []
    missing_hint = []

    for unit in UNITS:
        chars = units.get(unit)
        if chars is None:
            raise SystemExit(f"Unit {unit} is not in {MANIFEST}")
        entries = []
        for char in chars:
            parts = decompose(char, overrides, meanings, stats) or []
            arrangement = parts[0]["arrangement"] if parts else None
            for p in parts:
                used_keywords[p["c"]] = p["keyword"]
            covered.append(char)
            meaning = (meanings.get(char) or ["it"])[0].split(",")[0].strip()
            mnemonic = authored.get(char)
            if mnemonic and parts:
                # An authored line that skips one of its own components is
                # teaching a breakdown the sentence does not actually use,
                # which is the one way hand-written text can silently drift
                # out of step with the generated data underneath it.
                missing = [p["keyword"] for p in parts
                           if p["keyword"].lower() not in mnemonic.lower()]
                if missing:
                    unused.append(f"{char}({'/'.join(missing)})")
            elif not mnemonic and parts:
                mnemonic = template_mnemonic(parts, meaning)
                templated.append(char)
            elif not mnemonic:
                # No breakdown and no authored line: nothing to say about
                # this character at all. An entry here would be an empty
                # hint box, so it gets no entry and the UI shows nothing.
                missing_hint.append(char)
                continue
            entries.append({
                "k": char,
                "parts": [{"c": p["c"], "pos": p["pos"], "meaning": p["keyword"]} for p in parts],
                "arrangement": arrangement,
                "mnemonic": mnemonic,
            })
        total += len(entries)
        with_parts += sum(1 for e in entries if e["parts"])
        path = DATA_DIR / f"kanji-components-{unit}.js"
        path.write_text("\n".join(header + [
            "export const KANJI_COMPONENTS = "
            + json.dumps({e["k"]: e for e in entries}, ensure_ascii=False, separators=(",", ":"))
            + ";",
            "",
        ]), encoding="utf-8")
        print(f"wrote {path} ({len(entries)} kanji, {path.stat().st_size} bytes)")

    shared = DATA_DIR / "components.js"
    shared.write_text("\n".join(header + [
        "// Every component used by any kanji in kanji-components-*.js, with the",
        "// one standardized keyword it carries everywhere it appears. Small and",
        "// shared, so a component's meaning cannot drift between grades.",
        "export const COMPONENT_MEANINGS = "
        + json.dumps(dict(sorted(used_keywords.items())), ensure_ascii=False, separators=(",", ":"))
        + ";",
        "",
    ]), encoding="utf-8")
    print(f"wrote {shared} ({len(used_keywords)} components, {shared.stat().st_size} bytes)")

    print(f"\n{total} kanji with a hint across units {', '.join(UNITS)}, "
          f"{with_parts} of them with a component breakdown")
    if missing_hint:
        print(f"  {len(missing_hint)} kanji have NO breakdown and NO authored hint — "
              f"add one to {MNEMONICS_TSV.name}: {''.join(missing_hint)}")
    print(f"  {len(stats['atomic'])} atomic (no decomposition in KanjiVG)")
    print(f"  {len(stats['unpositioned'])} dropped — no kvg:position on any part: "
          f"{''.join(stats['unpositioned'])}")
    print(f"  {len(stats['unrenderable-part'])} dropped — a part has no single-character form: "
          f"{''.join(stats['unrenderable-part'])}")
    print(f"  {len(stats['single-component'])} dropped — one repeated component only: "
          f"{''.join(stats['single-component'])}")
    print(f"  {len(stats['hand-suppressed'])} dropped — hand-rejected decomposition: "
          f"{''.join(stats['hand-suppressed'])}")
    print(f"  {len(stats['no-keyword'])} dropped — a part has no keyword: "
          f"{' '.join(stats['no-keyword'])}")
    if stats["no-svg"]:
        print(f"  {len(stats['no-svg'])} dropped — no KanjiVG file: {''.join(stats['no-svg'])}")
    print(f"  keywords resolved: {len(set(stats['keyword-curated']))} curated, "
          f"{len(set(stats['keyword-kanjidic']))} from KANJIDIC")
    orphans = sorted(set(authored) - set(covered))
    if orphans:
        print(f"  {len(orphans)} authored mnemonic(s) for kanji not in the dataset: "
              f"{''.join(orphans)}")
    if unused:
        print(f"  {len(unused)} authored mnemonic(s) skip a component keyword: "
              f"{' '.join(unused)}")
    if templated:
        print(f"  {len(templated)} kanji fell back to a template mnemonic: {''.join(templated)}")
    else:
        print("  every kanji has an authored mnemonic")


if __name__ == "__main__":
    main()
