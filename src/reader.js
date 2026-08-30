// Pure story-rendering logic: no DOM, so every rule below is unit-testable
// against a synthetic profile (see stories-plan.md §5.7/§10). app.js turns
// this module's output into spans; nothing here touches document.

import {
  exposureWordKey, exposureKanjiKey, isExposurePromoted, isFuriganaMuted,
} from './srs.js';

const { toHiragana } = window.wanakana;

const KANJI_RE = /[㐀-䶿一-鿿]/;
const KATAKANA_RE = /[ァ-ヺー]/;

export function tokenHasKanji(token) {
  return KANJI_RE.test(token.s);
}

/** A pure kana word whose NATIVE spelling is katakana (a loanword) — kept in
 * katakana even at the hiragana-only stage rather than being converted,
 * since a wrong-looking spelling misleads more than one unfamiliar script
 * inside a familiar one (stories-plan.md §5.6). */
function isKatakanaWord(token) {
  return !tokenHasKanji(token) && KATAKANA_RE.test(token.k);
}

/** The kana form shown at stage 'hira' — token.k converted to hiragana,
 * except a katakana loanword, which stays as written (§5.6). */
function hiraForm(token) {
  return isKatakanaWord(token) ? token.k : toHiragana(token.k);
}

/**
 * Every exposure key a SHOWN-with-ruby occurrence of this token should
 * accrue against: the word itself (what stories-plan.md §6.1's hiding rule
 * reads) and one per ruby position, keyed exactly like the vocab quiz's own
 * (kanji, reading) keys (§6.2) — so a story is a second way the very same
 * reading earns its hidden default in the quiz, and vice versa. Empty for a
 * token with no kanji, or a jukujikun-shaped token with `ruby: null`
 * (neither story in this pass uses one, but a future one may).
 */
export function exposureTargetsForToken(token) {
  if (!token.ruby) return [];
  const targets = [exposureWordKey(token.s)];
  token.ruby.forEach(([pos, reading]) => {
    targets.push(exposureKanjiKey(token.s[pos], reading));
  });
  return targets;
}

/**
 * Whether this token's furigana is hidden by default — stories-plan.md
 * §6.1's four-way OR, decided per WORD (unlike the vocab quiz's per-kanji
 * rule — see that section for why a story is all-or-nothing). `view.exposure`
 * / `view.muted` are the profile's own maps; `view.isKanjiKnown(char)` is
 * the caller's own claim-on-a-kanji predicate (kanji.js's `isKanjiKnown` in
 * app.js, which already gets the vmeaning/vrecall-key-collision case right
 * — reused rather than reimplemented here).
 */
export function isTokenFuriganaHidden(token, view) {
  if (!token.ruby) return false;
  const wordKey = exposureWordKey(token.s);
  if (isExposurePromoted(view.exposure, wordKey)) return true;
  if (isFuriganaMuted(view.muted, wordKey)) return true;
  const chars = [...token.s].filter((ch) => KANJI_RE.test(ch));
  return chars.length > 0 && chars.every((ch) => view.isKanjiKnown(ch));
}

/**
 * Whether this token renders in kanji at all, for the current view. Always
 * true outside the 'kanji' stage's own window (frontier grades 1-3, §5.4);
 * within the window, true only if every kanji in the word is in the
 * frontier unit or the next one, OR already known — decided per WHOLE WORD,
 * never per character, so a word never renders half in kanji and half in
 * kana (§5.4's explicit rule).
 */
function wordRendersAsKanji(token, view) {
  if (!tokenHasKanji(token)) return false;
  if (view.stage !== 'kanji') return false;
  if (!view.windowActive) return true;
  const chars = [...token.s].filter((ch) => KANJI_RE.test(ch));
  return chars.every((ch) => view.inWindow(ch) || view.isKanjiKnown(ch));
}

