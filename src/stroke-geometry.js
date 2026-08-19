// Pure geometry over KanjiVG stroke paths: turning SVG path data (and raw
// pointer capture) into polylines, and the handful of measurements the
// grader in stroke-grader.js needs from them. No DOM access anywhere in this
// file — testable under plain JavaScriptCore, see test/smoke.js.
//
// KanjiVG stroke paths use only M/m (moveto) and C/c, S/s (cubic Bezier) —
// no lines, no arcs, no quadratics — which is the entire command set
// flattenPath needs to handle.

const COMMAND_RE = /[MmCcSs]|-?\d*\.?\d+(?:e-?\d+)?/g;

function cubicPoint(p0, p1, p2, p3, u) {
  const mu = 1 - u;
  const a = mu * mu * mu;
  const b = 3 * mu * mu * u;
  const c = 3 * mu * u * u;
  const d = u * u * u;
  return [
    a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
    a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1],
  ];
}

/**
 * Flatten an SVG path `d` string into a dense polyline: an array of [x, y]
 * points in document order, starting at the path's moveto. `segmentsPerCurve`
 * controls how finely each Bezier is subdivided — 24 is fine enough that the
 * resulting polyline's length is within a fraction of a percent of the true
 * curve length (checked in test/smoke.js), which is what the length gate in
 * stroke-grader.js relies on.
 */
export function flattenPath(d, segmentsPerCurve = 24) {
  const tokens = String(d).match(COMMAND_RE) || [];
  const points = [];
  let i = 0;
  let cur = [0, 0];
  let cmd = null;
  let prevControl = null; // reflected control point for S/s

  const take = (count) => {
    const nums = [];
    for (let k = 0; k < count; k += 1) nums.push(Number(tokens[i + k]));
    i += count;
    return nums;
  };

  while (i < tokens.length) {
    if (/[MmCcSs]/.test(tokens[i])) {
      cmd = tokens[i];
      i += 1;
    }
    if (cmd === 'M' || cmd === 'm') {
      const [x, y] = take(2);
      cur = cmd === 'M' ? [x, y] : [cur[0] + x, cur[1] + y];
      points.push(cur);
      prevControl = null;
    } else if (cmd === 'C' || cmd === 'c') {
      const [x1, y1, x2, y2, x, y] = take(6);
      const p1 = cmd === 'C' ? [x1, y1] : [cur[0] + x1, cur[1] + y1];
      const p2 = cmd === 'C' ? [x2, y2] : [cur[0] + x2, cur[1] + y2];
      const p3 = cmd === 'C' ? [x, y] : [cur[0] + x, cur[1] + y];
      for (let k = 1; k <= segmentsPerCurve; k += 1) {
        points.push(cubicPoint(cur, p1, p2, p3, k / segmentsPerCurve));
      }
      prevControl = p2;
      cur = p3;
    } else if (cmd === 'S' || cmd === 's') {
      const [x2, y2, x, y] = take(4);
      const p1 = prevControl ? [2 * cur[0] - prevControl[0], 2 * cur[1] - prevControl[1]] : cur;
      const p2 = cmd === 'S' ? [x2, y2] : [cur[0] + x2, cur[1] + y2];
      const p3 = cmd === 'S' ? [x, y] : [cur[0] + x, cur[1] + y];
      for (let k = 1; k <= segmentsPerCurve; k += 1) {
        points.push(cubicPoint(cur, p1, p2, p3, k / segmentsPerCurve));
      }
      prevControl = p2;
      cur = p3;
    } else {
      // Unrecognised command — not expected in KanjiVG data, but bail
      // rather than loop forever on malformed input.
      break;
    }
  }
  return points;
}

export function distance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

/** Total length of a polyline: the sum of its consecutive segment lengths. */
export function polylineLength(points) {
  let length = 0;
  for (let i = 1; i < points.length; i += 1) length += distance(points[i - 1], points[i]);
  return length;
}

/**
 * Resample a polyline to exactly `n` points, evenly spaced by arc length
 * along it. Used to bring a model stroke and a user's drawn stroke to the
 * same point count so they can be compared index-by-index.
 *
 * Returns { points, length } — `length` is the resampled polyline's own
 * length, which for n=48 tracks the input polyline's true length within a
 * fraction of a percent (checked in test/smoke.js), so callers can treat it
 * as "the stroke's length" without keeping the pre-resample value around.
 */
