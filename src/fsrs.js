// FSRS-6 (Free Spaced Repetition Scheduler), reimplemented directly in plain
// JS from the published algorithm — see review-followups.md item 9. No
// package is vendored (this repo has no build step and no npm dependencies
// beyond the hand-copied vendor/wanakana.min.js); the formulas and default
// parameter weights below are transcribed from the open-spaced-repetition
// project's own reference implementation (ts-fsrs, MIT-licensed,
// github.com/open-spaced-repetition/ts-fsrs — the JSDoc comments on each
// function here quote the same LaTeX the upstream source carries) and
// validated against that implementation's own published test vectors — see
// the "FSRS reference vectors" block in test/smoke.js, which runs this
// module's nextState() against two of ts-fsrs's own FSRS-6.test.ts cases
// (an exact new-card check and a 6-review short-term/long-term memory-state
// check) and requires the results to match to the same tolerance the
// upstream test itself uses.
//
// FSRS models each item with two numbers: `difficulty` (1-10, how hard this
// specific item is for THIS learner) and `stability` (days — how long until
// recall probability decays to the target retention). Every review updates
// both from a 4-point grade (Again/Hard/Good/Easy) rather than srs.js's old
// fixed Leitner-box doubling, so two items reaching "box 4" by very
// different, differently-error-prone paths no longer get treated as
// identically well-known — see srs.js's grade()/gradeYomi() for how this
// plugs into the rest of the scheduler, and migrateLegacyRecord/
// migrateLegacyYomiRecord below for how an item's PRE-FSRS box/streak
// history seeds its starting difficulty/stability rather than resetting it.

export const RATING = Object.freeze({ AGAIN: 1, HARD: 2, GOOD: 3, EASY: 4 });

// FSRS-6 default parameters (21 weights), from open-spaced-repetition's own
// published defaults (default_w in ts-fsrs's src/default.ts as of the
// FSRS-6.0 release) — these are the community-trained weights fit across a
// large cross-app review-log dataset, not something this app has any basis
// to retune on its own. w[20] is the "decay" parameter that shapes the
// forgetting curve itself; w[0..3] are per-grade initial stabilities;
// w[4]/w[5] seed initial difficulty; the rest govern the difficulty/
// stability update formulas below.
export const DEFAULT_WEIGHTS = Object.freeze([
  0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722,
  0.1666, 0.796, 1.4835, 0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425,
  0.0912, 0.0658, 0.1542,
]);

// Target recall probability a scheduled interval is calibrated for — FSRS's
// own default, and a reasonable one: higher (e.g. 0.95) would mean shorter,
// more frequent reviews for the same stability; lower would mean longer,
// leaner ones at more risk of a forgotten answer.
export const DEFAULT_REQUEST_RETENTION = 0.9;

// Absolute floor/ceiling stability can round-trip to without misbehaving
// (matches upstream's S_MIN) or run away to (chosen for this app, well
// below upstream's 36500-day ceiling — a kana or kanji quiz item has no
// business being scheduled literally decades out; this still comfortably
// exceeds the old scheduler's 180-day NEVER_MISSED_CAP_DAYS ceiling, which
// this migration retires as redundant, see srs.js).
export const S_MIN = 0.001;
export const MAX_STABILITY_DAYS = 3650;
// The actual scheduling ceiling applied when turning stability into a
// due-date interval (see nextIntervalDays) — deliberately tighter than
// MAX_STABILITY_DAYS: stability itself is allowed to keep growing
// (next_recall_stability has no reason to be capped early), but no review is
// ever scheduled further out than this, so an item never reads as
// "abandoned" even after years of a perfect record.
export const MAX_INTERVAL_DAYS = 365;

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
function roundTo(x, n) { const f = 10 ** n; return Math.round(x * f) / f; }

/**
 * $$D_0(G) = w_4 - e^{(G-1) \cdot w_5} + 1$$
 * Deliberately UNCLAMPED — this bit the first draft of this module during
 * validation against the reference vectors: upstream's own init_difficulty()
 * does not clamp to [1,10] internally, only at specific call sites (the
 * very first difficulty a record ever gets, and next_difficulty's own
 * return value below). init_difficulty(EASY) in particular is used
 * UNCLAMPED as next_difficulty's mean-reversion pull target, and evaluates
 * to a deeply negative number under the default weights (~-4.77) — using
 * the clamped value there instead (as this module's first draft did) pulls
 * every well-known item's difficulty down at roughly half the rate it
 * should, confirmed by the reference test vectors below.
 */
