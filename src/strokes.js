// Stroke-order rendering, from data built by tools/build_stroke_data.py out
// of KanjiVG. Two things live here: building the SVG (numbered, static —
// this is what's shown by default) and animating it (an on-demand "Play"
// that draws each stroke in order, then leaves it fully drawn).

import { STROKES } from './stroke-data.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

export function strokesFor(char) {
  return STROKES[char] || null;
}

export function hasStrokes(char) {
  return !!STROKES[char];
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
 * drawn. Safe to call again mid-animation — each call resets from scratch.
 * No-op for a character with no stroke data (paths is then empty).
 */
export function animateStrokes(paths, { strokeMs = 450, gapMs = 150 } = {}) {
  if (!paths.length) return;

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
    setTimeout(() => {
      path.style.transition = `stroke-dashoffset ${strokeMs}ms ease-in-out`;
      path.style.strokeDashoffset = '0';
    }, index * (strokeMs + gapMs));
  });
}