export function resample(points, n = 48) {
  if (points.length === 0) return { points: [], length: 0 };
  if (points.length === 1 || n === 1) {
    return { points: new Array(n).fill(points[0]), length: 0 };
  }

  const cumulative = [0];
  for (let i = 1; i < points.length; i += 1) {
    cumulative.push(cumulative[i - 1] + distance(points[i - 1], points[i]));
  }
  const total = cumulative[cumulative.length - 1];
  if (total === 0) return { points: new Array(n).fill(points[0]), length: 0 };

  const out = [];
  let j = 0;
  for (let k = 0; k < n; k += 1) {
    const target = (total * k) / (n - 1);
    while (j < cumulative.length - 2 && cumulative[j + 1] < target) j += 1;
    const span = Math.max(cumulative[j + 1] - cumulative[j], 1e-9);
    const t = (target - cumulative[j]) / span;
    out.push([
      points[j][0] + t * (points[j + 1][0] - points[j][0]),
      points[j][1] + t * (points[j + 1][1] - points[j][1]),
    ]);
  }
  return { points: out, length: polylineLength(out) };
}

/**
 * Smooth a captured polyline with a [1,2,1]/4 kernel, `passes` times, endpoints
 * held fixed. Raw pointer capture carries tremor that inflates measured path
 * length well beyond what a smooth hand motion actually covers — smoothing
 * before resample() is what keeps the length gate in stroke-grader.js from
 * misfiring on ordinary, if shaky, handwriting.
 */
export function smooth(points, passes = 2) {
  let out = points;
  for (let p = 0; p < passes; p += 1) {
    if (out.length < 3) break;
    const next = [out[0]];
    for (let i = 1; i < out.length - 1; i += 1) {
      next.push([
        (out[i - 1][0] + 2 * out[i][0] + out[i + 1][0]) / 4,
        (out[i - 1][1] + 2 * out[i][1] + out[i + 1][1]) / 4,
      ]);
    }
    next.push(out[out.length - 1]);
    out = next;
  }
  return out;
}

/**
 * Turning points along a resampled polyline: indices where the direction
 * change over a `window`-point span exceeds `thresholdDeg`, non-max-
 * suppressed so a single sharp corner doesn't report twice. Advisory only —
 * see stroke-grader.js — most strokes (roughly 4 in 5) have none at all, so
 * this is never used to reject a stroke, only to hint at a corner worth
 * paying attention to.
 */
export function findCorners(points, { window = 6, thresholdDeg = 55 } = {}) {
  const raw = [];
  for (let i = window; i < points.length - window; i += 1) {
    const a = points[i - window];
    const b = points[i];
    const c = points[i + window];
    const v1 = [b[0] - a[0], b[1] - a[1]];
    const v2 = [c[0] - b[0], c[1] - b[1]];
    const n1 = Math.hypot(v1[0], v1[1]);
    const n2 = Math.hypot(v2[0], v2[1]);
    if (n1 < 1e-6 || n2 < 1e-6) continue;
    const cos = Math.max(-1, Math.min(1, (v1[0] * v2[0] + v1[1] * v2[1]) / (n1 * n2)));
    const angle = (Math.acos(cos) * 180) / Math.PI;
    if (angle > thresholdDeg) raw.push({ index: i, angle });
  }
  const kept = [];
  for (const point of raw) {
    const isLocalMax = raw.every((other) => Math.abs(other.index - point.index) >= 8 || other.angle <= point.angle);
    if (isLocalMax && (kept.length === 0 || point.index - kept[kept.length - 1].index >= 8)) kept.push(point);
  }
  return kept;
}

/**
 * The bounded best-fit translation that would align a whole drawn character
 * onto its model, in the least-squares sense — averaged over every point of
 * every stroke, magnitude clamped to `bound`.
 *
 * Deliberately NOT used to relax grading: see "Guided mode draws the guide
 * at its true position" in writing-mode-plan.md. This exists to report
 * placement drift as coaching feedback ("the whole character sat a bit
 * left") — offset is measured, never subtracted before grading.
 */
export function boundedOffset(userStrokes, modelStrokes, bound = 10) {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let s = 0; s < Math.min(userStrokes.length, modelStrokes.length); s += 1) {
    const user = userStrokes[s];
    const model = modelStrokes[s];
    const count = Math.min(user.length, model.length);
    for (let i = 0; i < count; i += 1) {
      sx += model[i][0] - user[i][0];
      sy += model[i][1] - user[i][1];
      n += 1;
    }
  }
  if (n === 0) return { dx: 0, dy: 0 };
  let dx = sx / n;
  let dy = sy / n;
  const magnitude = Math.hypot(dx, dy);
  if (magnitude > bound) {
    dx = (dx * bound) / magnitude;
    dy = (dy * bound) / magnitude;
  }
  return { dx, dy };
}
