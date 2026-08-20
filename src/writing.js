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

import {
  prepareModelStroke, gradeStroke, findBestMatchingStroke, strictnessMultiplier, DEFAULT_STRICTNESS,
} from './stroke-grader.js';
import { buildStrokeSVG, strokesFor } from './strokes.js';

// KanjiVG's viewBox is always "0 0 109 109" (checked for every character in
// test/smoke.js) — this is that same coordinate space, used for grading.
export const MODEL_SIZE = 109;

/** A character's model strokes, prepared once per attempt rather than once
 * per grading call — see prepareModelStroke in stroke-grader.js. */
export function prepareCharacter(char) {
  const data = strokesFor(char);
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

  /** Start over on the SAME character, from stroke 1 — "Try again".
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

/**
 * Free mode's state machine: no guide, no live rejection — every completed
 * pointer gesture is simply captured as "the next stroke", right or wrong,
 * with nothing graded until the learner presses Done. Deliberately separate
 * from createWritingAttempt() above rather than a mode flag on it: Trace and
 * Guided share one "reject and retry until it's right" model, but Free's
 * "capture everything, review at the end" model is different enough — in
 * particular, the learner can draw a different NUMBER of strokes than the
 * model has, which the reject-and-retry state machine has no way to express.
 */
export function createFreeAttempt(char, { strictness = DEFAULT_STRICTNESS } = {}) {
  const modelStrokes = prepareCharacter(char);
  const multiplier = strictnessMultiplier(strictness);
  const drawn = [];
  let finished = false;
  let review = null;

  function submitStroke(modelSpacePoints) {
    if (finished) return;
    drawn.push(modelSpacePoints);
  }

  /**
   * Aligns drawn strokes to the model strokes sequentially (position N drawn
   * against model stroke N) and grades each pair. A learner who draws fewer
   * or more strokes than the model isn't met with a confusing mismatch
   * error — the shortfall/surplus just shows up per-stroke in the review
   * (each model stroke, in the same order they were taught):
   *   - 'ok' / 'wrong' — a paired attempt, graded normally
   *   - 'missing' — the model has a stroke here but nothing was drawn for it
   *   - 'extra' — a stroke was drawn with no model stroke left to pair it to
   *
   * suggestedCorrect is only ever a SUGGESTION, never what gets recorded —
   * see writing-mode-plan.md: the learner's own yes/no self-grade after
   * seeing this review is what actually commits to spaced repetition.
   */
  function finish() {
    if (finished || !modelStrokes) return review;
    const count = Math.max(drawn.length, modelStrokes.length);
    const perStroke = [];
    for (let i = 0; i < count; i += 1) {
      if (i >= modelStrokes.length) { perStroke.push({ status: 'extra' }); continue; }
      if (i >= drawn.length) { perStroke.push({ status: 'missing', strokeIndex: i }); continue; }
      const verdict = gradeStroke(drawn[i], modelStrokes[i], multiplier);
      perStroke.push({ status: verdict === 'ok' ? 'ok' : 'wrong', verdict, strokeIndex: i });
    }
    const suggestedCorrect = drawn.length === modelStrokes.length && perStroke.every((s) => s.status === 'ok');
    finished = true;
    review = { perStroke, suggestedCorrect };
    return review;
  }

  /** "Try again": same character, blank slate. */
  function restart() {
    drawn.length = 0;
    finished = false;
    review = null;
  }

  return {
    submitStroke,
    finish,
    restart,
    drawnCount: () => drawn.length,
    modelStrokeCount: () => (modelStrokes ? modelStrokes.length : 0),
    // Matches createWritingAttempt's currentStrokeIndex() so "show next
    // stroke" (app.js) can use the same call regardless of attempt type —
    // Free has no notion of a REQUIRED next stroke, but drawnCount is still
    // a reasonable "which one are you probably about to draw".
    currentStrokeIndex: () => Math.min(drawn.length, modelStrokes ? modelStrokes.length - 1 : 0),
    isComplete: () => finished,
    // Only meaningful as a fallback — app.js always has the learner's
    // explicit self-grade by the time a Free attempt finishes.
    isCorrect: () => !!(review && review.suggestedCorrect),
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

/**
 * The stroke-order guide, reusing strokes.js's numbered SVG builder — same
 * source, same look as the character-detail screen. `mode` sets the
 * baseline visibility via a container class, styled in styles.css:
 *   - 'trace'  — every stroke faintly visible from the start
 *   - 'guided' — invisible until each stroke is individually accepted
 *   - 'free'   — invisible throughout drawing, then revealed stroke-by-
 *     stroke as a graded review once markGuideStrokeReview() below is
 *     called for each one
 * Rebuilding the guide (rather than resetting classes on the old one) is
 * also how "Try again" clears prior progress markings in one call.
 */
export function renderGuide(container, char, mode = 'trace') {
  container.innerHTML = '';
  container.className = `writing-guide mode-${mode}`;
  const { svg, paths } = buildStrokeSVG(char);
  container.appendChild(svg);
  return paths;
}

/** Trace/Guided: a stroke was just accepted on a live attempt. */
export function markGuideStrokeDone(paths, index) {
  const path = paths[index];
  if (path && path.classList) path.classList.add('stroke-path-done');
}

/** Free mode's end-of-attempt review — see createFreeAttempt()'s finish().
 * 'extra' strokes have no model path to mark; the caller surfaces those as
 * a count instead (see writingDone() in app.js). */
export function markGuideStrokeReview(paths, index, status) {
  const path = paths[index];
  if (!path || !path.classList) return;
  if (status === 'ok') path.classList.add('stroke-path-done');
  else if (status === 'wrong') path.classList.add('stroke-path-wrong');
  else if (status === 'missing') path.classList.add('stroke-path-missing');
}

/**
 * Hold-to-peek, for Guided/Free where the guide is otherwise hidden — see
 * #writing-hints in index.html. `on` shows or hides it; callers toggle this
 * from a press/release pair, never leaving it stuck showing. Deliberately
 * doesn't touch any stroke already marked done/wrong/missing (styled in
 * styles.css to win over a peek regardless), so revealing the rest of the
 * character never dims out what's already been graded.
 */
export function setGuidePeekFull(container, on) {
  if (!container || !container.classList) return;
  if (on) container.classList.add('peek-full'); else container.classList.remove('peek-full');
}

/** Same idea as setGuidePeekFull, but for a single stroke — "show first
 * stroke" reveals just paths[index] (index 0, from app.js) while held. */
export function setStrokePeek(paths, index, on) {
  const path = paths[index];
  if (!path || !path.classList) return;
  if (on) path.classList.add('stroke-path-peek'); else path.classList.remove('stroke-path-peek');
}
