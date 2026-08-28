// Headless tests for the pure logic (kana tables, answer checking, SRS).
// There is no Node on this machine; run with macOS JavaScriptCore:
//
//   /System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc \
//       -m test/smoke.js
//
// Must be run from the repo root, since paths below are relative to it.

load('vendor/wanakana.min.js');
globalThis.window = { wanakana: globalThis.wanakana };

const {
  COURSES, romajiFor, writingPromptFor, checkRomaji, buildChoices,
} = await import('../src/kana.js');
const {
  KANJI_COURSES, kanjiInfo, readingExample, meaningLabel,
  buildKanjiOptions, buildAdvancedAdditions, buildDefinitionChoices, recomputeKanjiRollup,
  ensureKanjiUnitLoaded, kanjiUnitFor, areAllKanjiUnitsLoaded,
} = await import('../src/kanji.js');
// strokesFor/hasStrokes are pure lookups (no DOM access at import or call
// time); buildStrokeSVG/animateStrokes touch `document` and are exercised in
// test/wiring.js's stubbed DOM instead, not here.
const { strokesFor, hasStrokes, ensureStrokeUnitLoaded, allStrokeEntries } = await import('../src/strokes.js');
const srs = await import('../src/srs.js');
const {
  flattenPath, polylineLength, resample, smooth, distance, findCorners, boundedOffset, chordBulge,
} = await import('../src/stroke-geometry.js');
const grader = await import('../src/stroke-grader.js');

