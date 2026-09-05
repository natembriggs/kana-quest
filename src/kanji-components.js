// Kanji component breakdowns: what a compound kanji is built out of, how the
// parts sit against each other, and the mnemonic that ties the two together.
//
// Data comes from tools/build_kanji_components.py, which reads KanjiVG's
// kvg:element/kvg:position metadata for the decomposition and arrangement,
// KANJIDIC2 plus a curated keyword table for what each component means, and
// tools/kanji_src/kanji-mnemonics.tsv for the sentence. See
// kanji-mnemonic-plan.md §3.
//
// Deliberately a separate module from kanji.js rather than extra fields on
// kanjiInfo(): only some kanji are compound, so this would be a
// sometimes-present field on a record whose others are always there, and
// ensureKanjiUnitLoaded() is a hot path that shouldn't grow a second fetch
// for the sake of the three screens that want components. A screen that
// wants both awaits both; every other screen pays nothing.
//
// Only the units in COMPONENT_UNITS have data (grades 1-3 — see the plan's
// §8 first-pass scope). Everything here returns null for anything else,
// which is the same answer an atomic kanji gets, so no caller needs to know
// the difference.

import { COMPONENT_MEANINGS } from './data/components.js';

/** Units with a generated kanji-components-<unit>.js. Kept in sync by hand
 * with UNITS in tools/build_kanji_components.py — a unit listed here with no
 * data file would throw on import, so the loader treats a failed import as
 * "no components" rather than an error (see ensureComponentUnitLoaded). */
const COMPONENT_UNITS = new Set(['1', '2', '3']);

const byUnit = new Map();       // unit -> { kanji: entry }
const loadedUnits = new Set();
const loadingUnits = new Map(); // unit -> in-flight Promise, dedupes concurrent callers

export { COMPONENT_MEANINGS };

/**
 * Loads one unit's component data. Memoized exactly like
 * ensureKanjiUnitLoaded() — safe to call any number of times for the same
 * unit, the dynamic import happens once. Resolves (rather than rejecting)
 * for a unit with no data, because "this grade has no breakdowns yet" is a
 * normal state for every screen that calls this, not a failure.
 */
export async function ensureComponentUnitLoaded(unit) {
  if (!unit || !COMPONENT_UNITS.has(unit) || loadedUnits.has(unit)) return;
  if (!loadingUnits.has(unit)) {
    loadingUnits.set(unit, import(`./data/kanji-components-${unit}.js`).then((mod) => {
      byUnit.set(unit, mod.KANJI_COMPONENTS);
      loadedUnits.add(unit);
    }).catch(() => {
      // Missing or unparseable chunk: fall back to showing no breakdown
      // rather than breaking the screen that asked for one.
      loadedUnits.add(unit);
    }));
  }
  await loadingUnits.get(unit);
}

/** Whether a unit could ever have component data, without loading it — lets
 * a caller skip the await entirely for grades outside the covered set. */
export function unitHasComponents(unit) {
  return COMPONENT_UNITS.has(unit);
}

/**
 * The breakdown for one kanji, or null — for an atomic kanji, a kanji whose
 * KanjiVG decomposition was too unreliable to show (see the build script),
 * a grade with no data, or a unit not loaded yet. Callers treat all of those
 * the same way: no component block.
 *
 * Shape: { k, arrangement, parts: [{ c, pos, meaning }], mnemonic }
 */
export function kanjiComponents(unit, kanji) {
  const entries = byUnit.get(unit);
  return (entries && entries[kanji]) || null;
}

/**
 * Renders one breakdown into a container of component tiles plus a mnemonic
 * paragraph, and returns whether there was anything to render. Shared by the
 * detail screen, the lesson card and both quiz hint panels, the same way
 * renderReadingChips and fillWordKanjiChips are shared across those screens —
 * the formatting lives next to the data it formats rather than in app.js.
 *
 * `onOpen`, if given, is called with a component character when its tile is
 * tapped; a tile is only made interactive for components the caller says are
 * openable (`canOpen`), so a bare radical like 氵 — which this app never
 * teaches as a kanji of its own — stays a plain tile.
 */
export function renderComponentBreakdown(containerEl, mnemonicEl, entry, { onOpen, canOpen } = {}) {
  if (containerEl) containerEl.innerHTML = '';
  if (mnemonicEl) {
    mnemonicEl.textContent = '';
    mnemonicEl.hidden = true;
  }
  if (!entry) return false;

  if (containerEl) {
    entry.parts.forEach((part) => {
      const openable = typeof canOpen === 'function' && canOpen(part.c);
      const tile = document.createElement(openable ? 'button' : 'div');
      tile.className = 'component-tile';
      if (openable) {
        tile.type = 'button';
        tile.classList.add('component-tile-link');
        tile.addEventListener('click', () => onOpen(part.c));
      }
      const glyph = document.createElement('span');
      glyph.className = 'component-glyph';
      glyph.lang = 'ja';
      glyph.textContent = part.c;
      const label = document.createElement('span');
      label.className = 'component-meaning';
      label.textContent = part.meaning;
      tile.appendChild(glyph);
      tile.appendChild(label);
      containerEl.appendChild(tile);
    });
  }

  if (mnemonicEl && entry.mnemonic) {
    mnemonicEl.textContent = entry.mnemonic;
    mnemonicEl.hidden = false;
  }
  return true;
}
