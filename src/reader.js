// Pure story-rendering logic: no DOM, so every rule below is unit-testable
// against a synthetic profile (see stories-plan.md §5.7/§10). app.js turns
// this module's output into spans; nothing here touches document.

import {
  exposureWordKey, exposureKanjiKey,
} from './srs.js';
import { isReadingHidden } from './furigana.js';

const { toHiragana } = window.wanakana;

const KANJI_RE = /[㐀-䶿一-鿿]/;
// A katakana SYLLABLE. Deliberately excludes ー (the prolonged-sound mark)
// and ・ (the name separator): both sit *inside* a katakana run without being
// sounds of their own, so they extend a run (katakanaRuns) but never start
// one, and neither is a character the katakana course teaches.
const KATAKANA_RE = /[ァ-ヺ]/;

export function tokenHasKanji(token) {
  return KANJI_RE.test(token.s);
}

/**
 * Every maximal katakana run in `text`, as `{ start, len, base }`.
 *
 * A run starts at a katakana syllable and swallows ー freely (コーヒー is one
 * word, not three). It swallows ・ only when more katakana follows, so the
 * separator inside ロング・ジョン joins the name while a trailing one stays
 * punctuation.
 */
function katakanaRuns(text) {
  const runs = [];
  let i = 0;
  while (i < text.length) {
    if (!KATAKANA_RE.test(text[i])) { i += 1; continue; }
    let end = i + 1;
    while (end < text.length) {
      const ch = text[end];
      if (KATAKANA_RE.test(ch) || ch === 'ー') { end += 1; continue; }
      if (ch === '・' && KATAKANA_RE.test(text[end + 1] || '')) { end += 1; continue; }
      break;
    }
    runs.push({ start: i, len: end - i, base: text.slice(i, end) });
    i = end;
  }
  return runs;
}

/**
 * The hiragana shown above a katakana run for a learner who has not met its
 * characters — こーひー over コーヒー (stories-plan.md §5.6).
 *
 * `convertLongVowelMark: false` is the whole point and is NOT wanakana's
 * default: left to itself `toHiragana('コーヒー')` returns こうひい, a pre-war
 * transcription that teaches a spelling nobody writes. Keeping ー gives the
 * mora-for-mora reading, and hiragana with ー is ordinary modern Japanese
 * (らーめん, すごーい). Ruby is a pronunciation guide, not a spelling, so this
 * is honest in a way こうひい would not be.
 */
