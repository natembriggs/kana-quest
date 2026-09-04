// Shared furigana-hiding predicate — the one piece of "kanji with optional
// ruby that reveals on tap" logic that reader.js and app.js/vocab.js
// genuinely duplicated byte-for-byte (review-followups.md item 6). Everything
// AROUND this predicate stays where it is and stays different on purpose:
// reader.js decides per whole word (a word with one ruby on and one off is a
// visual stutter mid-sentence — stories-plan.md §6.1), app.js's
// `vocabHiddenState` decides per individual kanji position and has its own
// quiz-specific "partial furigana has to stay askable" override that reader.js
// has no equivalent of, and the two tap-state machines (`vocabRevealLevel` in
// app.js vs. `tokenAtLevel` in reader.js) are unrelated. Only the core
// three-way OR below was ever actually shared.

import { isExposurePromoted, isFuriganaMuted } from './srs.js';

/**
 * Whether a single reading — keyed by `key` (an exposureWordKey or
 * exposureKanjiKey from srs.js) — is hidden by default: already known, OR
 * promoted by exposure, OR muted by hand. `known` is supplied by the caller
 * rather than computed here, since what "known" means differs by caller (a
 * whole-word AND across every kanji in reader.js's per-word check and
 * app.js's `whole` mode, vs. a single kanji in app.js's `perchar` mode).
 */
export function isReadingHidden(key, { exposure, muted, known }) {
  return known || isExposurePromoted(exposure, key) || isFuriganaMuted(muted, key);
}
