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
// which is the same answer a kanji with no entry gets, so no caller needs to
// know the difference.
//
// The hint in the data is a DEFAULT. A learner can replace any of them with
// their own wording, kept in profile.mnemonics and synced across their
// devices (§10) — resolveMnemonic() below is what every screen asks, and it
// prefers the learner's own text whenever there is any.

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
 * The record for one kanji, or null — for a grade with no data, a unit not
 * loaded yet, or a kanji nothing could be said about at all.
 *
 * Shape: { k, arrangement, parts: [{ c, pos, meaning }], mnemonic }
 *
 * `parts` is EMPTY for a kanji with no usable decomposition — 犬, 母, 東 and
 * the rest that KanjiVG either cannot break down or breaks down into stroke
 * bookkeeping. Those still carry a hint about how the character looks, so a
 * caller must check `parts.length` before expecting tiles, and must not
 * treat an empty breakdown as "nothing to show".
 */
export function kanjiComponents(unit, kanji) {
  const entries = byUnit.get(unit);
  return (entries && entries[kanji]) || null;
}

/**
 * Renders one breakdown into a container of component tiles plus a hint
 * paragraph, and returns whether there was anything to render. Shared by the
 * detail screen, the lesson card and both quiz hint panels, the same way
 * renderReadingChips and fillWordKanjiChips are shared across those screens —
 * the formatting lives next to the data it formats rather than in app.js.
 *
 * `entry` supplies the parts; `hint` (from resolveMnemonic) supplies the
 * text, and the two are separate arguments because they come from different
 * places — the parts are generated data, the text may be the learner's own.
 * Either can be absent: a kanji with no breakdown still shows its hint, and
 * a kanji with parts still shows them if every hint has been cleared away.
 *
 * `onOpen`, if given, is called with a component character when its tile is
 * tapped; a tile is only made interactive for components the caller says are
 * openable (`canOpen`), so a bare radical like 氵 — which this app never
 * teaches as a kanji of its own — stays a plain tile.
 */
export function renderComponentBreakdown(containerEl, mnemonicEl, entry, hint, { onOpen, canOpen } = {}) {
  if (containerEl) containerEl.innerHTML = '';
  if (mnemonicEl) {
    mnemonicEl.textContent = '';
    mnemonicEl.hidden = true;
    mnemonicEl.classList.remove('is-own');
  }
  // Nothing at all to show: no parts to draw AND no hint of either kind.
  // A kanji with no breakdown but a hint still gets a panel, and so does one
  // where the only text is the learner's own.
  const parts = (entry && entry.parts) || [];
  if (!parts.length && !(hint && hint.text)) return false;

  if (containerEl) {
    parts.forEach((part) => {
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

  if (mnemonicEl && hint && hint.text) {
    mnemonicEl.textContent = hint.text;
    mnemonicEl.hidden = false;
    // Marks a hint the learner wrote themselves, so their own words are
    // never mistaken for the app's — and so it is obvious at a glance which
    // characters they have already made their own.
    mnemonicEl.classList.toggle('is-own', !!hint.custom);
  }
  return true;
}

// --- The learner's own wording -------------------------------------------
//
// Everything above is the built-in default. A learner who thinks of a better
// hook for a character can overwrite it, and their version is what every
// screen shows from then on. Kept per profile and synced (mergeMnemonics in
// merge.js) rather than per device, because a hint someone wrote on their
// phone is exactly the kind of thing that should be waiting on their tablet.

/**
 * What to actually show for `kanji`: the learner's own hint if they have
 * written one, otherwise the built-in. Returns
 * `{ text, custom }`, or null when there is nothing to show at all.
 *
 * An override whose text is empty is a deliberate "put the built-in back",
 * not a blank hint — see mergeMnemonics. It resolves to the built-in, and to
 * null when there is no built-in either.
 */
export function resolveMnemonic(profile, unit, kanji) {
  // Note there is no "is this kanji eligible" check anywhere: writing your
  // own hint works on every kanji the app teaches, including the grades this
  // feature has no built-in wording for yet. The override store is
  // unit-agnostic, so a learner on grade 5 can start keeping their own hints
  // today and the built-ins will simply appear underneath them later.
  const entry = kanjiComponents(unit, kanji);
  const own = ((profile && profile.mnemonics) || {})[kanji];
  const ownText = own && typeof own.text === 'string' ? own.text.trim() : '';
  if (ownText) return { text: ownText, custom: true };
  const builtIn = entry && entry.mnemonic ? entry.mnemonic : '';
  return builtIn ? { text: builtIn, custom: false } : null;
}

/** Whether the learner has written their own hint for this kanji — drives
 * the "Add" vs "Edit" wording on the button, and whether a "use the built-in
 * one instead" option is worth offering at all. */
export function hasOwnMnemonic(profile, kanji) {
  const own = ((profile && profile.mnemonics) || {})[kanji];
  return !!(own && typeof own.text === 'string' && own.text.trim());
}

// A hint is a sentence or two, not an essay. The cap is generous enough for
// anything anyone would actually write and small enough that a runaway paste
// can't bloat a profile that syncs.
export const MNEMONIC_MAX_LENGTH = 400;

/**
 * Builds the inline hint editor into `containerEl`, replacing whatever is
 * there. Inline rather than a dialog on purpose: the thing being edited is
 * three lines of text sitting directly above the character and its parts,
 * and a modal would hide exactly the context someone needs to write a good
 * hint.
 *
 * `onSave` is called with the trimmed text (empty string means "put the
 * built-in back"); `onCancel` with nothing. The caller owns repainting
 * afterwards — this function only collects the text.
 */
export function renderMnemonicEditor(containerEl, { current, canReset, onSave, onCancel }) {
  containerEl.innerHTML = '';

  const field = document.createElement('textarea');
  field.className = 'mnemonic-input';
  field.rows = 3;
  field.maxLength = MNEMONIC_MAX_LENGTH;
  field.value = current || '';
  field.setAttribute('aria-label', 'Your memory hint for this kanji');
  field.placeholder = 'Whatever makes it stick for you.';

  const row = document.createElement('div');
  row.className = 'row mnemonic-editor-actions';

  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'btn btn-primary';
  save.textContent = 'Save';
  save.addEventListener('click', () => onSave(field.value.trim()));

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'btn btn-quiet';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', () => onCancel());

  row.appendChild(save);
  row.appendChild(cancel);
  containerEl.appendChild(field);
  containerEl.appendChild(row);

  // Only worth offering once there is something of their own to undo —
  // otherwise it would read as a way to delete the built-in hint, which it
  // is not.
  if (canReset) {
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'btn btn-quiet wide mnemonic-reset';
    reset.textContent = 'Use the built-in hint instead';
    reset.addEventListener('click', () => onSave(''));
    containerEl.appendChild(reset);
  }

  // Focus lands at the END of existing text, not the start: someone opening
  // "Edit" almost always wants to adjust what is there, and a cursor parked
  // before their own first word is the wrong place to start.
  field.focus();
  field.setSelectionRange(field.value.length, field.value.length);
  return field;
}