function katakanaReading(run) {
  return toHiragana(run, { convertLongVowelMark: false });
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

/** What is actually on screen for this token: its written form when §5.4 says
 * the kanji may be shown, its kana form otherwise. */
function renderedText(token, view) {
  return wordRendersAsKanji(token, view) ? token.s : token.k;
}

/**
 * Every ruby annotation this token carries, over the text that is actually on
 * screen — `{ start, len, base, text, kind }`, sorted by position.
 *
 * Two kinds, one list:
 *
 * - `kanji` — the authored per-character `token.ruby`, one span per kanji,
 *   and only when the kanji form is what's being shown.
 * - `katakana` — derived here, never authored, one span per katakana run.
 *   Deriving it means 36 shipped stories needed no re-tokenising to gain it.
 *
 * The two can never overlap: authored ruby positions are kanji positions by
 * build-time check (build_story_data.mjs), and a kanji is not a katakana.
 * They do co-occur — 白ウサギ carries しろ over 白 and うさぎ over ウサギ — and
 * §6.1's visibility decision covers the whole word, so both show or neither
 * does. A word annotated half-on, half-off is a visual stutter mid-sentence.
 *
 * Note the katakana runs are found in the RENDERED text, not the surface:
 * ガラス箱 shown as ガラスばこ by the frontier window still wants がらす over
 * its ガラス, and wants nothing over the ばこ that replaced the kanji.
 */
export function rubySpansFor(token, view) {
  if (token.pos === 'punct') return [];
  const asKanji = wordRendersAsKanji(token, view);
  const text = asKanji ? token.s : token.k;
  const spans = [];
  if (asKanji && token.ruby) {
    token.ruby.forEach(([pos, reading]) => {
      spans.push({ start: pos, len: 1, base: token.s[pos], text: reading, kind: 'kanji' });
    });
  }
  katakanaRuns(text).forEach((run) => {
    spans.push({ ...run, text: katakanaReading(run.base), kind: 'katakana' });
  });
  spans.sort((a, b) => a.start - b.start);
  return spans;
}

/**
 * Whether the learner has a claim on EVERY annotated part of this word —
 * §6.1's "known" term, widened from kanji to cover katakana too.
 *
 * An AND across the whole word, deliberately: 白ウサギ counts as known only
 * once both 白 and ウサギ are, because the visibility decision it feeds is
 * also whole-word.
 */
function spansKnown(spans, view) {
  return spans.length > 0 && spans.every((span) => (span.kind === 'kanji'
    ? view.isKanjiKnown(span.base)
    : view.isKatakanaRunKnown(span.base)));
}

function spansHidden(spans, token, view) {
  if (!spans.length) return false;
  return isReadingHidden(exposureWordKey(token.s), {
    exposure: view.exposure, muted: view.muted, known: spansKnown(spans, view),
  });
}

/**
 * Whether this token's furigana is hidden by default — stories-plan.md
 * §6.1's four-way OR, decided per WORD (unlike the vocab quiz's per-kanji
 * rule — see that section for why a story is all-or-nothing). `view.exposure`
 * / `view.muted` are the profile's own maps; `view.isKanjiKnown(char)` and
 * `view.isKatakanaRunKnown(run)` are the caller's own claim predicates
 * (kanji.js's `isKanjiKnown` in app.js, which already gets the
 * vmeaning/vrecall-key-collision case right, and its katakana counterpart —
 * both reused rather than reimplemented here).
 */
export function isTokenFuriganaHidden(token, view) {
  return spansHidden(rubySpansFor(token, view), token, view);
}

/**
 * Every exposure key a SHOWN-with-ruby occurrence of this token should
 * accrue against, given the spans it was actually rendered with: the word
 * itself (what stories-plan.md §6.1's hiding rule reads) and one per kanji
 * ruby position, keyed exactly like the vocab quiz's own (kanji, reading)
 * keys (§6.2) — so a story is a second way the very same reading earns its
 * hidden default in the quiz, and vice versa.
 *
 * Katakana spans contribute the word key and nothing else. The per-character
 * kanji keys are shared with the vocab quiz by design; writing per-character
 * katakana keys would instead feed the kana SRS from reading, which is a
 * different and much stronger claim than anybody asked for.
 *
 * Empty for a token that was rendered with no ruby at all — no kanji, no
 * unknown katakana, or a jukujikun-shaped token with `ruby: null`.
 */
export function exposureTargetsForToken(token, spans) {
  if (!spans || !spans.length) return [];
  const targets = [exposureWordKey(token.s)];
  spans.forEach((span) => {
    if (span.kind === 'kanji') targets.push(exposureKanjiKey(span.base, span.text));
  });
  return targets;
}

/**
 * One token's starting (reveal-level 0) render — stories-plan.md §5's stages
 * collapsed into one decision per token:
 *
 *   text: the string on screen right now (written form or kana form)
 *   spans: every ruby annotation over it — kanji, katakana, or both. The
 *          caller decides whether to actually paint them from `hidden` below
 *   annotated: whether there is any ruby at all, i.e. anything to hide
 *   hidden: whether that ruby is hidden by default (§6.1) — meaningless when
 *           `annotated` is false, since there is nothing to hide
 *   tappable: false only for punctuation
 *   maxLevel: how many taps the reveal ladder has — 0 for punctuation, 1 for
 *             a token with nothing to protect (no ruby, or ruby already
 *             showing), 2 for a hidden annotated token (tap once for the
 *             furigana, again for romaji)
 */
function renderToken(token, view) {
  if (token.pos === 'punct') {
    return {
      text: token.s, spans: [], annotated: false, hidden: false, tappable: false, maxLevel: 0,
    };
  }
  const text = renderedText(token, view);
  const spans = rubySpansFor(token, view);
  if (!spans.length) {
    return {
      text, spans, annotated: false, hidden: false, tappable: true, maxLevel: 1,
    };
  }
  const hidden = spansHidden(spans, token, view);
  return {
    text, spans, annotated: true, hidden, tappable: true, maxLevel: hidden ? 2 : 1,
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
 * spacing (only at stage 'kana', per §5.4) can be decided from neighbouring
 * tokens rather than one token in isolation. Returns one descriptor per
 * token, each carrying everything renderToken produces plus `spaceBefore`
 * and the token's own index for the caller to key reveal state and DOM
 * nodes by.
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
 * level 1 shows the ruby (if it was hidden) or romaji (if it wasn't — a
 * known word, or a token with no ruby), level 2 (annotated, was hidden)
 * shows romaji on top of the now-visible ruby. Pure — the caller (app.js)
 * owns the actual DOM patch and the exposure/demotion bookkeeping that a
 * transition from 0 recording an exposure implies (§6.3).
 */
export function tokenAtLevel(rendered, level) {
  const clamped = Math.max(0, Math.min(level, rendered.maxLevel));
  if (!rendered.annotated) {
    return {
      text: rendered.text, showRuby: false, spans: [], showRomaji: clamped >= 1,
    };
  }
  const showRuby = !rendered.hidden || clamped >= 1;
  const romajiLevel = rendered.hidden ? 2 : 1;
  return {
    text: rendered.text,
    showRuby,
    spans: showRuby ? rendered.spans : [],
    showRomaji: clamped >= romajiLevel,
  };
}

/**
 * How many times each annotatable word has already appeared EARLIER in this
 * story, per token position — `"<p>:<s>:<i>" -> 0-based occurrence index`.
 * Pure, computed once when a story opens.
 *
 * This is what lets a story stop handing over furigana for a word it has
 * already shown several times *in the text the learner is reading right
 * now* (stories-plan.md §6.3). It is deliberately separate from the
 * profile-wide `exposure` counter and answers a different question:
 *
 * - `exposure` asks "how many separate occasions have you met this word?"
 *   and is capped at one per episode, because meeting 鬼 eight times in one
 *   sitting is one encounter with 鬼, not eight — and because its timestamps
 *   have to survive a sync merge that collapses same-minute events.
 * - This asks "how many times have you already been shown this word ON THIS
 *   PAGE?", where eight really does mean eight. By the fourth printing of 鬼
 *   in the same story, the reading is on screen three times over just above,
 *   and reprinting it a fourth time teaches nothing.
 *
 * Keyed by the token's own surface, so 鬼 and 鬼が島's 島 count separately,
 * and an inflected form counts separately from its dictionary form — the
 * question is about the exact string on the page, not about the lemma.
 *
 * A token counts as annotatable if it carries authored kanji ruby OR any
 * katakana at all, judged on the surface rather than per learner: the index
 * is computed once per story and must not shift when the view does.
 */
export function storyOccurrenceIndex(body) {
  const seen = new Map();
  const index = new Map();
  body.forEach((para, p) => {
    para.forEach((sentence, s) => {
      sentence.t.forEach((token, i) => {
        if (!token.ruby && !KATAKANA_RE.test(token.s) && !KATAKANA_RE.test(token.k)) return;
        const n = seen.get(token.s) || 0;
        index.set(`${p}:${s}:${i}`, n);
        seen.set(token.s, n + 1);
      });
    });
  });
  return index;
}