export function initDifficultyRaw(g, weights = DEFAULT_WEIGHTS) {
  return roundTo(weights[4] - Math.exp((g - 1) * weights[5]) + 1, 8);
}

/** $$S_0(G) = \max\{w_{G-1}, 0.1\}$$ */
export function initStability(g, weights = DEFAULT_WEIGHTS) {
  return Math.max(weights[g - 1], 0.1);
}

function linearDamping(deltaD, oldD) {
  return roundTo((deltaD * (10 - oldD)) / 9, 8);
}

function meanReversion(init, current, weights) {
  return roundTo(weights[7] * init + (1 - weights[7]) * current, 8);
}

/**
 * $$\text{delta}_d = -w_6 \cdot (G-3)$$
 * $$\text{next}_d = D + \text{linear\_damping}(\text{delta}_d, D)$$
 * $$D'(D,G) = w_7 \cdot D_0(\text{Easy}) + (1-w_7) \cdot \text{next}_d$$
 * Every review nudges difficulty toward D_0(Easy) (mean reversion) and away
 * from it proportional to how far the grade was from Good (linear damping,
 * itself scaled down the closer difficulty already is to the top of the
 * 1-10 range) — an Again pushes it up, an Easy pulls it down, a Good leaves
 * it to mean-reversion alone.
 */
export function nextDifficulty(d, g, weights = DEFAULT_WEIGHTS) {
  const deltaD = -weights[6] * (g - 3);
  const nextD = d + linearDamping(deltaD, d);
  return clamp(meanReversion(initDifficultyRaw(RATING.EASY, weights), nextD, weights), 1, 10);
}

/**
 * $$\text{decay} = -w_{20}, \quad \text{factor} = e^{\ln(0.9)/\text{decay}} - 1$$
 * $$R(t,S) = (1 + \text{factor} \cdot t/S)^{\text{decay}}$$
 * Retrievability: the model's estimated probability of successful recall
 * after `elapsedDays` since the last review, given current `stability`.
 * By construction R(S,S) = 0.9 — stability is literally defined as "the
 * number of days until recall probability decays to 90%".
 */
export function retrievability(elapsedDays, stability, weights = DEFAULT_WEIGHTS) {
  const decay = -weights[20];
  const factor = roundTo(Math.exp(Math.log(0.9) / decay) - 1, 8);
  return roundTo((1 + (factor * elapsedDays) / stability) ** decay, 8);
}

/**
 * $$S'_r(D,S,R,G) = S \cdot \big(1 + e^{w_8}\cdot(11-D)\cdot S^{-w_9}\cdot
 *   (e^{w_{10}(1-R)}-1)\cdot w_{15}[\text{if }G{=}\text{Hard}]\cdot
 *   w_{16}[\text{if }G{=}\text{Easy}]\big)$$
 * New stability after a SUCCESSFUL review (Hard/Good/Easy) at elapsed time
 * t > 0 — the core "how much did getting this right, at this difficulty,
 * having decayed to this much retrievability, grow its stability" formula.
 */
export function nextRecallStability(d, s, r, g, weights = DEFAULT_WEIGHTS) {
  const hardPenalty = g === RATING.HARD ? weights[15] : 1;
  const easyBonus = g === RATING.EASY ? weights[16] : 1;
  const value = s * (1 + Math.exp(weights[8]) * (11 - d) * s ** -weights[9]
    * (Math.exp((1 - r) * weights[10]) - 1) * hardPenalty * easyBonus);
  return roundTo(clamp(value, S_MIN, MAX_STABILITY_DAYS), 8);
}

