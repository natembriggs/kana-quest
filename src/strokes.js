// Stroke-order rendering, from data built by tools/build_stroke_data.py out
// of KanjiVG. Two things live here: building the SVG (numbered, static —
// this is what's shown by default) and animating it — either an on-demand
// "Play" that draws each stroke in order once and leaves it fully drawn, or
// (with `loop: true`) a repeating gif-like cycle for introducing a brand-new
// character, where watching it draw itself more than once is the point.
//
// Kana stroke data is small and always loaded — every screen that can show
// writing practice needs it, kana or kanji. Kanji stroke data is loaded
// lazily per grade, same split and same reasoning as kanji.js's per-kanji
// data — see kanji-expansion-plan.md §4 and ensureStrokeUnitLoaded() below.
// strokesFor/hasStrokes/buildStrokeSVG stay synchronous either way; the
// caller is responsible for having awaited a unit's load first (via
// app.js's ensureUnitReady()) before asking about a kanji in it.

import { STROKES as KANA_STROKES } from './data/stroke-kana.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

const strokeStore = new Map(Object.entries(KANA_STROKES));

const loadedStrokeUnits = new Set();
const loadingStrokeUnits = new Map(); // unit -> in-flight Promise, dedupes concurrent callers

/** Loads one unit's stroke data and merges it into strokeStore. Memoized,
 * same contract as kanji.js's ensureKanjiUnitLoaded() — safe to call
 * repeatedly, only fetches once per unit. */
export async function ensureStrokeUnitLoaded(unit) {
  if (loadedStrokeUnits.has(unit)) return;
  if (!loadingStrokeUnits.has(unit)) {
    loadingStrokeUnits.set(unit, import(`./data/stroke-grade-${unit}.js`).then((mod) => {
      Object.entries(mod.STROKES).forEach(([char, data]) => strokeStore.set(char, data));
      loadedStrokeUnits.add(unit);
    }));
  }
  await loadingStrokeUnits.get(unit);
}

export function strokesFor(char) {
  return strokeStore.get(char) || null;
}

export function hasStrokes(char) {
  return strokeStore.has(char);
}

/** Every [char, data] pair currently loaded — test-only (test/smoke.js wants
 * to exhaustively check stroke data across every grade at once, unlike the
 * app itself, which never needs more than what's currently on screen). */
export function allStrokeEntries() {
  return [...strokeStore.entries()];
}

/**
 * Build an SVG element for a character: one <path> per stroke, in writing
 * order, each labelled with its stroke number. Numbers are placed at each
 * path's actual start point via the browser's own SVG geometry
 * (getPointAtLength), not by parsing label coordinates out of the source —
 * simpler, and correct by construction rather than by copying KanjiVG's own
 * layout math.
 *
 * Returns { svg, paths }; `paths` is the ordered array of stroke <path>
 * elements, which is what animateStrokes() needs.
 */
export function buildStrokeSVG(char) {
  const data = strokesFor(char);
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', data ? data.viewBox : '0 0 109 109');
  svg.classList.add('stroke-svg');

  if (!data) {
    // No stroke data for this character — fall back to just the glyph, so a
    // gap in coverage degrades gracefully instead of showing an empty box.
    const text = document.createElementNS(SVG_NS, 'text');
    text.setAttribute('x', '50%');
    text.setAttribute('y', '62%');
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('class', 'stroke-fallback-glyph');
    text.textContent = char;
    svg.appendChild(text);
    return { svg, paths: [] };
  }

  const paths = data.strokes.map((d, index) => {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    path.setAttribute('class', 'stroke-path');
    path.dataset.strokeIndex = String(index);
    svg.appendChild(path);
    return path;
  });

  paths.forEach((path, index) => {
    let point;
    try {
      point = path.getPointAtLength(0);
    } catch {
      point = null; // not every environment implements SVG geometry (see test stub)
    }
    if (!point) return;
    const label = document.createElementNS(SVG_NS, 'text');
    label.setAttribute('x', String(point.x - 3));
    label.setAttribute('y', String(point.y - 2));
    label.setAttribute('class', 'stroke-number');
    label.textContent = String(index + 1);
    svg.appendChild(label);
  });

  return { svg, paths };
}

/**
 * Play the strokes drawing in, one after another, then leave them fully
 * drawn — or, with `loop: true`, pause and do it again, indefinitely, like a
 * gif. Safe to call again mid-animation — each call resets from scratch.
 * No-op for a character with no stroke data (paths is then empty).
 *
 * Returns a stop function. The caller is responsible for calling it before
 * starting another loop or navigating away, since nothing here can detect
 * that on its own — the paths are just detached SVG nodes at that point, not
 * an error, but the timers would otherwise keep firing against them forever
 * for the life of the page (this is a single-page app, so nothing reloads to
 * clear them naturally).
 */
export function animateStrokes(paths, { strokeMs = 450, gapMs = 150, loop = false, loopPauseMs = 900 } = {}) {
  if (!paths.length) return () => {};

  let stopped = false;
  const timers = [];
  const after = (fn, delay) => { timers.push(setTimeout(fn, delay)); };

  function drawIn() {
    paths.forEach((path) => {
      let length;
      try {
        length = path.getTotalLength();
      } catch {
        return; // geometry unavailable — leave the path statically visible
      }
      path.style.transition = 'none';
      path.style.strokeDasharray = String(length);
      path.style.strokeDashoffset = String(length);
    });

    // Force layout so the reset above is committed before the transition
    // below is applied — otherwise the browser can coalesce the two and the
    // draw-in never visibly happens.
    void paths[0].getBoundingClientRect();

    paths.forEach((path, index) => {
      after(() => {
        if (stopped) return;
        path.style.transition = `stroke-dashoffset ${strokeMs}ms ease-in-out`;
        path.style.strokeDashoffset = '0';
      }, index * (strokeMs + gapMs));
    });

    if (loop) {
      const drawnMs = (paths.length - 1) * (strokeMs + gapMs) + strokeMs;
      after(() => { if (!stopped) drawIn(); }, drawnMs + loopPauseMs);
    }
  }

  drawIn();

  return () => {
    stopped = true;
    timers.forEach(clearTimeout);
  };
}
