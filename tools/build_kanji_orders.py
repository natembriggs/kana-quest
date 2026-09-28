"""Build src/data/kanji-orders.js: the two teaching orders other than school
grade, as re-cuts of the SAME kanji the grade order teaches.

See kanji-expansion-plan.md §3. School grade stays the app's default and is
not written here at all — it is KANJI_UNITS in the manifest, which
build_kanji_data.py already produces. The two orders here are views over
that set, never a second copy: a kanji's data still lives in its school-grade
file, and progress is keyed by the kanji, so switching order loses nothing.

  * jlpt  — N5 → N1 by Jonathan Waller's community lists
            (tools/kanji_src/jlpt-levels.tsv), then the jōyō kanji no list
            covers, then the rest of the names & places set. Inside a level,
            school-grade order. The big levels are cut into sub-units the
            size of the secondary ones, so no single unit runs to 1,200.

  * trail — "Kanji Trail" order: school-grade order, except that a kanji
            used as a component of another is taught just before the first
            kanji whose hint builds on it (kana-quest-feedback#25: 城's hint
            is "earth beside turn into", but 成 came later). Components are
            pulled forward from anywhere in jōyō, across grade boundaries;
            names & places kanji are never pulled (a primary learner should
            not meet 袁 or 彦 just because 遠 and 顔 contain them — the tile
            already names them with a meaning, as it does 氵). Each kanji
            belongs to the stage it is taught in, so stage 1 is grade 1 plus
            whatever grade 1's hints lean on.

Inputs are all generated or hand-maintained files already in the repo, so
this needs no downloaded source data and runs in well under a second:
src/data/kanji-manifest.js, src/data/kanji-components-*.js and
tools/kanji_src/jlpt-levels.tsv. Re-run it after either of the other two
kanji build scripts.

Usage:
    python3 tools/build_kanji_orders.py
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "src" / "data"
MANIFEST = DATA_DIR / "kanji-manifest.js"
JLPT_TSV = ROOT / "tools" / "kanji_src" / "jlpt-levels.tsv"
OUT = DATA_DIR / "kanji-orders.js"

# Sub-unit size for the big JLPT levels — the same ~185 the secondary
# grade-8 split uses (build_kanji_data.py), so a unit is a similar amount of
# work whichever order it is met in.
TARGET_UNIT_SIZE = 185


def unit_key(unit):
    return [int(part) for part in unit.split("-")]


def is_names_unit(unit):
    return unit.startswith("9-")


def load_grade_units():
    text = MANIFEST.read_text(encoding="utf-8")
    units = json.loads(re.search(r"KANJI_UNITS = (\{.*?\});", text, re.S).group(1))
    return [(unit, units[unit]) for unit in sorted(units, key=unit_key)]


def load_components():
    """{kanji: [component chars]} over every generated components file."""
    parts = {}
    for path in sorted(DATA_DIR.glob("kanji-components-*.js")):
        text = path.read_text(encoding="utf-8")
        data = json.loads(re.search(r"KANJI_COMPONENTS = (\{.*\});", text, re.S).group(1))
        for kanji, entry in data.items():
            parts[kanji] = [p["c"] for p in entry["parts"]]
    return parts


def load_jlpt():
    levels = {}
    for line in JLPT_TSV.read_text(encoding="utf-8").splitlines():
        if not line.strip() or line.startswith("#"):
            continue
        kanji, level = line.split("\t")
        levels[kanji] = int(level)
    return levels


def split_evenly(chars, prefix):
    """One unit if it is already small, else N near-equal sub-units named
    prefix-1..prefix-N."""
    count = max(1, round(len(chars) / TARGET_UNIT_SIZE))
    if count == 1:
        return [(prefix, chars)]
    out = []
    start = 0
    for i in range(count):
        end = start + (len(chars) - start) // (count - i)
        out.append((f"{prefix}-{i + 1}", chars[start:end]))
        start = end
    return out


def jlpt_order(grade_units, levels):
    sequence = [c for _, chars in grade_units for c in chars]
    names = {c for unit, chars in grade_units if is_names_unit(unit) for c in chars}
    units = []
    for level in (5, 4, 3, 2, 1):
        chars = [c for c in sequence if levels.get(c) == level]
        units.extend(split_evenly(chars, f"N{level}"))
    unlisted = [c for c in sequence if c not in levels]
    units.append(("NJ", [c for c in unlisted if c not in names]))
    units.extend(split_evenly([c for c in unlisted if c in names], "NP"))
    return units


def trail_order(grade_units, parts):
    joyo = {c for unit, chars in grade_units if not is_names_unit(unit) for c in chars}
    emitted = set()
    units = []
    pulled = []

    def emit(kanji, out, as_component=False):
        # Marked before recursing, so a component loop (none exist today)
        # would break rather than recurse forever.
        emitted.add(kanji)
        for part in parts.get(kanji, []):
            if part in joyo and part not in emitted:
                emit(part, out, True)
        if as_component:
            pulled.append(kanji)
        out.append(kanji)

    for unit, chars in grade_units:
        if is_names_unit(unit):
            # Never reordered and never pulled from: the grade order's own
            # names & places units are reused as they are.
            continue
        out = []
        for kanji in chars:
            if kanji not in emitted:
                emit(kanji, out)
        units.append((f"T{unit}", out))
    return units, pulled


def check(name, units, grade_units):
    """Every order must teach exactly the grade order's kanji, once each."""
    expected = [c for unit, chars in grade_units for c in chars]
    got = [c for _, chars in units for c in chars]
    if name == "trail":
        got += [c for unit, chars in grade_units if is_names_unit(unit) for c in chars]
    if sorted(got) != sorted(expected) or len(set(got)) != len(got):
        raise SystemExit(f"{name}: does not cover the grade order's kanji exactly once")