/**
 * $$S'_f(D,S,R) = w_{11}\cdot D^{-w_{12}}\cdot\big((S+1)^{w_{13}}-1\big)
 *   \cdot e^{w_{14}(1-R)}$$
 * New stability after a LAPSE (Again) at elapsed time t > 0 — how far a
 * forgotten item's stability falls back, given how difficult it already
 * was, how stable it had been, and how thoroughly it had decayed by the
 * time it was forgotten. This is FSRS's own, continuous answer to the
 * question the old scheduler's bolted-on leech cap tried to answer with a
 * fixed miss-streak threshold — see srs.js's module header for why this
 * migration removes that mechanism rather than keeping it alongside FSRS.
 */
export function nextForgetStability(d, s, r, weights = DEFAULT_WEIGHTS) {
  const value = weights[11] * d ** -weights[12] * ((s + 1) ** weights[13] - 1)
    * Math.exp((1 - r) * weights[14]);
  return roundTo(clamp(value, S_MIN, MAX_STABILITY_DAYS), 8);
}

/**
 * $$S'_s(S,G) = S \cdot S^{-w_{19}} \cdot e^{w_{17}(G-3+w_{18})}$$
 * (masked so a Hard-or-better grade can never SHRINK stability on a
 * same-day re-review, matching upstream's own guard)
 * New stability for a SAME-DAY re-review (elapsed = 0) — this is what a
 * kana-quest "box 0, ask again this session" re-ask becomes under FSRS:
 * a review that happens before any real time (and so any real forgetting)
 * has elapsed uses this short-term formula instead of the ordinary
 * recall/forget ones, which assume a real gap to measure retrievability
 * decay over.
 */
export function nextShortTermStability(s, g, weights = DEFAULT_WEIGHTS) {
  const sinc = s ** -weights[19] * Math.exp(weights[17] * (g - 3 + weights[18]));
  const masked = g >= RATING.HARD ? Math.max(sinc, 1.0) : sinc;
  return roundTo(clamp(s * masked, S_MIN, MAX_STABILITY_DAYS), 8);
}

/**
 * The full per-review update: given the item's current {difficulty,
 * stability} (or `null` for a never-reviewed item), how long ago it was
 * last reviewed, and this review's grade, returns the new {difficulty,
 * stability}. Mirrors upstream's own next_state() one-for-one (see the
 * module header for how this was validated against it) — deliberately
 * NOT reproducing its surrounding Card/State/learning-steps machinery,
 * which models Anki-specific same/next-day graduation concepts kana-quest
 * has no equivalent of; every kana-quest review either lands here as a
 * same-session (elapsedDays 0) or a real-gap review, nothing in between.
 */
export function nextState(state, elapsedDays, rating, weights = DEFAULT_WEIGHTS) {
  if (!state || (state.stability === 0 && state.difficulty === 0)) {
    return {
      difficulty: clamp(initDifficultyRaw(rating, weights), 1, 10),
      stability: initStability(rating, weights),
    };
  }
  const { difficulty: d, stability: s } = state;
  const r = retrievability(elapsedDays, s, weights);
  let newS;
  if (elapsedDays === 0) {
    newS = nextShortTermStability(s, rating, weights);
  } else if (rating === RATING.AGAIN) {
    newS = nextForgetStability(d, s, r, weights);
  } else {
    newS = nextRecallStability(d, s, r, rating, weights);
  }
  return { difficulty: nextDifficulty(d, rating, weights), stability: newS };
}

/**
 * $$I(r,S) = \big(r^{1/\text{decay}} - 1\big) / \text{factor} \cdot S$$
 * Days until the next review should happen, given a stability and a target
 * retention — the inverse of retrievability(): "how many days until R(t,S)
 * decays to exactly `requestRetention`". Always at least 1 day (matching
 * upstream) and capped at MAX_INTERVAL_DAYS (see its own comment above).
 */
export function nextIntervalDays(
  stability, requestRetention = DEFAULT_REQUEST_RETENTION, weights = DEFAULT_WEIGHTS,
  maxDays = MAX_INTERVAL_DAYS,
) {
  const decay = -weights[20];
  const factor = roundTo(Math.exp(Math.log(0.9) / decay) - 1, 8);
  const modifier = roundTo((requestRetention ** (1 / decay) - 1) / factor, 8);
  return Math.min(Math.max(1, Math.round(stability * modifier)), maxDays);
}