let failures = 0;
function check(name, condition, detail) {
  if (condition) return;
  failures += 1;
  print(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
}
function done(name) { print(`ok    ${name}`); }

// --- Load everything up front -----------------------------------------------
// The real app loads a grade's kanji/stroke data lazily, on demand — see
// kanji-expansion-plan.md §4. This suite exhaustively checks every grade at
// once, so unlike the app it loads everything up front, right here, before
// any of the checks below run.

const kanjiUnits = KANJI_COURSES.map((c) => c.unit);
const indexBefore = KANJI_COURSES[0].index; // same Map object, checked below

await Promise.all(kanjiUnits.map((unit) => Promise.all([
  ensureKanjiUnitLoaded(unit),
  ensureStrokeUnitLoaded(unit),
])));
// Reconstructs the same shape the old, monolithic src/stroke-data.js used to
// export — everything below this point that iterates STROKES is unchanged.
const STROKES = Object.fromEntries(allStrokeEntries());

// Units split into two families: the official 2,136-kanji jōyō set (grades
// "1".."6"/"8-N") and the beyond-jōyō "names & places" set ("9-N", see
// kanji-expansion-plan.md §5) — the former has an official count to check
// tightly, the latter is data-derived (jinmeiyō ∪ freq-ranked non-jōyō,
// filtered to characters KanjiVG can actually draw) so only a loose sanity
// bound applies.
const manifestCoverage = new Set();
const joyoCoverage = new Set();
const beyondCoverage = new Set();
let manifestDuplicates = 0;
for (const course of KANJI_COURSES) {
  const family = course.unit.startsWith('9-') ? beyondCoverage : joyoCoverage;
  for (const char of course.chunks.flatMap((c) => c.items)) {
    if (manifestCoverage.has(char)) manifestDuplicates += 1;
    manifestCoverage.add(char);
    family.add(char);
  }
}
check('the manifest covers 2130-2140 jōyō kanji with no duplicates across units',
  manifestDuplicates === 0 && joyoCoverage.size >= 2130 && joyoCoverage.size <= 2140,
  `${joyoCoverage.size} unique jōyō, ${manifestDuplicates} duplicate(s)`);
check('the beyond-jōyō "names & places" set is a substantial, bounded addition',
  beyondCoverage.size >= 700 && beyondCoverage.size <= 1100,
  `${beyondCoverage.size} unique beyond-jōyō kanji`);
check('every loaded course has real per-kanji data, not just the skeleton',
  KANJI_COURSES.every((c) => c.chunks.flatMap((ch) => ch.items).every((k) => !!kanjiInfo(c, k))));
check('kanjiUnitFor resolves every manifest character to its real, now-loaded course',
  [...manifestCoverage].every((char) => {
    const unit = kanjiUnitFor(char);
    return unit && KANJI_COURSES.some((c) => c.unit === unit && c.index.has(char));
  }));
check('areAllKanjiUnitsLoaded reports true once every unit has actually been loaded',
  areAllKanjiUnitsLoaded());

// Loading is memoized: re-requesting an already-loaded unit must be a no-op
// (same Map instance, not rebuilt), so concurrent callers can never race
// each other into inconsistent state.
await ensureKanjiUnitLoaded(KANJI_COURSES[0].unit);
check('re-loading an already-loaded unit is a no-op (same Map instance, memoized)',
  KANJI_COURSES[0].index === indexBefore);

done('kanji data manifest and lazy loading');

// --- Tables ---------------------------------------------------------------

const hiragana = COURSES.find((c) => c.id === 'hiragana');
const katakana = COURSES.find((c) => c.id === 'katakana');

check('hiragana chunk count', hiragana.chunks.length === 21, `got ${hiragana.chunks.length}`);
const hiraChars = hiragana.chunks.flatMap((c) => c.items);
check('hiragana character count', hiraChars.length === 104, `got ${hiraChars.length}`);
check('no duplicate hiragana', new Set(hiraChars).size === hiraChars.length);

const kataChars = katakana.chunks.flatMap((c) => c.items);
check('katakana mirrors hiragana', kataChars.length === hiraChars.length);
check('no duplicate katakana', new Set(kataChars).size === kataChars.length);
check('katakana really is katakana', kataChars.every((c) => !hiraChars.includes(c)));
done('tables');

// --- Stroke-order data coverage --------------------------------------------
// A yōon like きゃ is two graphemes (き, ゃ), each with its own KanjiVG entry —
// STROKES is keyed by single character only, per tools/build_stroke_data.py,
// so coverage has to be checked grapheme by grapheme, not against the
// 1-or-2-character strings kana.js's chunks actually contain.

let missingKanaStrokes = 0;
for (const item of [...hiraChars, ...kataChars]) {
  for (const grapheme of Array.from(item)) {
    if (!hasStrokes(grapheme)) missingKanaStrokes += 1;
  }
}
check('every kana grapheme (including yōon components) has stroke data',
  missingKanaStrokes === 0, `${missingKanaStrokes} missing`);

let missingKanjiStrokes = 0;
let kanjiWithStrokes = 0;
for (const course of KANJI_COURSES) {
  for (const kanji of course.chunks.flatMap((c) => c.items)) {
    if (hasStrokes(kanji)) kanjiWithStrokes += 1;
    else missingKanjiStrokes += 1;
  }
}
check('every taught kanji (jōyō and beyond-jōyō) has stroke data',
  missingKanjiStrokes === 0, `${missingKanjiStrokes} missing`);
check('stroke coverage was actually exercised, not vacuously empty',
  kanjiWithStrokes > 1000, `only checked ${kanjiWithStrokes}`);

// The data itself has to be usable, not just present: a real viewBox and at
// least one non-empty path per stroke.
let malformedStrokeData = 0;
for (const grapheme of new Set([...hiraChars, ...kataChars].flatMap((s) => Array.from(s)))) {
  const data = strokesFor(grapheme);
  if (!data) continue;
  if (!/^-?\d+(\.\d+)? -?\d+(\.\d+)? \d+(\.\d+)? \d+(\.\d+)?$/.test(data.viewBox)) malformedStrokeData += 1;
  if (data.strokes.length === 0 || data.strokes.some((d) => !d || d.length < 2)) malformedStrokeData += 1;
}
check('stroke data has a well-formed viewBox and non-empty stroke paths',
  malformedStrokeData === 0, `${malformedStrokeData} malformed`);

// 一 (one) is the simplest possible check: exactly one stroke, a single
// horizontal line — if this is wrong, everything downstream is suspect.
const ichiStrokes = strokesFor('一');
check('一 has exactly one stroke', ichiStrokes && ichiStrokes.strokes.length === 1,
  ichiStrokes ? ichiStrokes.strokes.length : 'missing');

done('stroke-order data covers every kana grapheme and every kyoiku kanji');

// --- Stroke geometry: bezier flattening, resampling, smoothing ------------
// Pure geometry, checked against paths whose true endpoints and length are
// known by construction, before trusting it on real KanjiVG data below.

const straightLine = flattenPath('M0,0C10,0,20,0,30,0'); // a cubic that is a straight line
check('flattenPath starts and ends at the path\'s declared coordinates',
  distance(straightLine[0], [0, 0]) < 1e-6 && distance(straightLine[straightLine.length - 1], [30, 0]) < 1e-6);
check('flattenPath measures a straight line at its true length',
  Math.abs(polylineLength(straightLine) - 30) < 1e-6, `got ${polylineLength(straightLine)}`);

const bump = flattenPath('M0,0C0,50,50,50,50,0'); // a symmetric curved bump
const bumpResampled = resample(bump, 48);
check('resample() holds the curve\'s own endpoints fixed',
  distance(bumpResampled.points[0], bump[0]) < 1e-6
  && distance(bumpResampled.points[47], bump[bump.length - 1]) < 1e-6);
const bumpTrueLength = polylineLength(bump);
check('resampling to 48 points preserves arc length within 2%',
  Math.abs(bumpResampled.length - bumpTrueLength) / bumpTrueLength < 0.02,
  `resampled ${bumpResampled.length.toFixed(2)}, true ${bumpTrueLength.toFixed(2)}`);

const zigzag = smooth([[0, 0], [1, 5], [2, -5], [3, 5], [4, 0]], 2);
check('smooth() holds the first and last point fixed',
  distance(zigzag[0], [0, 0]) < 1e-9 && distance(zigzag[zigzag.length - 1], [4, 0]) < 1e-9);

// findCorners() and boundedOffset() are advisory / feedback-only — see
// writing-mode-plan.md — but still pure and worth pinning now, before later
// phases build UI on top of them.
const straightPolyline = resample(flattenPath('M0,0C25,0,75,0,100,0'), 48).points;
check('findCorners reports nothing on a straight line',
  findCorners(straightPolyline).length === 0);

const lShape = resample([...flattenPath('M0,0C0,33,0,66,0,100'), ...flattenPath('M0,100C33,100,66,100,100,100')], 96);
check('findCorners detects a sharp 90-degree turn',
  findCorners(lShape.points).length >= 1);

const model2 = [resample(flattenPath('M0,0C10,0,20,0,30,0'), 8).points];
// user drawn +5,+5 away from the model — boundedOffset() should report the
// translation that would bring user onto model, i.e. -5,-5.
const user2 = [resample(flattenPath('M5,5C15,5,25,5,35,5'), 8).points];
const offset = boundedOffset(user2, model2, 10);
check('boundedOffset recovers a translation smaller than its bound',
  Math.abs(offset.dx + 5) < 1e-6 && Math.abs(offset.dy + 5) < 1e-6);
const farUser2 = [resample(flattenPath('M50,50C60,50,70,50,80,50'), 8).points]; // shifted +50,+50
const clamped = boundedOffset(farUser2, model2, 10);
check('boundedOffset clamps a translation larger than its bound',
  Math.abs(Math.hypot(clamped.dx, clamped.dy) - 10) < 1e-6);

// Every real stroke, not just the synthetic ones above: resampling to 48
// points has to track true arc length closely, because gradeResampled()
// measures a drawn stroke's length off the resampled points, not the dense
// ones — see the length gate in stroke-grader.js.
let worstLengthRatioError = 0;
let sampled = 0;
for (const data of Object.values(STROKES)) {
  for (const d of data.strokes) {
    sampled += 1;
    if (sampled % 5 !== 0) continue; // every 5th stroke is plenty to catch a systematic bug
    const dense = flattenPath(d);
    const trueLength = polylineLength(dense);
    if (trueLength === 0) continue;
    const err = Math.abs(resample(dense, 48).length - trueLength) / trueLength;
    if (err > worstLengthRatioError) worstLengthRatioError = err;
  }
}
check('resampling real stroke data to 48 points preserves arc length within 5%',
  worstLengthRatioError < 0.05, `worst case ${(worstLengthRatioError * 100).toFixed(1)}%`);

done('stroke geometry');

// --- Stroke grading --------------------------------------------------------
// The tolerances in stroke-grader.js were tuned outside this repo against a
// simulated sloppy 12-year-old and a simulated 6-year-old with poor motor
// control, aiming for near-zero false "incorrect" verdicts at the default
// strictness — see writing-mode-plan.md §2.5 for the full numbers this
// pins in place. Everything here runs against the real stroke data, not a
// hand-picked sample: every one of the ~10,000 strokes across all 1,174
// characters.

// Deterministic PRNG (mulberry32) so the simulated-writer checks below are
// reproducible without needing to store random data.
function mulberry32(seed) {
  let a = seed;
  return function rand() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gaussian(rand) {
  const u1 = Math.max(rand(), 1e-9);
  const u2 = rand();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

const allModelStrokes = [];
for (const [char, data] of Object.entries(STROKES)) {
  data.strokes.forEach((d, index) => {
    allModelStrokes.push({ char, index, model: grader.prepareModelStroke(d) });
  });
}
check('stroke grading has real model data to test against',
  allModelStrokes.length > 10000, `${allModelStrokes.length} strokes`);

// 1. Every model stroke must be accepted against itself, at every strictness
// level — the most basic sanity check there is.
let selfRejections = 0;
for (const { model } of allModelStrokes) {
  for (const level of grader.STRICTNESS_LEVELS) {
    if (grader.gradeResampled(model.points, model.length, model.points, model.length, level.multiplier) !== 'ok') {
      selfRejections += 1;
    }
  }
}
check('every model stroke is accepted against itself at every strictness level',
  selfRejections === 0, `${selfRejections} rejection(s)`);

// 2. A stroke drawn in reverse must be rejected almost always, at every
// strictness level — direction is never relaxed by strictness.
let reversedAccepted = 0;
for (const { model } of allModelStrokes) {
  const reversedPoints = [...model.points].reverse();
  for (const level of grader.STRICTNESS_LEVELS) {
    if (grader.gradeResampled(reversedPoints, model.length, model.points, model.length, level.multiplier) === 'ok') {
      reversedAccepted += 1;
    }
  }
}
const reversedTotal = allModelStrokes.length * grader.STRICTNESS_LEVELS.length;
check('drawing a stroke backwards is rejected at least 99% of the time',
  reversedAccepted / reversedTotal <= 0.01,
  `${reversedAccepted}/${reversedTotal} wrongly accepted`);

// 3. A scribble — nothing like the stroke's shape — must be rejected at
// Normal strictness and above, proving the loose defaults are not a rubber
// stamp.
function scribble(model, rand) {
  const n = model.points.length;
  const cx = model.points.reduce((s, p) => s + p[0], 0) / n;
  const cy = model.points.reduce((s, p) => s + p[1], 0) / n;
  const out = [];
  for (let k = 0; k < n; k += 1) {
    const u = (k / (n - 1)) * Math.PI * 4;
    out.push([cx + 18 * Math.cos(u) + gaussian(rand) * 3, cy + 12 * Math.sin(u * 1.3) + gaussian(rand) * 3]);
  }
  return out;
}
let scribbleRand = mulberry32(12345);
let scribbleAccepted = 0;
let scribbleTotal = 0;
for (const { model } of allModelStrokes) {
  const raw = scribble(model, scribbleRand);
  for (const level of grader.STRICTNESS_LEVELS.filter((l) => l.id >= 3)) {
    scribbleTotal += 1;
    if (grader.gradeStroke(raw, model, level.multiplier) === 'ok') scribbleAccepted += 1;
  }
}
check('a scribble is rejected at least 99% of the time at Normal strictness or stricter',
  scribbleAccepted / scribbleTotal <= 0.01,
  `${scribbleAccepted}/${scribbleTotal} wrongly accepted`);

// 4. The false-negative guard the whole design turns on: a simulated sloppy
// 12-year-old — smooth systematic offset, scale, tilt and wobble, not white
// noise, since that is how sloppy handwriting actually deviates — must be
// accepted at least 99.5% of the time per stroke at the default strictness.
function writeStroke(model, opts, rand) {
  const { offset, scale, tiltDeg, wobble, endslop } = opts;
  const dx = (rand() * 2 - 1) * offset;
  const dy = (rand() * 2 - 1) * offset;
  const sc = 1 + (rand() * 2 - 1) * scale;
  const theta = ((rand() * 2 - 1) * tiltDeg * Math.PI) / 180;
  const ph1 = rand() * 2 * Math.PI;
  const ph2 = rand() * 2 * Math.PI;
  const a1 = (rand() * 2 - 1) * wobble;
  const a2 = (rand() * 2 - 1) * wobble;
  const s0 = [gaussian(rand) * endslop, gaussian(rand) * endslop];
  const s1 = [gaussian(rand) * endslop, gaussian(rand) * endslop];
  const tremor = endslop * 0.25;
  const n = model.points.length;
  const cx = 54.5;
  const cy = 54.5;
  const out = [];
  for (let k = 0; k < n; k += 1) {
    const [x, y] = model.points[k];
    const u = k / (n - 1);
    const X0 = (x - cx) * sc;
    const Y0 = (y - cy) * sc;
    let X = X0 * Math.cos(theta) - Y0 * Math.sin(theta) + cx + dx;
    let Y = X0 * Math.sin(theta) + Y0 * Math.cos(theta) + cy + dy;
    X += a1 * Math.sin(Math.PI * u + ph1);
    Y += a2 * Math.sin(Math.PI * u * 1.5 + ph2);
    const w0 = (1 - u) ** 2;
    const w1 = u ** 2;
    X += s0[0] * w0 + s1[0] * w1;
    Y += s0[1] * w0 + s1[1] * w1;
    X += gaussian(rand) * tremor;
    Y += gaussian(rand) * tremor;
    out.push([X, Y]);
  }
  return out;
}
const SLOPPY_12YO = { offset: 5.0, scale: 0.09, tiltDeg: 5, wobble: 3.5, endslop: 3.0 };
let sloppyRand = mulberry32(777);
let sloppyAccepted = 0;
for (const { model } of allModelStrokes) {
  const written = smooth(writeStroke(model, SLOPPY_12YO, sloppyRand), 2);
  const writtenLength = polylineLength(written);
  const verdict = grader.gradeResampled(written, writtenLength, model.points, model.length, grader.strictnessMultiplier(grader.DEFAULT_STRICTNESS));
  if (verdict === 'ok') sloppyAccepted += 1;
}
check('a simulated sloppy 12-year-old is accepted at least 99.5% of the time per stroke at the default (Normal) strictness',
  sloppyAccepted / allModelStrokes.length >= 0.995,
  `${(100 * sloppyAccepted / allModelStrokes.length).toFixed(1)}% accepted, wanted >= 99.5%`);

// 5. Drawing only the first half of a stroke and stopping must be rejected
// most of the time from Easy strictness upward — a stub is not "close
// enough", however generous the acceptance radius on a short stroke is.
function halfStroke(model) {
  const points = model.points;
  const half = points.slice(0, Math.floor(points.length / 2));
  const n = points.length;
  const out = [];
  for (let k = 0; k < n; k += 1) {
    const idx = Math.min(Math.floor((k * half.length) / n), half.length - 1);
    out.push(half[idx]);
  }
  return out;
}
let halfAccepted = 0;
let halfTotal = 0;
for (const { model } of allModelStrokes) {
  const half = halfStroke(model);
  const halfLength = polylineLength(half);
  for (const level of grader.STRICTNESS_LEVELS.filter((l) => l.id >= 2)) {
    halfTotal += 1;
    if (grader.gradeResampled(half, halfLength, model.points, model.length, level.multiplier) === 'ok') halfAccepted += 1;
  }
}
check('drawing only the first half of a stroke is rejected at least 85% of the time from Easy strictness upward',
  (halfTotal - halfAccepted) / halfTotal >= 0.85,
  `${(100 * (halfTotal - halfAccepted) / halfTotal).toFixed(1)}% rejected, wanted >= 85%`);

// 6 & 7. The bend check (writing-mode-plan.md §2.2 step 5): among model
// strokes with a real bend to get right (chordBulge past Bsig), a stroke
// drawn as a straight chord between the same endpoints, or bowed the
// opposite way, must be rejected almost always — this is the exact failure
// mode ("hit the endpoints, drew a straight line through the curve, or bowed
// it the wrong way") that motivated the check, since the per-point deviation
// checks alone let both slip through on a shallow curve.
function flattenStroke(points) {
  const p0 = points[0];
  const pN = points[points.length - 1];
  return points.map((_, k) => {
    const t = k / (points.length - 1);
    return [p0[0] + t * (pN[0] - p0[0]), p0[1] + t * (pN[1] - p0[1])];
  });
}
function mirrorAcrossChord(points) {
  const p0 = points[0];
  const pN = points[points.length - 1];
  const cx = pN[0] - p0[0];
  const cy = pN[1] - p0[1];
  const len = Math.hypot(cx, cy) || 1;
  const nx = -cy / len;
  const ny = cx / len;
  return points.map((p) => {
    const d = (p[0] - p0[0]) * nx + (p[1] - p0[1]) * ny;
    return [p[0] - 2 * d * nx, p[1] - 2 * d * ny];
  });
}
const bentStrokes = allModelStrokes.filter(({ model }) => {
  const t = grader.strokeTolerances(model.length, 1.0);
  return Math.abs(chordBulge(model.points)) >= t.Bsig;
});
check('a meaningful share of real strokes have a bend the new check can act on',
  bentStrokes.length / allModelStrokes.length >= 0.10,
  `${bentStrokes.length}/${allModelStrokes.length} (${(100 * bentStrokes.length / allModelStrokes.length).toFixed(1)}%)`);

let flatAccepted = 0;
let mirrorAccepted = 0;
for (const { model } of bentStrokes) {
  const flat = flattenStroke(model.points);
  const { points: flatPoints, length: flatLength } = resample(flat, grader.RESAMPLE_POINTS);
  if (grader.gradeResampled(flatPoints, flatLength, model.points, model.length, 1.0) === 'ok') flatAccepted += 1;

  const mirrored = mirrorAcrossChord(model.points);
  const { points: mirrorPoints, length: mirrorLength } = resample(mirrored, grader.RESAMPLE_POINTS);
  if (grader.gradeResampled(mirrorPoints, mirrorLength, model.points, model.length, 1.0) === 'ok') mirrorAccepted += 1;
}
check('a curved/bent stroke drawn as a straight line is rejected at least 99% of the time at Normal strictness',
  flatAccepted / bentStrokes.length <= 0.01,
  `${flatAccepted}/${bentStrokes.length} wrongly accepted`);
check('a curved/bent stroke drawn bowed the opposite way is rejected at least 99% of the time at Normal strictness',
  mirrorAccepted / bentStrokes.length <= 0.01,
  `${mirrorAccepted}/${bentStrokes.length} wrongly accepted`);

// 8. The false-negative guard for this check specifically: the same sloppy
// simulated 12-year-old from check 4, run only against bent strokes, must
// still be accepted at least 99% of the time — this check must not eat into
// the false-positive budget the other tolerances were tuned around.
let sloppyBentRand = mulberry32(555);
let sloppyBentAccepted = 0;
for (const { model } of bentStrokes) {
  const written = smooth(writeStroke(model, SLOPPY_12YO, sloppyBentRand), 2);
  const writtenLength = polylineLength(written);
  const verdict = grader.gradeResampled(written, writtenLength, model.points, model.length, grader.strictnessMultiplier(grader.DEFAULT_STRICTNESS));
  if (verdict === 'ok') sloppyBentAccepted += 1;
}
check('a simulated sloppy 12-year-old drawing a bent stroke is still accepted at least 99% of the time at Normal strictness',
  sloppyBentAccepted / bentStrokes.length >= 0.99,
  `${(100 * sloppyBentAccepted / bentStrokes.length).toFixed(1)}% accepted, wanted >= 99%`);

// 9. A dot or other short stroke (e.g. the two short strokes atop 学) must
// never be judged on bend, however badly its shape is butchered — a hand
// can't reliably reproduce a bend direction over that short a distance, and
// the check exists to catch broad curves and sharp corners, not to demand
// concavity out of a tick mark. Checked directly against 学's own dots, not
// just via the general MIN_BEND_LENGTH filter below, since that's the
// concrete case this guard is for.
const shortStrokes = allModelStrokes.filter(({ model }) => model.length < grader.MIN_BEND_LENGTH);
check('the real data actually has short strokes to test this guard against',
  shortStrokes.length > 100, `${shortStrokes.length} strokes under ${grader.MIN_BEND_LENGTH} units`);

let shortBendVerdicts = 0;
for (const { model } of shortStrokes) {
  for (const distort of [flattenStroke, mirrorAcrossChord]) {
    const { points, length } = resample(distort(model.points), grader.RESAMPLE_POINTS);
    const verdict = grader.gradeResampled(points, length, model.points, model.length, 1.0);
    if (verdict === 'too-straight' || verdict === 'wrong-bend') shortBendVerdicts += 1;
  }
}
check('a short stroke (under 20 units) is never rejected as too-straight or wrong-bend, however it is distorted',
  shortBendVerdicts === 0, `${shortBendVerdicts} such verdict(s) on ${shortStrokes.length} short strokes`);

const gakuStrokes = strokesFor('学').strokes.map((d) => grader.prepareModelStroke(d));
const gakuDots = gakuStrokes.filter((model) => model.length < grader.MIN_BEND_LENGTH);
check('学 actually has short (dot-like) strokes to check, so this test means something',
  gakuDots.length >= 2, `found ${gakuDots.length}`);
let gakuDotBendVerdicts = 0;
for (const model of gakuDots) {
  for (const distort of [flattenStroke, mirrorAcrossChord]) {
    const { points, length } = resample(distort(model.points), grader.RESAMPLE_POINTS);
    const verdict = grader.gradeResampled(points, length, model.points, model.length, 1.0);
    if (verdict === 'too-straight' || verdict === 'wrong-bend') gakuDotBendVerdicts += 1;
  }
}
check('学\'s own short strokes are never rejected as too-straight or wrong-bend',
  gakuDotBendVerdicts === 0, `${gakuDotBendVerdicts} such verdict(s)`);

done('stroke grading');

// --- CSS: [hidden] must actually hide things ------------------------------
// A real, shipped bug: several component classes (.kanji-info, .row, .stack)
// declare their own explicit `display`, and an author-stylesheet class rule
// beats the browser's built-in `[hidden]{display:none}` at equal
// specificity — so `element.hidden = true` in app.js was updating the
// attribute correctly while the element stayed visually flexed. Symptoms:
// the kanji info panel from the previous question staying on screen while
// the next one loaded, and the Show answers/Advanced row appearing in
// Definition mode where it should never show at all. There is no CSS engine
// in this test environment to check real computed styles, so this instead
// pins the actual fix: one global rule with !important that makes `hidden`
// an unconditional override no component class can accidentally beat again.
// If this rule is ever weakened or removed, the whole class of bug is back.
const css = readFile('styles.css');
const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, ''); // strip comments before counting
const importantRules = [...cssNoComments.matchAll(/!important/g)];
check('exactly one !important rule exists in the stylesheet — the [hidden] guard',
  importantRules.length === 1, `found ${importantRules.length}`);
check('[hidden] is forced to display:none regardless of any component\'s own display rule',
  /\[hidden\]\s*\{[^}]*display:\s*none\s*!important/.test(cssNoComments));
// The bug specifically involved classes that set an explicit `display` — if
// any of those ever lose their reliance on the global rule and grow their
// own [hidden] override instead, that's fine, but the global rule is the
// actual guarantee and must not regress.
for (const cls of ['.kanji-info', '.row', '.stack', '.screen']) {
  const declaresDisplay = new RegExp(`${cls.replace('.', '\\.')}\\s*\\{[^}]*display:`).test(cssNoComments);
  check(`${cls} still sets its own display (confirms the global rule is doing real work, not dead code)`,
    declaresDisplay);
}
done('the [hidden] CSS guard');

// --- The round-trip invariant --------------------------------------------
// Whatever romaji the app shows as the answer must be accepted as the answer.

for (const course of COURSES) {
  for (const chunk of course.chunks) {
    for (const kana of chunk.items) {
      const shown = romajiFor(kana);
      check(`round-trip ${course.id} ${kana}`, checkRomaji(shown, kana), `shown as "${shown}"`);
      check(`round-trip non-empty ${kana}`, shown.length > 0);
    }
  }
}
done('every character accepts its own romaji');

// --- Alternate spellings a learner is entitled to type ---------------------

const accepted = [
  ['si', 'し'], ['shi', 'し'], ['tu', 'つ'], ['tsu', 'つ'],
  ['hu', 'ふ'], ['fu', 'ふ'], ['n', 'ん'], ['nn', 'ん'], ["n'", 'ん'],
  ['wo', 'を'], ['o', 'を'], ['di', 'ぢ'], ['ji', 'ぢ'],
  ['du', 'づ'], ['zu', 'づ'], ['kya', 'きゃ'], ['sho', 'しょ'],
  ['SHI', 'し'], [' ka ', 'か'],
  // katakana targets take the same romaji
  ['ka', 'カ'], ['shi', 'シ'], ['n', 'ン'], ['ja', 'ジャ'],
];
for (const [typed, target] of accepted) {
  check(`accept "${typed}" for ${target}`, checkRomaji(typed, target));
}

const rejected = [
  ['ka', 'き'], ['', 'か'], ['   ', 'か'], ['xyz', 'か'],
  ['ki', 'カ'], ['sa', 'し'], ['ya', 'や'.replace('や', 'ゆ')],
  // お and を must stay distinct in this direction, even though を accepts "o"
  ['wo', 'お'],
];
for (const [typed, target] of rejected) {
  check(`reject "${typed}" for ${target}`, !checkRomaji(typed, target));
}
done('alternate spellings');

// --- Writing-mode prompt disambiguation -------------------------------------
// romajiFor(ぢ)/romajiFor(づ) collide with romajiFor(じ)/romajiFor(ず) — fine
// for reading questions, where the kana glyph is on screen, but writing mode
// shows only the romaji, so those four characters need to come back distinct.

const writingPairs = [['じ', 'ぢ'], ['ず', 'づ'], ['ジ', 'ヂ'], ['ズ', 'ヅ']];
for (const [plain, merged] of writingPairs) {
  check(
    `writing prompt distinguishes ${plain} from ${merged}`,
    writingPromptFor(plain) !== writingPromptFor(merged),
    `both shown as "${writingPromptFor(plain)}"`,
  );
}
for (const course of COURSES) {
  for (const kana of course.chunks.flatMap((c) => c.items)) {
    if (['ぢ', 'づ', 'ヂ', 'ヅ'].includes(kana)) continue;
    check(`writing prompt unchanged for ${kana}`, writingPromptFor(kana) === romajiFor(kana));
  }
}
done('writing-mode prompt disambiguation');

// --- Multiple-choice options ---------------------------------------------
// Checked for every character in both courses, because the failure that
// matters is an unanswerable question: two options showing the same romaji
// (じ/ぢ are both "ji", ず/づ are both "zu"), or the answer missing entirely.

let ambiguous = 0;
let missingAnswer = 0;
let wrongCount = 0;
for (const course of COURSES) {
  for (const kana of course.chunks.flatMap((c) => c.items)) {
    const options = buildChoices(course, kana, 10);
    if (options.length !== 10) wrongCount += 1;
    if (new Set(options).size !== options.length) ambiguous += 1;
    if (!options.includes(romajiFor(kana))) missingAnswer += 1;
    // Exactly one option may be accepted as the answer.
    if (options.filter((o) => checkRomaji(o, kana)).length !== 1) ambiguous += 1;
  }
}
check('every question offers ten options', wrongCount === 0, `${wrongCount} did not`);
check('the right answer is always offered', missingAnswer === 0, `${missingAnswer} missing`);
check('no question has two options that both read as the answer', ambiguous === 0, `${ambiguous} ambiguous`);

const kyaOptions = buildChoices(hiragana, 'きゃ', 10);
check('options are plain romaji strings', kyaOptions.every((o) => typeof o === 'string' && o.length));
check('distractors are drawn from the same set where possible',
  kyaOptions.some((o) => ['kyu', 'kyo', 'gya', 'gyu', 'gyo'].includes(o)),
  kyaOptions.join(' '));
done('multiple-choice options');

// --- All eighteen units (grades 1-6, secondary sub-units 8-1..8-6, and
// --- beyond-jōyō "names & places" sub-units 9-1..9-6): structural sanity ---
// The depth checks below (option counts, priority ordering, rollups, ...)
// only run against grade 1, since they're testing the mechanism rather than
// the data — but every unit goes through the same build script, so a quick
// pass across all of them catches a unit-specific regression (e.g. one with
// a kanji that has zero readings, or one that collides with another unit's
// kanji).

const EXPECTED_UNITS = [
  '1', '2', '3', '4', '5', '6',
  '8-1', '8-2', '8-3', '8-4', '8-5', '8-6',
  '9-1', '9-2', '9-3', '9-4', '9-5', '9-6',
];
check('grades 1-6, secondary sub-units 8-1..8-6 and names/places sub-units 9-1..9-6 all exist',
  EXPECTED_UNITS.every((u) => KANJI_COURSES.some((c) => c.id === `kanji-grade-${u}`)),
  KANJI_COURSES.map((c) => c.id).join(', '));

const seenAcrossGrades = new Map(); // kanji -> which grade course first had it
const seenJoyo = new Set();
const seenBeyond = new Set();
let crossGradeDuplicates = 0;
let anyGradeStructureWrong = 0;
let noMeaningAnywhere = 0;
let unquizzableYomiJoyo = 0;
let unquizzableYomiBeyond = 0;
let quizReadingWithoutExample = 0;
for (const course of KANJI_COURSES) {
  const isBeyond = course.unit.startsWith('9-');
  const chars = course.chunks.flatMap((c) => c.items);
  if (new Set(chars).size !== chars.length) anyGradeStructureWrong += 1;
  if (!course.chunks.slice(0, -1).every((c) => c.items.length === 5)) anyGradeStructureWrong += 1;
  for (const kanji of chars) {
    const info = kanjiInfo(course, kanji);
    if (!info || info.on.length + info.kun.length === 0) anyGradeStructureWrong += 1;
    // A kanji with no non-radical meaning at all (NO_MEANING_CHARS, see
    // kanji-expansion-plan.md §5) is meant to have none — it's excluded from
    // Definition mode specifically, checked below, not a structural problem.
    if ((!info || info.meanings.length === 0) && !course.excludeForMode.definition.has(kanji)) {
      noMeaningAnywhere += 1;
    }
    // Every quizzed reading must have an example word — that is now the
    // criterion for being quizzed at all.
    for (const reading of (info ? info.quizReadings : [])) {
      if (!readingExample(course, kanji, reading)) quizReadingWithoutExample += 1;
    }
    if (info && info.quizReadings.length === 0) {
      if (isBeyond) unquizzableYomiBeyond += 1; else unquizzableYomiJoyo += 1;
    }
    if (seenAcrossGrades.has(kanji)) crossGradeDuplicates += 1;
    else seenAcrossGrades.set(kanji, course.id);
    (isBeyond ? seenBeyond : seenJoyo).add(kanji);
  }
}
check('every course is internally well-formed (chunks of 5, no dupes, every kanji has some reading listed)',
  anyGradeStructureWrong === 0, `${anyGradeStructureWrong} problems`);
check('every kanji has at least one non-radical English meaning to quiz, unless excluded from Definition mode',
  noMeaningAnywhere === 0, `${noMeaningAnywhere} without one`);
check('every quizzed reading has an example word — that is the bar for being quizzed',
  quizReadingWithoutExample === 0, `${quizReadingWithoutExample} without one`);
check('no kanji appears in more than one grade', crossGradeDuplicates === 0, `${crossGradeDuplicates} duplicates`);
check('the full jōyō set is 2130-2140 kanji (2,136 official, allowing for minor revisions)',
  seenJoyo.size >= 2130 && seenJoyo.size <= 2140, `got ${seenJoyo.size}`);
check('the beyond-jōyō "names & places" set is a substantial, bounded addition',
  seenBeyond.size >= 700 && seenBeyond.size <= 1100, `got ${seenBeyond.size}`);

// A few kanji (prefecture names like 媛/栃/茨) have no reading appearing in any
// common word, so they have no yomi question. They must be excluded from that
// mode specifically — not dropped from the course, since Definition still
// works for them. Likewise a couple of kanji have no non-radical meaning at
// all and must be excluded from Definition specifically.
let excludedButQuizzable = 0;
let quizzableButExcluded = 0;
let excludedButHasMeaning = 0;
let meaninglessButNotExcluded = 0;
for (const course of KANJI_COURSES) {
  const excludedYomi = course.excludeForMode.recognition;
  const excludedDefinition = course.excludeForMode.definition;
  for (const kanji of course.chunks.flatMap((c) => c.items)) {
    const info = kanjiInfo(course, kanji);
    const hasReadings = info.quizReadings.length > 0;
    if (excludedYomi.has(kanji) && hasReadings) excludedButQuizzable += 1;
    if (!excludedYomi.has(kanji) && !hasReadings) quizzableButExcluded += 1;
    const hasMeaning = info.meanings.length > 0;
    if (excludedDefinition.has(kanji) && hasMeaning) excludedButHasMeaning += 1;
    if (!excludedDefinition.has(kanji) && !hasMeaning) meaninglessButNotExcluded += 1;
  }
}
check('kanji with no quizzable reading are excluded from yomi mode',
  quizzableButExcluded === 0, `${quizzableButExcluded} not excluded`);
check('nothing quizzable is excluded from yomi mode by mistake',
  excludedButQuizzable === 0, `${excludedButQuizzable} wrongly excluded`);
check('kanji with no meaning at all are excluded from definition mode',
  meaninglessButNotExcluded === 0, `${meaninglessButNotExcluded} not excluded`);
check('nothing with a real meaning is excluded from definition mode by mistake',
  excludedButHasMeaning === 0, `${excludedButHasMeaning} wrongly excluded`);
check('the jōyō unquizzable-yomi set is a small fraction, not a systemic failure',
  unquizzableYomiJoyo <= 40, `${unquizzableYomiJoyo} jōyō kanji have no quizzable reading`);
check('the beyond-jōyō unquizzable-yomi set stays under a third — most names/places kanji still get a Yomi question',
  unquizzableYomiBeyond <= seenBeyond.size / 3, `${unquizzableYomiBeyond} of ${seenBeyond.size} beyond-jōyō kanji have no quizzable reading`);
done('all eighteen kanji units are structurally sound');

// --- Kanji data and reading choices ----------------------------------------
// The rest of this section goes deep on grade 1 only — see note above.

const grade1 = KANJI_COURSES.find((c) => c.id === 'kanji-grade-1');
check('grade-1 course exists', !!grade1);
const grade1Chars = grade1.chunks.flatMap((c) => c.items);
check('grade 1 has 80 kanji', grade1Chars.length === 80, `got ${grade1Chars.length}`);
check('no duplicate kanji', new Set(grade1Chars).size === grade1Chars.length);
check('chunked in fives like the kana courses',
  grade1.chunks.slice(0, -1).every((c) => c.items.length === 5));

let noMeanings = 0;
let noWords = 0;
let noReadings = 0;
for (const kanji of grade1Chars) {
  const info = kanjiInfo(grade1, kanji);
  check(`kanjiInfo resolves for ${kanji}`, !!info);
  if (!info) continue;
  if (info.meanings.length === 0) noMeanings += 1;
  if (info.words.length === 0) noWords += 1;
  if (info.on.length + info.kun.length === 0) noReadings += 1;
}
check('every grade-1 kanji has at least one meaning', noMeanings === 0, `${noMeanings} missing`);
check('every grade-1 kanji has at least one example word', noWords === 0, `${noWords} missing`);
check('every grade-1 kanji has at least one reading', noReadings === 0, `${noReadings} missing`);

// The quiz-pool cap exists because some kanji (生, 上, ...) have well over a
// dozen kun'yomi once conjugated forms are counted — offering all of them
// would make even the "advanced" view unusable.
let overCap = 0;
for (const kanji of grade1Chars) {
  if (kanjiInfo(grade1, kanji).quizReadings.length > 6) overCap += 1;
}
check('quiz readings are capped at 6', overCap === 0, `${overCap} over the cap`);

const noProgress = {}; // a learner who has never seen any of this before

let baseCountWrong = 0;
let baseCorrectOverLimit = 0;
let baseCorrectAtLeastHalf = 0;
let missingCorrect = 0;
let duplicateOptions = 0;
let outOfOrder = 0;
let missingMandatory = 0;
for (const kanji of grade1Chars) {
  const info = kanjiInfo(grade1, kanji);
  const { options, correct } = buildKanjiOptions(grade1, kanji, 'recognition', noProgress);
  if (options.length !== 10) baseCountWrong += 1;
  if (correct.size > 4) baseCorrectOverLimit += 1;
  if (correct.size * 2 >= options.length) baseCorrectAtLeastHalf += 1;
  if (![...correct].every((r) => options.includes(r))) missingCorrect += 1;
  if (new Set(options).size !== options.length) duplicateOptions += 1;
  // The most common *quizzable* on'yomi and kun'yomi are never left out of
  // the base view, however the "which 2 more" priority sorts. Quizzable, not
  // KANJIDIC's first: a kanji's headline reading is skipped if no common word
  // uses it, so quizOn[0]/quizKun[0] are the right reference, not on[0]/kun[0].
  if (info.quizOn[0] && !correct.has(info.quizOn[0])) missingMandatory += 1;
  if (info.quizKun[0] && !correct.has(info.quizKun[0])) missingMandatory += 1;
  // Alphabetical by romaji, the same convention as kana.js's buildChoices —
  // on'yomi is katakana and kun'yomi is hiragana, so sorting the raw kana
  // would clump the two scripts instead of interleaving by sound.
  const romaji = options.map((r) => romajiFor(r));
  const sorted = [...romaji].sort((a, b) => a.localeCompare(b));
  if (JSON.stringify(romaji) !== JSON.stringify(sorted)) outOfOrder += 1;
}
check('every base kanji question offers ten options', baseCountWrong === 0, `${baseCountWrong} did not`);
check('base view never offers more than 4 correct', baseCorrectOverLimit === 0, `${baseCorrectOverLimit} did`);
check('base correct count is always under half (no better than guessing)',
  baseCorrectAtLeastHalf === 0, `${baseCorrectAtLeastHalf} were not`);
check('the correct set shown is always actually offered', missingCorrect === 0, `${missingCorrect} missing`);
check('no kanji question has a duplicate option', duplicateOptions === 0, `${duplicateOptions} had one`);
check('the most common on/kun reading is always in the base view',
  missingMandatory === 0, `${missingMandatory} missing`);
check('reading options are sorted alphabetically by romaji', outOfOrder === 0, `${outOfOrder} unsorted`);

// --- Advanced view: only offered when there's something to add, and the
// under-half rule holds even at the full 5/6-reading pool.

const advancedEligible = grade1Chars.filter((k) => kanjiInfo(grade1, k).quizReadings.length > 4);
check('at least one grade-1 kanji has more than 4 readings (or this whole check is vacuous)',
  advancedEligible.length > 0);

let advancedCorrectWrong = 0;
let advancedOverHalf = 0;
let advancedMissingCorrect = 0;
for (const kanji of advancedEligible) {
  const info = kanjiInfo(grade1, kanji);
  const { options, correct } = buildKanjiOptions(grade1, kanji, 'recognition', noProgress, { advanced: true });
  if (correct.size !== info.quizReadings.length) advancedCorrectWrong += 1;
  if (correct.size * 2 >= options.length) advancedOverHalf += 1;
  if (![...correct].every((r) => options.includes(r))) advancedMissingCorrect += 1;
}
check('advanced view offers the full reading pool as correct',
  advancedCorrectWrong === 0, `${advancedCorrectWrong} did not`);
check('advanced view still keeps correct under half',
  advancedOverHalf === 0, `${advancedOverHalf} did not`);
check('advanced correct set is always offered', advancedMissingCorrect === 0);

for (const kanji of grade1Chars) {
  const info = kanjiInfo(grade1, kanji);
  const isEligible = info.quizReadings.length > 4;
  const { correct } = buildKanjiOptions(grade1, kanji, 'recognition', noProgress);
  check(`advanced is only meaningful when there is more to add (${kanji})`,
    isEligible === (info.quizReadings.length > correct.size));
}

// A real bug, not hypothetical: the base view only shows some of a kanji's
// own readings as correct (子 has 5, only 4 make the base view). The other
// 1-2 are still genuine readings of that kanji, just not being quizzed this
// round — and since distractors are drawn randomly from every other kanji in
// the course, one of them can coincidentally read the same way (音 is also
// read ね, one of 子's own leftover readings). Before this was fixed, ね could
// appear on 子's grid as a "distractor" — click it, a genuinely correct
// answer, and be marked wrong. Only shows up on unlucky shuffles, hence the
// many trials: this is checking an invariant on the *output* of each call,
// not repeating one flaky assertion and hoping.
let ownReadingOfferedAsDistractor = 0;
for (let trial = 0; trial < 30; trial += 1) {
  for (const kanji of advancedEligible) {
    const info = kanjiInfo(grade1, kanji);
    const ownPool = new Set(info.quizReadings);
    const { options, correct } = buildKanjiOptions(grade1, kanji, 'recognition', noProgress);
    for (const option of options) {
      if (!correct.has(option) && ownPool.has(option)) ownReadingOfferedAsDistractor += 1;
    }
  }
}
check('a kanji\'s own reading never appears on its own grid marked as a distractor',
  ownReadingOfferedAsDistractor === 0, `${ownReadingOfferedAsDistractor} occurrences across 30 trials`);

done('kanji data and base/advanced reading choices');

// --- Advanced "additions": grows the grid rather than rebuilding it -------

for (const kanji of advancedEligible.slice(0, 10)) {
  const info = kanjiInfo(grade1, kanji);
  const { options: shownOptions, correct: baseCorrect } = buildKanjiOptions(grade1, kanji, 'recognition', noProgress);
  const shown = new Set(shownOptions);
  const { additions, newCorrect } = buildAdvancedAdditions(grade1, kanji, shown);

  check(`additions never repeat what is already shown (${kanji})`,
    additions.every((r) => !shown.has(r)));
  check(`additions include every remaining correct reading (${kanji})`,
    [...newCorrect].every((r) => additions.includes(r)));
  check(`newCorrect is exactly the pool minus what the base view already had (${kanji})`,
    newCorrect.size === info.quizReadings.length - baseCorrect.size);

  const finalCorrectCount = baseCorrect.size + newCorrect.size;
  const finalTotal = shown.size + additions.length;
  check(`expanding still keeps correct under half of the total (${kanji})`,
    finalCorrectCount * 2 < finalTotal, `${finalCorrectCount}/${finalTotal}`);
}
done('advanced additions grow the grid without duplicating or exceeding it');

// --- Priority: never-graded readings fill the "2 more" slots before one
// that's already known and not currently due.

const priorityKanji = grade1Chars.find((k) => {
  const info = kanjiInfo(grade1, k);
  return info.on[0] && info.kun[0] && info.quizReadings.length === 5;
});
if (priorityKanji) {
  const info = kanjiInfo(grade1, priorityKanji);
  const mandatory = new Set([info.on[0], info.kun[0]]);
  const [alreadyKnown, unseenA, unseenB] = info.quizReadings.filter((r) => !mandatory.has(r));
  const progress = {};
  progress[srs.yomiKey('recognition', priorityKanji, alreadyKnown)] =
    srs.gradeYomi(srs.newYomiRecord(), true, Date.now()); // graded, due later — not due now
  const { correct } = buildKanjiOptions(grade1, priorityKanji, 'recognition', progress);
  check('never-graded readings are chosen over an already-known, not-due one',
    correct.has(unseenA) && correct.has(unseenB) && !correct.has(alreadyKnown),
    [...correct].join(', '));
} else {
  check('(skipped — no grade-1 kanji has exactly 5 readings with both a primary on and kun)', true);
}

// --- Per-reading example words --------------------------------------------
// Not every reading has one (build_kanji_data.py logs which don't), but the
// mechanism itself — including the "rare on'yomi, e.g. a loanword-derived
// reading, still finds its word even though that word may use a kanji
// outside this grade" case that motivated it — must work.

check('readingExample returns null rather than throwing for an unmapped reading',
  readingExample(grade1, '一', 'not-a-real-reading') === null);

let exampleForPrimaryOn = 0;
for (const kanji of grade1Chars) {
  const info = kanjiInfo(grade1, kanji);
  if (info.on[0] && readingExample(grade1, kanji, info.on[0])) exampleForPrimaryOn += 1;
}
check('most kanji have an example word for their primary on\'yomi',
  exampleForPrimaryOn / grade1Chars.length > 0.8,
  `${exampleForPrimaryOn}/${grade1Chars.length}`);

// 上 (above) has シャン among its on'yomi specifically because of 上海
// (Shanghai) — a rare reading findable only via a word that itself uses a
// kanji (海) outside grade 1. This is the exact case the feature is for.
const shanghai = kanjiInfo(grade1, '上');
if (shanghai && shanghai.on.includes('シャン')) {
  const example = readingExample(grade1, '上', 'シャン');
  check('the rare シャン reading of 上 finds its Shanghai example',
    !!example && example.kanji.includes('上'), JSON.stringify(example));
}

// The bug this alignment exists to prevent: 十二 reads じゅうに, so a naive
// "word reading starts with the target reading" test credited it to 二's rare
// ジ on'yomi — when in fact 二 is に there and じゅう belongs to 十. The word
// must now be credited to 二's ニ reading (or not at all), never to ジ.
const two = kanjiInfo(grade1, '二');
check('二 does not offer ジ as a quizzable reading — no common word uses it',
  !two.quizReadings.includes('ジ'), two.quizReadings.join(', '));
for (const [reading, example] of Object.entries(two.readingExamples)) {
  check(`二's example for ${reading} is not the mis-attributed 十二`,
    !(reading === 'ジ' && example.kanji === '十二'), JSON.stringify(example));
}

// Same class of error in the other direction: a reading must be credited to
// the kanji that actually contributes it, wherever in the word it sits.
const ten = kanjiInfo(grade1, '十');
if (ten.readingExamples['ジュウ']) {
  check('十 credits じゅう to a word where 十 really is read じゅう',
    ten.readingExamples['ジュウ'].kana.startsWith('じゅう'),
    JSON.stringify(ten.readingExamples['ジュウ']));
}

let exampleContainsKanji = 0;
let exampleMissingKanji = 0;
for (const course of KANJI_COURSES) {
  for (const kanji of course.chunks.flatMap((c) => c.items)) {
    for (const reading of kanjiInfo(course, kanji).quizReadings) {
      const example = readingExample(course, kanji, reading);
      if (example && example.kanji.includes(kanji)) exampleContainsKanji += 1;
      else exampleMissingKanji += 1;
    }
  }
}
check('every reading example actually contains the kanji it illustrates',
  exampleMissingKanji === 0, `${exampleMissingKanji} did not`);
check('the reading-example index is substantial, not near-empty after filtering',
  exampleContainsKanji > 2000, `only ${exampleContainsKanji}`);

done('per-reading example words');

// --- Meanings: definitions only, no radical names -------------------------

let radicalNameLeaked = 0;
let legitimateRadicalMeaningLost = 0;
for (const course of KANJI_COURSES) {
  for (const kanji of course.chunks.flatMap((c) => c.items)) {
    for (const meaning of kanjiInfo(course, kanji).meanings) {
      // KANJIDIC lists the radical's *name* as a pseudo-meaning, e.g.
      // "one radical (no.1)" — not a definition, so it must be gone.
      if (/radical\s*\(no/i.test(meaning)) radicalNameLeaked += 1;
    }
  }
}
check('radical names are stripped from meanings', radicalNameLeaked === 0, `${radicalNameLeaked} leaked`);

// ...but "radical" as a genuine English definition must survive: 根 is a
// mathematical root/radical, 基 is a chemical radical. Filtering on the bare
// word would wrongly delete these.
for (const [kanji, expected] of [['根', 'radical'], ['基', 'radical (chem)']]) {
  const course = KANJI_COURSES.find((c) => c.index.has(kanji));
  if (course) {
    check(`${kanji} keeps its genuine "radical" definition`,
      kanjiInfo(course, kanji).meanings.includes(expected),
      kanjiInfo(course, kanji).meanings.join(', '));
  }
}
done('meanings are definitions only, without discarding real ones');

// --- Definition mode choices ----------------------------------------------

// Four options (two rows of two), not ten: English definitions are long, and
// a definition question is single-answer so the under-half rule that governs
// the multi-select yomi quiz doesn't apply.
let defCountWrong = 0;
let defMissingAnswer = 0;
let defDuplicate = 0;
let defUnsorted = 0;
for (const kanji of grade1Chars) {
  const { options, answer } = buildDefinitionChoices(grade1, kanji);
  if (options.length !== 4) defCountWrong += 1;
  if (!options.includes(answer)) defMissingAnswer += 1;
  if (new Set(options).size !== options.length) defDuplicate += 1;
  const sorted = [...options].sort((a, b) => a.localeCompare(b));
  if (JSON.stringify(options) !== JSON.stringify(sorted)) defUnsorted += 1;
}
check('every definition question offers four options by default',
  defCountWrong === 0, `${defCountWrong} did not`);
check('the correct definition is always offered', defMissingAnswer === 0, `${defMissingAnswer} missing`);
check('no definition question repeats an option — a duplicate label would be unanswerable',
  defDuplicate === 0, `${defDuplicate} had one`);
check('definition options are sorted alphabetically', defUnsorted === 0, `${defUnsorted} unsorted`);

const defOne = buildDefinitionChoices(grade1, '一');
check('the definition answer is the kanji\'s own meaning label',
  defOne.answer === meaningLabel(kanjiInfo(grade1, '一')), defOne.answer);
check('the definition answer is English prose, not a reading',
  /[a-z]/i.test(defOne.answer), defOne.answer);
check('definition options carry no radical-name text',
  defOne.options.every((o) => !/radical\s*\(no/i.test(o)));
done('definition mode choices');

// --- Kanji-level rollup, aggregated from per-reading records ---------------

const rollupKanji = grade1Chars[0];
const rollupInfo = kanjiInfo(grade1, rollupKanji);
const rollupProgress = {};
const rollupNow = Date.now();

recomputeKanjiRollup(grade1, rollupKanji, 'recognition', rollupProgress, rollupNow);
check('rollup does nothing when no reading has been graded yet',
  !rollupProgress[srs.itemKey('recognition', rollupKanji)]);

const [firstReading, secondReading] = rollupInfo.quizReadings;
rollupProgress[srs.yomiKey('recognition', rollupKanji, firstReading)] =
  srs.gradeYomi(srs.newYomiRecord(), true, rollupNow); // due soon, streak 1
if (secondReading) {
  let solid = srs.newYomiRecord();
  for (let i = 0; i < 6; i += 1) solid = srs.gradeYomi(solid, true, rollupNow); // due much later, streak 6
  rollupProgress[srs.yomiKey('recognition', rollupKanji, secondReading)] = solid;
}
recomputeKanjiRollup(grade1, rollupKanji, 'recognition', rollupProgress, rollupNow);
const rollup = rollupProgress[srs.itemKey('recognition', rollupKanji)];
check('rollup exists once at least one reading has a record', !!rollup);
check('rollup due date is the EARLIEST due among introduced readings — a kanji resurfaces as soon as any one reading is shaky',
  rollup.due === rollupProgress[srs.yomiKey('recognition', rollupKanji, firstReading)].due);
if (secondReading) {
  check('rollup box is the LOWEST streak among introduced readings — mastered means every reading tested is solid',
    rollup.box === 1, `got ${rollup.box}`);
} else {
  check('with only one reading, rollup box matches its streak', rollup.box === 1);
}
check('rollup correct/lapses are summed across readings',
  rollup.correct === (secondReading ? 7 : 1) && rollup.lapses === 0,
  JSON.stringify(rollup));

done('kanji-level rollup aggregates per-reading records');

// --- SRS ------------------------------------------------------------------

const DAY = 24 * 60 * 60 * 1000;
const now = Date.UTC(2026, 0, 1);

let rec = srs.grade(srs.newRecord(), true, now);
check('pass moves to box 1', rec.box === 1, `box ${rec.box}`);
check('pass schedules 1 day out', rec.due === now + DAY, `due +${(rec.due - now) / DAY}d`);
check('history records the pass', rec.history.length === 1 && rec.history[0][1] === 1);

rec = srs.grade(rec, true, now);
rec = srs.grade(rec, true, now);
check('three passes reach box 3', rec.box === 3, `box ${rec.box}`);
check('box 3 is 4 days out', rec.due === now + 4 * DAY);

rec = srs.grade(rec, false, now);
check('miss drops to box 0', rec.box === 0);
check('miss is immediately due', srs.isDue(rec, now));
check('miss counted as a lapse', rec.lapses === 1);
check('history keeps every attempt', rec.history.length === 4);

let maxed = srs.newRecord();
for (let i = 0; i < 20; i += 1) maxed = srs.grade(maxed, true, now);
check('box is capped', maxed.box === srs.MAX_BOX, `box ${maxed.box}`);
done('leitner boxes');

// --- Placement test: a correct answer on a never-seen item jumps to the --
// --- top box instead of climbing one at a time --------------------------

const placedRight = srs.grade(srs.newRecord(), true, now, { placement: true });
check('a placement-correct answer jumps straight to the top box, not box 1',
  placedRight.box === srs.MAX_BOX, `box ${placedRight.box}`);
check('placement still records a normal correct/seen/history entry',
  placedRight.seen === 1 && placedRight.correct === 1
  && placedRight.history.length === 1 && placedRight.history[0][1] === 1);

const placedWrong = srs.grade(srs.newRecord(), false, now, { placement: true });
check('a placement-incorrect answer is graded exactly like an ordinary miss',
  placedWrong.box === 0 && placedWrong.lapses === 1 && srs.isDue(placedWrong, now));

const placedYomi = srs.gradeYomi(srs.newYomiRecord(), true, now, { placement: true });
check('placement on a per-reading (Yomi) record jumps the streak to MAX_BOX too',
  placedYomi.streak === srs.MAX_BOX, `streak ${placedYomi.streak}`);

// Enrollment happens lazily per item as each one is actually attempted (see
// ensurePlacementEnrolled in app.js), never upfront for the whole batch —
// quitting partway through a placement test must not leave the rest of the
// unit sitting enrolled-but-untouched. So the pool a placement session draws
// from (neverSeenItems) deliberately ignores the study-list gate entirely:
// it must reach a kanji that was never enrolled at all, not just one already
// sitting enrolled in "waiting to learn" the way pendingItems requires.
const placementSeen = grade1Chars[0];
const placementUnseenUnenrolled = grade1Chars[1];
const placementCtx = {
  progress: { [srs.itemKey('recognition', placementSeen)]: srs.newRecord() },
  study: {}, // deliberately empty — nothing enrolled at all
};
const placementBuilt = srs.buildSession(grade1, 'recognition', placementCtx, 'placement');
check('a placement session has no lesson step — nothing is shown before being asked',
  placementBuilt.lesson.length === 0);
check('a placement session excludes anything with a progress record already',
  !placementBuilt.quiz.includes(placementSeen), JSON.stringify(placementBuilt.quiz));
check('a placement session includes a never-seen item even when not enrolled in the study list — unlike pendingItems',
  placementBuilt.quiz.includes(placementUnseenUnenrolled));
check('a placement session covers every never-seen item in the unit, not a capped batch',
  placementBuilt.quiz.length === grade1Chars.length - 1, placementBuilt.quiz.length);
// Unlike 'new'/'review'/'practice', a placement quiz is NOT shuffled: it
// should run in the same teaching order as the unit itself (grade1Chars,
// minus the one already-seen character), so the point where a learner
// starts missing questions actually says something about where their
// knowledge runs out.
check('a placement session is in teaching order, not shuffled',
  JSON.stringify(placementBuilt.quiz) === JSON.stringify(grade1Chars.slice(1)),
  JSON.stringify(placementBuilt.quiz));
done('placement test: correct answers jump straight to the top box');

// --- Writing mode: which of Trace/Guided/Free a question defaults to -------
// See writing-mode-plan.md §3 — this is the mapping the whole auto-selection
// feature turns on, so it is pinned here the same way the grading tolerances
// in §2.5 are pinned above.
check('a character never attempted (no record at all) defaults to Trace',
  srs.autoWritingMode(null) === 'trace');
let writingRec = srs.grade(srs.newRecord(), true, now); // box 1
check('a character below box 3 defaults to Guided',
  srs.autoWritingMode(writingRec) === 'guided', `box ${writingRec.box}`);
writingRec = srs.grade(writingRec, false, now); // a miss always drops to box 0
check('a record reset to box 0 by a miss still defaults to Guided, not back to Trace — it has been attempted before',
  writingRec.box === 0 && srs.autoWritingMode(writingRec) === 'guided');
writingRec = srs.grade(srs.newRecord(), true, now);
writingRec = srs.grade(writingRec, true, now);
writingRec = srs.grade(writingRec, true, now); // three passes reach box 3
check('a character that has reached box 3 defaults to Free — the guide is trusted to fade away',
  writingRec.box === 3 && srs.autoWritingMode(writingRec) === 'free');
check('a maxed-out character also defaults to Free', srs.autoWritingMode(maxed) === 'free');
done('writing mode: Trace/Guided/Free is chosen from mastery, not hardcoded');

// --- Per-reading (yomi) records: streak + lifetime-correct driven interval -

let yrec = srs.newYomiRecord();
check('a fresh yomi record has no history', yrec.correct === 0 && yrec.incorrect === 0 && yrec.streak === 0);

yrec = srs.gradeYomi(yrec, true, now);
check('first correct: streak 1', yrec.streak === 1);
check('first correct: lifetime correct count is 1', yrec.correct === 1);
check('lastReviewed is set, secondLastReviewed is not (no prior review)',
  yrec.lastReviewed === now && yrec.secondLastReviewed === null);

const secondNow = now + DAY;
yrec = srs.gradeYomi(yrec, true, secondNow);
check('second correct in a row: streak 2', yrec.streak === 2);
check('secondLastReviewed captures the previous review', yrec.secondLastReviewed === now);
check('the interval taken between the last two reviews is reconstructable',
  yrec.lastReviewed - yrec.secondLastReviewed === DAY);

yrec = srs.gradeYomi(yrec, false, secondNow + DAY);
check('a miss resets the streak to zero', yrec.streak === 0);
check('a miss counts as incorrect, not correct', yrec.incorrect === 1 && yrec.correct === 2);
check('a miss does NOT erase the lifetime correct count — that is the whole point', yrec.correct === 2);
check('a miss makes the record due right away', yrec.due === secondNow + DAY);
check('the generic isDue() helper works on a yomi record too (same .due field)',
  srs.isDue(yrec, secondNow + DAY) && !srs.isDue(yrec, secondNow + DAY - 1));

// The central claim: a reading with a long correct history recovers a longer
// interval after one slip than a reading with no track record at all, even
// though both are back to streak 1.
let veteran = srs.newYomiRecord();
for (let i = 0; i < 20; i += 1) veteran = srs.gradeYomi(veteran, true, now); // 20 lifetime correct
veteran = srs.gradeYomi(veteran, false, now); // one slip
veteran = srs.gradeYomi(veteran, true, now); // back to streak 1
let rookie = srs.newYomiRecord();
rookie = srs.gradeYomi(rookie, true, now); // streak 1, correct 1 — nothing else
check('both records are at streak 1 for a fair comparison', veteran.streak === 1 && rookie.streak === 1);
check('a veteran reading earns a longer interval than a rookie at the same streak',
  veteran.intervalDays > rookie.intervalDays,
  `veteran ${veteran.intervalDays}d vs rookie ${rookie.intervalDays}d`);

let longStreak = srs.newYomiRecord();
for (let i = 0; i < 50; i += 1) longStreak = srs.gradeYomi(longStreak, true, now);
check('the interval is capped rather than growing without bound',
  longStreak.intervalDays <= 120, `got ${longStreak.intervalDays}`);
done('per-reading records reward both streak and lifetime correct count');

// --- Never-missed characters fade out of review -----------------------------
// The point: a kid who already knew some characters coming in should stop
// seeing them in review almost entirely, as long as they never get one wrong.

let neverMissed = srs.newRecord();
for (let i = 0; i < 6; i += 1) neverMissed = srs.grade(neverMissed, true, now); // reaches box 6
check('six straight passes reach the top box', neverMissed.box === srs.MAX_BOX);
check('top box is the ordinary 32-day interval', neverMissed.intervalDays === 32);

const afterOne = srs.grade(neverMissed, true, now);
check('a further pass with a perfect record grows the interval', afterOne.intervalDays === 64);
const afterTwo = srs.grade(afterOne, true, now);
check('it keeps growing', afterTwo.intervalDays === 128, `got ${afterTwo.intervalDays}`);
const afterThree = srs.grade(afterTwo, true, now);
check('growth is capped rather than unbounded', afterThree.intervalDays === 180, `got ${afterThree.intervalDays}`);
check('box stays at the top, only the interval keeps growing', afterThree.box === srs.MAX_BOX);

// The moment a character is missed even once, the extra growth stops for
// good — it goes back to behaving like anything else being learned.
let onceMissed = srs.newRecord();
for (let i = 0; i < 6; i += 1) onceMissed = srs.grade(onceMissed, true, now);
onceMissed = srs.grade(onceMissed, false, now); // one lapse, box back to 0
for (let i = 0; i < 6; i += 1) onceMissed = srs.grade(onceMissed, true, now); // climbs back up
check('recovering to the top box after one lapse stays at the ordinary interval',
  onceMissed.intervalDays === 32, `got ${onceMissed.intervalDays}`);
const onceMissedAgain = srs.grade(onceMissed, true, now);
check('it does not resume growing just because it is passing again',
  onceMissedAgain.intervalDays === 32, `got ${onceMissedAgain.intervalDays}`);
done('never-missed characters get spaced out further, not reviewed forever');

// --- Review favours characters that have actually been missed --------------
// (using the literal mode id here, not the `mode` binding declared further
// down in this file, to sidestep a temporal-dead-zone reference)

const revProgress = {};
const solidChars = 'あいうえお'.split('');
const shakyChars = 'かきくけこ'.split('');
solidChars.forEach((k) => {
  let r = srs.newRecord();
  r = srs.grade(r, true, now - DAY);
  revProgress[srs.itemKey('recognition', k)] = r; // due, zero lapses
});
shakyChars.forEach((k) => {
  let r = srs.newRecord();
  r = srs.grade(r, true, now - 2 * DAY);
  r = srs.grade(r, false, now - DAY); // one lapse, back to box 0, due
  revProgress[srs.itemKey('recognition', k)] = r;
});
const ranked = srs.dueItems(hiragana, 'recognition', revProgress, 5, now);
check('a capped review pulls the missed characters first',
  ranked.every((k) => shakyChars.includes(k)),
  ranked.join(''));

const smallCourse = { chunks: [{ items: [...solidChars, ...shakyChars] }] };
const uncapped = srs.dueItems(smallCourse, 'recognition', revProgress, 100, now);
check('nothing due is silently dropped when the cap is not hit',
  uncapped.length === 10, `got ${uncapped.length}`);
check('within the same lapse count, the more overdue one comes first',
  uncapped.indexOf(shakyChars[0]) < uncapped.indexOf(solidChars[0]));
done('review favours misses over a perfect record');

// --- Chunk gating ---------------------------------------------------------

const progress = {};
const mode = 'recognition';
check('starts on the first set', srs.currentSetIndex(hiragana, mode, progress) === 0);
check('a fresh course is ready for more', srs.readyForMore(hiragana, mode, progress));

// Introduce 4 of the 5 characters in set 0 and get them to box 2.
hiragana.chunks[0].items.slice(0, 4).forEach((kana) => {
  let r = srs.newRecord();
  r = srs.grade(r, true, now);
  r = srs.grade(r, true, now);
  progress[srs.itemKey(mode, kana)] = r;
});
check('still on set 0 while one character is unmet',
  srs.currentSetIndex(hiragana, mode, progress) === 0);
check('80% at box 2 counts as consolidated', srs.readyForMore(hiragana, mode, progress));

// Adding more is never blocked, even when the current set is shaky.
const shaky = {};
hiragana.chunks[0].items.forEach((kana) => {
  shaky[srs.itemKey(mode, kana)] = srs.grade(srs.newRecord(), true, now); // box 1 only
});
check('a shaky set is flagged as not consolidated', !srs.readyForMore(hiragana, mode, shaky));
check('but more characters are still offered',
  srs.newItems(hiragana, mode, shaky, 5).length === 5,
  'adding more must never be blocked — the learner decides');
check('new characters continue in teaching order',
  srs.newItems(hiragana, mode, shaky, 5)[0] === hiragana.chunks[1].items[0]);
check('moving on advances the displayed set',
  srs.currentSetIndex(hiragana, mode, shaky) === 1);

check('writing mode is tracked separately',
  srs.currentSetIndex(hiragana, 'writing', progress) === 0
  && srs.courseStats(hiragana, 'writing', progress).started === 0);

const session = srs.buildSession(hiragana, mode, progress, 'new', { newPerSession: 3, now });
check('lesson respects the new-per-session cap', session.lesson.length === 3, `got ${session.lesson.length}`);
check('a "new" session quizzes exactly what it taught',
  session.quiz.length === session.lesson.length);
check('a "new" session never includes seen characters',
  session.lesson.every((k) => !progress[srs.itemKey(mode, k)]));

const reviewNow = srs.buildSession(hiragana, mode, progress, 'review', { now });
check('nothing is due on the same day', reviewNow.quiz.length === 0, `got ${reviewNow.quiz.length}`);
check('a review session never teaches', reviewNow.lesson.length === 0);

const later = now + 2 * DAY;
const reviewLater = srs.buildSession(hiragana, mode, progress, 'review', { now: later });
check('reviews come due after the interval', reviewLater.quiz.length === 4, `got ${reviewLater.quiz.length}`);
check('review sessions exclude never-seen characters',
  reviewLater.quiz.every((k) => progress[srs.itemKey(mode, k)]));

const practice = srs.buildSession(hiragana, mode, progress, 'practice', { now });
check('practice ignores the schedule', practice.quiz.length === 4, `got ${practice.quiz.length}`);

const stats = srs.courseStats(hiragana, mode, progress, later);
check('stats total', stats.total === 104);
check('stats started', stats.started === 4, `got ${stats.started}`);
check('stats due', stats.due === 4, `got ${stats.due}`);
done('chunk gating and sessions');

// --- Study list -----------------------------------------------------------
// See kanji-expansion-plan.md §1. The key property throughout: passing a bare
// progress map (as every test above does) means "no study list", which turns
// enrollment filtering off entirely and reproduces the original behaviour —
// that is what keeps kana, and all of the above, working untouched.

const g1 = KANJI_COURSES.find((c) => c.id === 'kanji-grade-1');
const g2 = KANJI_COURSES.find((c) => c.id === 'kanji-grade-2');

// Migration: read enrollment back out of whatever records already exist.
const legacyProgress = {
  'definition:一': srs.newRecord(),
  'recognition:一': srs.newRecord(),
  'writing:二': srs.newRecord(),
  'recognition:あ': srs.newRecord(),          // kana — not study-listed
  'recognition:生:セイ': srs.newYomiRecord(), // per-reading key, not an item
};
const derived = srs.deriveStudyList(legacyProgress);
check('migration enrolls each kanji in exactly the modes it has records for',
  Object.keys(derived['一']).sort().join(',') === 'definition,recognition'
  && Object.keys(derived['二']).join(',') === 'writing',
  JSON.stringify(derived));
check('a migrated enrollment carries timestamp 0 — no evidence of when it happened',
  derived['一'].definition === 0 && derived['一'].recognition === 0,
  JSON.stringify(derived['一']));
check('migration ignores kana — the study list is kanji-only',
  !('あ' in derived), JSON.stringify(derived));
check('migration ignores 3-part per-reading yomi keys, which are not items',
  !('生' in derived), JSON.stringify(derived));

// Enroll / un-enroll round-trip.
const study = {};
const unstudy = {};
srs.setStudying(study, unstudy, '山', 'writing', true);
srs.setStudying(study, unstudy, '山', 'definition', true);
check('enrolling records the mode', srs.isStudying(study, '山', 'writing'));
check('modes are independent',
  !srs.isStudying(study, '山', 'recognition'), JSON.stringify(study));
srs.setStudying(study, unstudy, '山', 'writing', false);
check('un-enrolling one mode leaves the others', srs.isStudying(study, '山', 'definition')
  && !srs.isStudying(study, '山', 'writing'));
check('un-enrolling records a tombstone with a real timestamp',
  typeof unstudy['山'].writing === 'number' && unstudy['山'].writing > 0, JSON.stringify(unstudy));
srs.setStudying(study, unstudy, '山', 'definition', false);
check('a kanji with no modes left is removed entirely, not left as an empty object',
  !('山' in study), JSON.stringify(study));

// Enrollment gates what a session can contain.
const p = { progress: {}, study: {}, unstudy: {} };
check('nothing is eligible before anything is enrolled',
  srs.newItems(g1, 'definition', p, 5).length === 0
  && srs.courseStats(g1, 'definition', p).started === 0);

const enrolled = srs.enrollNext(g1, 'definition', p, 3);
check('enrollNext takes the next few in teaching order', enrolled.length === 3
  && enrolled[0] === g1.chunks[0].items[0], enrolled.join(''));
check('enrolled-but-untaught kanji are pending, and are what a new session teaches',
  srs.pendingItems(g1, 'definition', p).length === 3
  && srs.buildSession(g1, 'definition', p, 'new', { newPerSession: 5 }).lesson.length === 3);
check('stats separate waiting-to-learn from not-yet-enrolled',
  srs.courseStats(g1, 'definition', p).pending === 3
  && srs.courseStats(g1, 'definition', p).unenrolled === g1.chunks.flatMap((c) => c.items).length - 3);

// A manually-added kanji from a later set jumps the queue, because pending is
// in course order but "add more" only tops up what is already waiting.
srs.setStudying(p.study, p.unstudy, g1.chunks[4].items[0], 'definition', true);
check('a kanji added by hand becomes pending immediately, without waiting for grade order',
  srs.pendingItems(g1, 'definition', p).includes(g1.chunks[4].items[0]));

// Teaching one removes it from pending and puts it on the schedule.
p.progress[srs.itemKey('definition', enrolled[0])] = srs.grade(srs.newRecord(), true, now);
check('a taught kanji leaves pending and counts as started',
  !srs.pendingItems(g1, 'definition', p).includes(enrolled[0])
  && srs.courseStats(g1, 'definition', p).started === 1);

// Un-enrolling hides it from scheduling but keeps the history.
srs.setStudying(p.study, p.unstudy, enrolled[0], 'definition', false);
check('un-enrolling drops it out of review without deleting its record',
  srs.courseStats(g1, 'definition', p).started === 0
  && !!p.progress[srs.itemKey('definition', enrolled[0])]);
srs.setStudying(p.study, p.unstudy, enrolled[0], 'definition', true);
check('re-enrolling resumes from the record that was kept, not from zero',
  srs.courseStats(g1, 'definition', p).started === 1
  && p.progress[srs.itemKey('definition', enrolled[0])].box === 1);

// excludeForMode still applies through the study list, not just a course.
const noYomi = [...(g1.excludeForMode.recognition || [])][0];
if (noYomi) {
  const ex = { progress: {}, study: {}, unstudy: {} };
  srs.setStudying(ex.study, ex.unstudy, noYomi, 'recognition', true);
  check('a kanji with no quizzable reading stays excluded from Yomi even when enrolled in it',
    srs.pendingItems(g1, 'recognition', ex).length === 0, noYomi);
}

// A pool spanning several grades — what "review everything I'm studying"
// builds on. A synthetic single-chunk course is all it takes (§1.5).
const across = { progress: {}, study: {}, unstudy: {} };
const fromG1 = g1.chunks[0].items[0];
const fromG2 = g2.chunks[0].items[0];
[fromG1, fromG2].forEach((k) => {
  srs.setStudying(across.study, across.unstudy, k, 'definition', true);
  across.progress[srs.itemKey('definition', k)] = srs.grade(srs.newRecord(), false, now);
});
const studyPool = { chunks: [{ items: srs.studiedKanji(across.study, 'definition') }], excludeForMode: {} };
const acrossSession = srs.buildSession(studyPool, 'definition', across, 'review', { now });
check('a study-list pool reviews across grades in one session',
  acrossSession.quiz.includes(fromG1) && acrossSession.quiz.includes(fromG2),
  acrossSession.quiz.join(''));
check('a single-grade course still only reviews its own grade',
  !srs.buildSession(g1, 'definition', across, 'review', { now }).quiz.includes(fromG2));

done('study list: enrollment gates scheduling, and survives un-enrolling');

// --- Vocab yomi options vs. the reveal ladder's visible furigana ----------
//
// The bug this guards: 質問 shown as 質[しつ]問 (問 already known, so its
// furigana is hidden) was offered じつもん / たちもん / ちもん as wrong
// answers — every one of them contradicting the しつ printed on screen, so
// four of six options fell to a glance and the question never asked what it
// meant to ask (how 問 is read). See vocab-plan.md §5.4.

const vocab = await import('../src/vocab.js');
await Promise.all(vocab.VOCAB_COURSES.map((c) => vocab.ensureVocabUnitLoaded(c.unit)));

const shitsumon = vocab.VOCAB_COURSES.find((c) => c.index.has('質問'));
const monHidden = vocab.buildYomiChoices(shitsumon, '質問', new Set([1]));
check('every option agrees with the furigana still on screen',
  monHidden.options.every((o) => o.startsWith('しつ')), monHidden.options.join(' '));
check('the option that varies the hidden kanji survives the filter',
  monHidden.options.includes('しつとん'), monHidden.options.join(' '));
const shitsuHidden = vocab.buildYomiChoices(shitsumon, '質問', new Set([0]));
check('the mirror case filters on the other side',
  shitsuHidden.options.every((o) => o.endsWith('もん')), shitsuHidden.options.join(' '));
check('a word with nothing visible still gets a full set of options',
  vocab.buildYomiChoices(shitsumon, '質問', new Set([0, 1])).options.length === 6);

// Exhaustive: for every multi-kanji word, hiding exactly one kanji must
// never produce an option that drops a visible kanji's own kana.
let contradictions = 0;
let askable = 0;
let scenarios = 0;
for (const course of vocab.VOCAB_COURSES) {
  for (const info of course.index.values()) {
    if (!info.ruby || info.ruby.length < 2) continue;
    for (const [pos] of info.ruby) {
      scenarios += 1;
      const { options } = vocab.buildYomiChoices(course, info.id, new Set([pos]));
      if (options.length >= vocab.MIN_YOMI_OPTIONS) askable += 1;
      for (const [other, kana] of info.ruby) {
        if (other === pos) continue;
        if (options.some((o) => !o.includes(kana))) contradictions += 1;
      }
    }
  }
}
check('no partially-revealed word offers an option its visible furigana rules out',
  contradictions === 0, `${contradictions} of ${scenarios} scenarios`);
// Not a behaviour requirement so much as a canary: the filter only works
// because most hidden kanji still have enough plausible misreadings to fill
// a question. If this collapses, the follow-up has quietly stopped being
// asked and the option pool needs enriching at build time instead.
check('most partially-revealed words can still be asked', askable / scenarios > 0.7,
  `${askable}/${scenarios}`);

done('vocab yomi options never contradict the furigana on screen');

// --- Result ---------------------------------------------------------------

print('');
if (failures) {
  print(`${failures} failure(s)`);
  throw new Error(`${failures} test failure(s)`);
}
print('all tests passed');