def main():
    grade_units = load_grade_units()
    parts = load_components()
    levels = load_jlpt()
    orders = {
        "jlpt": jlpt_order(grade_units, levels),
    }
    orders["trail"], pulled = trail_order(grade_units, parts)
    for name, units in orders.items():
        check(name, units, grade_units)

    home_stage = {c: unit for unit, chars in grade_units for c in chars}
    trail_stage = {c: unit[1:] for unit, chars in orders["trail"] for c in chars}
    earlier_stage = [c for c in pulled if trail_stage[c] != home_stage[c]]

    lines = [
        "// Generated by tools/build_kanji_orders.py — do not hand-edit.",
        "// JLPT levels: Jonathan Waller's lists, www.tanos.co.uk/jlpt (CC BY),",
        "// via github.com/davidluzgouveia/kanji-data (MIT). Estimates only: the",
        "// JLPT publishes no official kanji list.",
        "",
        "// KANJI_ORDER_UNITS[order][unit]: the kanji of one teaching unit, as a",
        "// string (split with Array.from), in that order's teaching sequence.",
        "// Units are listed in teaching order. School grade is not here — it is",
        "// KANJI_UNITS in kanji-manifest.js. See kanji-expansion-plan.md §3.",
        "export const KANJI_ORDER_UNITS = "
        + json.dumps(
            {name: {unit: "".join(chars) for unit, chars in units} for name, units in orders.items()},
            ensure_ascii=False, indent=2,
        )
        + ";",
        "",
    ]
    OUT.write_text("\n".join(lines), encoding="utf-8")
    print(f"wrote {OUT} ({OUT.stat().st_size} bytes)")
    for name, units in orders.items():
        print(f"  {name}: " + ", ".join(f"{u} {len(c)}" for u, c in units))
    print(f"  trail: {len(pulled)} kanji moved ahead to sit before a kanji built on them, "
          f"{len(earlier_stage)} of them into an earlier stage than their grade")


if __name__ == "__main__":
    main()
