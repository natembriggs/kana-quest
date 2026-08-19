// Grades a drawn stroke against its KanjiVG model. The design principle,
// argued at length in writing-mode-plan.md, is that a false "incorrect" is
// far more costly than a false "correct": this is practice, not an exam, and
// the correct form is always shown afterwards regardless of the verdict. The
// tolerances below were tuned against a simulated sloppy 12-year-old and a
// simulated 6-year-old with poor motor control until both saw almost no
// false rejections at the default strictness — see the numbers in
// writing-mode-plan.md §2.5, which the tests in test/smoke.js pin in place.

import { distance, flattenPath, polylineLength, resample, smooth } from './stroke-geometry.js';

export const RESAMPLE_POINTS = 48;

// Multiplier applied to every tolerance. 3 (Normal) is the default — tuned
// for a sloppy 12-year-old. 1 (Gentle) is close to position-blind on
// purpose: at that level the bar is "attempted, roughly placed, moving the
// right way", nothing more.
export const STRICTNESS_LEVELS = [
  { id: 1, name: 'Gentle', multiplier: 1.50 },
  { id: 2, name: 'Easy', multiplier: 1.22 },
  { id: 3, name: 'Normal', multiplier: 1.00 },
  { id: 4, name: 'Neat', multiplier: 0.82 },
  { id: 5, name: 'Strict', multiplier: 0.67 },
];

export const DEFAULT_STRICTNESS = 3;

export function strictnessMultiplier(level = DEFAULT_STRICTNESS) {
  const found = STRICTNESS_LEVELS.find((l) => l.id === level);
  return found ? found.multiplier : 1.0;
}

function clamp(value, lo, hi) {
  return Math.max(lo, Math.min(hi, value));
}

/**
 * The three distance tolerances for a stroke of model length `L`, at
 * strictness multiplier `m`. Every floor is an ABSOLUTE minimum, deliberately
 * not scaled down for short strokes: a purely relative radius would demand
 * sub-pixel accuracy on the many small strokes real kanji have (19% of all
 * strokes in the data are under 20 units long), which no hand — child or
 * adult — can meet on a touchscreen. See writing-mode-plan.md §2.3.
 */
export function strokeTolerances(modelLength, multiplier = 1.0) {
  const L = modelLength;
  const m = multiplier;
  return {
    R: clamp(0.45 * L, 17, 36) * m, // endpoint hit radius
    Dmean: clamp(0.36 * L, 14, 30) * m, // mean deviation across resampled points
    Dmax: clamp(0.90 * L, 36, 74) * m, // worst single deviation — scribble catcher
  };
}

/**
 * Prepare a model stroke once (per character, cached by the caller) so
 * repeated grading attempts don't reparse and reflatten the same path.
 * `d` is the raw SVG path string from src/stroke-data.js.
 */
export function prepareModelStroke(d) {
  const dense = flattenPath(d);
  return resample(dense, RESAMPLE_POINTS);
}

/**
 * Grade a stroke already reduced to `RESAMPLE_POINTS` comparable points, both
 * user and model. This is the pure decision function the numbers in
 * writing-mode-plan.md §2.5 were measured against — kept separate from
 * gradeStroke() below so tests can drive it directly with synthetic point
 * sets, the same way the tuning script did.
 *
 * Returns one of: 'ok', 'backwards', 'too-short', 'too-long', 'start',
 * 'end', 'shape', 'wild'. Checked in that order — the first failing check
 * wins, so a stroke that is both backwards AND short is reported as
 * backwards, which is the more useful thing to tell a learner.
 */
export function gradeResampled(userPoints, userLength, modelPoints, modelLength, multiplier = 1.0) {
  const L = modelLength;
  const t = strokeTolerances(L, multiplier);
  const u0 = userPoints[0];
  const uN = userPoints[userPoints.length - 1];
  const m0 = modelPoints[0];
  const mN = modelPoints[modelPoints.length - 1];

  // Direction: only called backwards when pairing the endpoints in reverse
  // is CLEARLY better than pairing them forward — the margin stops a short,
  // near-symmetric stroke (a dot, a tick) from being flagged purely because
  // start and end sit close together anyway. Never relaxed by strictness:
  // stroke direction is the one thing writing practice cannot compromise on.
  const forward = distance(u0, m0) + distance(uN, mN);
  const reverse = distance(u0, mN) + distance(uN, m0);
  if (reverse < forward - Math.max(0.25 * L, 6)) return 'backwards';

  // Length: exists only to catch a stub or a runaway on a short stroke,
  // where the endpoint radius below is necessarily larger than the stroke
  // itself. The upper bound has a large absolute allowance (L + 26) because
  // small strokes get overshot badly, especially by younger writers.
  const slack = 1 + (multiplier - 1) * 0.5;
  const shortFloor = (L < 15 ? 0.35 : 0.55) * L;
  if (userLength < shortFloor / slack) return 'too-short';
  if (userLength > Math.max(L * 2.2, L + 26) * slack) return 'too-long';

  if (distance(u0, m0) > t.R) return 'start';
  if (distance(uN, mN) > t.R) return 'end';

  let sumDeviation = 0;
  let maxDeviation = 0;
  for (let i = 0; i < userPoints.length; i += 1) {
    const d = distance(userPoints[i], modelPoints[i]);
    sumDeviation += d;
    if (d > maxDeviation) maxDeviation = d;
  }
  const meanDeviation = sumDeviation / userPoints.length;
  if (meanDeviation > t.Dmean) return 'shape';
  if (maxDeviation > t.Dmax) return 'wild';

  return 'ok';
}

/**
 * Grade a raw, freshly captured stroke (an array of [x, y] points in the
 * same 109-unit coordinate space as the model, in drawing order) against a
 * prepared model stroke ({ points, length } from prepareModelStroke).
 * Smooths and resamples the capture first — see smooth() in
 * stroke-geometry.js for why that has to happen before any length-based
 * check runs.
 */
export function gradeStroke(rawUserPoints, modelStroke, multiplier = 1.0) {
  const smoothed = smooth(rawUserPoints, 2);
  const { points: userPoints, length: userLength } = resample(smoothed, RESAMPLE_POINTS);
  return gradeResampled(userPoints, userLength, modelStroke.points, modelStroke.length, multiplier);
}

/**
 * Which of several model strokes a drawn stroke fits best, by mean deviation
 * after resampling — used to tell an out-of-order attempt apart from a
 * genuinely wrong one ("that's stroke 4 — stroke 2 comes first"). Returns
 * the index into `modelStrokes`, or -1 if given nothing to compare against.
 */
export function findBestMatchingStroke(rawUserPoints, modelStrokes) {
  if (modelStrokes.length === 0) return -1;
  const smoothed = smooth(rawUserPoints, 2);
  const { points: userPoints } = resample(smoothed, RESAMPLE_POINTS);

  let bestIndex = -1;
  let bestScore = Infinity;
  modelStrokes.forEach((model, index) => {
    let sum = 0;
    for (let i = 0; i < userPoints.length; i += 1) sum += distance(userPoints[i], model.points[i]);
    const score = sum / userPoints.length;
    if (score < bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });
  return bestIndex;
}

export { polylineLength };
