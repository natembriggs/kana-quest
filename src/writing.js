// Writing mode: the canvas widget and the per-character grading state
// machine described in writing-mode-plan.md.
//
// Split deliberately in two, same spirit as strokes.js:
//   - createWritingAttempt() is the DOM-independent state machine — which
//     stroke is next, whether every stroke so far was accepted on its first
//     try, when the character is done. It only ever sees points already in
//     the model's own 0-109 coordinate space, so it is directly testable
//     (see test/wiring.js) without a real canvas or realistic hand-drawn
//     input.
//   - Everything else here (canvas sizing, ink rendering, the guide) touches
//     the DOM. Pointer event wiring itself lives in app.js, alongside every
//     other event listener in the app — this module hands app.js the pieces
//     (coordinate mapping, drawing) rather than owning the listeners.

import { STROKES } from './stroke-data.js';
import {
  prepareModelStroke, gradeStroke, findBestMatchingStroke, strictnessMultiplier, DEFAULT_STRICTNESS,
} from './stroke-grader.js';
import { buildStrokeSVG } from './strokes.js';

// KanjiVG's viewBox is always "0 0 109 109" (checked for every character in
// test/smoke.js) — this is that same coordinate space, used for grading.
export const MODEL_SIZE = 109;

/** A character's model strokes, prepared once per attempt rather than once
 * per grading call — see prepareModelStroke in stroke-grader.js. */
export function prepareCharacter(char) {
  const data = STROKES[char];
  if (!data) return null;
  return data.strokes.map((d) => prepareModelStroke(d));
}

/**
 * The state machine behind one character's writing attempt. See the module
 * comment above for why this has no idea about canvas or pointer events.
 */
export function createWritingAttempt(char, { strictness = DEFAULT_STRICTNESS } = {}) {
  const modelStrokes = prepareCharacter(char);
  const multiplier = strictnessMultiplier(strictness);
  let strokeIndex = 0;
  let everyStrokeFirstTry = true;
  let done = false;

  function submitStroke(modelSpacePoints) {
    if (done || !modelStrokes || modelStrokes.length === 0) return { verdict: 'no-model' };
    const model = modelStrokes[strokeIndex];
    const verdict = gradeStroke(modelSpacePoints, model, multiplier);

    if (verdict === 'ok') {
      const acceptedIndex = strokeIndex;
      strokeIndex += 1;
      if (strokeIndex >= modelStrokes.length) done = true;
      return { verdict, strokeIndex: acceptedIndex, complete: done };
    }

    everyStrokeFirstTry = false;
    // Out-of-order hint: does this attempt actually fit a LATER stroke
    // better than the one it was just scored against? Advisory only — the
    // rejection above still stands, this only changes what the learner is
    // told, e.g. "that's stroke 4 — stroke 2 comes first".
    let matchedLaterStroke = null;
    if (strokeIndex + 1 < modelStrokes.length) {
      const laterIndex = findBestMatchingStroke(modelSpacePoints, modelStrokes.slice(strokeIndex + 1));
      if (laterIndex !== -1) matchedLaterStroke = strokeIndex + 1 + laterIndex;
    }
    return { verdict, strokeIndex, complete: false, matchedLaterStroke };
  }

  /** Start over on the SAME character, from stroke 1 — "Write it again".
   * Deliberately does not reset everyStrokeFirstTry: a redo is for the look
   * of the result, not a second chance at the record, and callers read
   * isCorrect() from the original attempt before calling this. */
  function restart() {
    strokeIndex = 0;
    done = false;
  }

  return {
    submitStroke,
    restart,
    strokeCount: () => (modelStrokes ? modelStrokes.length : 0),
    currentStrokeIndex: () => strokeIndex,
    isComplete: () => done,
    // Correct per the same first-attempt-locks-the-record rule every other
    // mode in this app uses (see README, "A wrong tap gets one more try").
    isCorrect: () => done && everyStrokeFirstTry,
    hasModel: () => !!modelStrokes && modelStrokes.length > 0,
  };
}

// --- Canvas: sizing, ink, guide ---------------------------------------------

/**
 * Size a canvas element for its actual CSS box at the current device pixel
 * ratio, and return its 2D context already scaled so every subsequent draw
 * call can use CSS-pixel coordinates directly. Falls back to a fixed size
 * when the element has no real layout box yet (e.g. the JSC test stub, whose
 * getBoundingClientRect() always reports zero — see test/wiring.js), the
 * same defend-don't-crash approach strokes.js takes for missing SVG
 * geometry.
 */
export function setupCanvas(canvas) {
  const rect = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : null;
  const width = (rect && rect.width) || canvas.width || 300;
  const height = (rect && rect.height) || canvas.height || 300;
  const ratio = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;

  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);

  const ctx = canvas.getContext && canvas.getContext('2d');
  if (!ctx) return null;
  if (ctx.scale) ctx.scale(ratio, ratio);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3;
  ctx.strokeStyle = inkColor();
  return { ctx, width, height };
}

function inkColor() {
  if (typeof document === 'undefined' || !document.documentElement || !document.documentElement.style
    || typeof getComputedStyle !== 'function') {
    return '#23201e';
  }
  const value = getComputedStyle(document.documentElement).getPropertyValue('--ink').trim();
  return value || '#23201e';
}

export function clearCanvas(canvasCtx, width, height) {
  if (!canvasCtx || !canvasCtx.clearRect) return;
  canvasCtx.clearRect(0, 0, width, height);
}

/** Redraws every stroke (each an array of [x, y] CSS-pixel points) from
 * scratch — simpler and more robust than incremental lineTo bookkeeping
 * across separate pointer-move calls, at a point-count too small to matter
 * for performance. */
export function redrawInk(canvasCtx, width, height, strokes) {
  if (!canvasCtx || !canvasCtx.beginPath) return;
  clearCanvas(canvasCtx, width, height);
  strokes.forEach((points) => {
    if (points.length < 2) return;
    canvasCtx.beginPath();
    canvasCtx.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i += 1) canvasCtx.lineTo(points[i][0], points[i][1]);
    canvasCtx.stroke();
  });
}

/** Maps a point already in canvas-local CSS-pixel space (i.e.
 * clientX/Y - rect.left/top) into the model's 0-109 coordinate space. */
export function toModelSpace(localPoint, boxWidth, boxHeight) {
  const width = boxWidth || 1;
  const height = boxHeight || 1;
  return [(localPoint[0] / width) * MODEL_SIZE, (localPoint[1] / height) * MODEL_SIZE];
}

/** The faint full-model guide for Trace mode: reuses strokes.js's numbered
 * SVG builder — same source, same look as the character-detail screen. */
export function renderGuide(container, char) {
  container.innerHTML = '';
  const { svg, paths } = buildStrokeSVG(char);
  container.appendChild(svg);
  return paths;
}

export function markGuideStrokeDone(paths, index) {
  const path = paths[index];
  if (path && path.classList) path.classList.add('stroke-path-done');
}

export function resetGuideProgress(paths) {
  paths.forEach((path) => { if (path.classList) path.classList.remove('stroke-path-done'); });
}