/**
 * One token's starting (reveal-level 0) render — stories-plan.md §5's four
 * stages collapsed into one decision per token:
 *
 *   form: 'kanji' | 'kana' — which spelling is on screen right now
 *   text: the string to show at level 0 (kana form, or kanji form with
 *         ruby hidden — the caller overlays ruby separately when shown)
 *   ruby: this token's ruby array, only when form is 'kanji' — the caller
 *         decides whether to actually render it from `hidden` below
 *   hidden: whether that ruby is hidden by default (§6.1) — meaningless
 *           when form is 'kana', since there is nothing to hide
 *   tappable: false only for punctuation
 *   maxLevel: how many taps the reveal ladder has — 0 for punctuation, 1 for
 *             a token with nothing to protect (kana form, or a known/visible
 *             kanji form with no romaji-only gap), 2 for a hidden kanji form
 *             (tap once for furigana, again for romaji)
 */
function renderToken(token, view) {
  if (token.pos === 'punct') {
    return { form: 'kana', text: token.s, ruby: null, hidden: false, tappable: false, maxLevel: 0 };
  }
  const asKanji = wordRendersAsKanji(token, view);
  if (!asKanji) {
    const text = view.stage === 'hira' ? hiraForm(token) : token.k;
    return { form: 'kana', text, ruby: null, hidden: false, tappable: true, maxLevel: 1 };
  }
  const hidden = isTokenFuriganaHidden(token, view);
  return {
    form: 'kanji', text: token.s, ruby: token.ruby, hidden, tappable: true, maxLevel: hidden ? 2 : 1,
  };
}

/**
 * Whether a token joins the PRECEDING one with no space before it — a
 * particle or auxiliary attaches to its host (おじいさんは, not おじいさん
 * は), and punctuation always attaches to what precedes it. Reproduces
 * printed 分かち書き rather than spacing every token uniformly (§5.2).
 */
function joinsPrevious(token) {
  return token.pos === 'part' || token.pos === 'aux' || token.pos === 'punct';
}

// Opening brackets/quotes attach to what FOLLOWS instead — 「 should not be
// glued to the previous word. Extend this if a story ever needs another
// opening mark (『, (, ...).
const OPENING_PUNCT = new Set(['「']);

/**
 * Renders one sentence's tokens for the given view — the whole pass, so
 * spacing (only at stages 'hira'/'kana', per §5.4) can be decided from
 * neighbouring tokens rather than one token in isolation. Returns one
 * descriptor per token, each carrying everything renderToken produces plus
 * `spaceBefore` and the token's own index for the caller to key reveal
 * state and DOM nodes by.
 */
export function renderSentence(tokens, view) {
  const spaced = view.stage !== 'kanji';
  let prevOpening = false;
  return tokens.map((token, i) => {
    const rendered = renderToken(token, view);
    let spaceBefore = false;
    if (spaced && i > 0) {
      spaceBefore = !joinsPrevious(token) && !prevOpening;
    }
    prevOpening = OPENING_PUNCT.has(token.s);
    return { ...rendered, i, pos: token.pos, spaceBefore };
  });
}

/**
 * The reveal ladder's next state, mirroring vocab's per-word ladder
 * (vocab-plan.md §5.2) one level deeper into a whole sentence: level 0 is
 * whatever renderToken already decided (hidden or shown by its own rules),
 * level 1 shows furigana (if it was hidden) or romaji (if it wasn't — a
 * known kanji, or a kana-form token), level 2 (kanji form, was hidden) shows
 * romaji on top of the now-visible furigana. Pure — the caller (app.js)
 * owns the actual DOM patch and the exposure/demotion bookkeeping that a
 * transition from 0 recording an exposure implies (§6.3).
 */
export function tokenAtLevel(rendered, level) {
  const clamped = Math.max(0, Math.min(level, rendered.maxLevel));
  if (rendered.form === 'kana') {
    return { text: rendered.text, showRuby: false, showRomaji: clamped >= 1 };
  }
  const showRuby = !rendered.hidden || clamped >= 1;
  const romajiLevel = rendered.hidden ? 2 : 1;
  return { text: rendered.text, showRuby, ruby: showRuby ? rendered.ruby : null, showRomaji: clamped >= romajiLevel };
}
