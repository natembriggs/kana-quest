// Direct unit tests for src/reader.js's pure rendering functions (no DOM —
// see stories-plan.md §5.7/§10, review-followups.md item 13). Run the same
// way as the other suites:
//
//   /System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc \
//       -m test/reader.js
//
// Must be run from the repo root.

load('vendor/wanakana.min.js');
globalThis.window = { wanakana: globalThis.wanakana };

const {
  tokenHasKanji, exposureTargetsForToken, isTokenFuriganaHidden, renderSentence, tokenAtLevel,
  storyOccurrenceIndex, rubySpansFor,
} = await import('../src/reader.js');
const {
  exposureWordKey, exposureKanjiKey, addExposure, muteFuriganaKey,
} = await import('../src/srs.js');

let failures = 0;
function check(name, condition, detail) {
  if (condition) { print(`ok    ${name}`); return; }
  failures += 1;
  print(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
}

const KANJI_RE = /[㐀-䶿一-鿿]/;
const KATAKANA_RE = /[ァ-ヺー]/;

// A view with no claim on anything and no window restriction — the default,
// "furigana shows, nothing is hidden" case most tokens hit.
function baseView(overrides = {}) {
  return {
    stage: 'kana',
    windowActive: false,
    inWindow: () => false,
    isKanjiKnown: () => false,
    isKatakanaRunKnown: () => false,
    exposure: {},
    muted: {},
    ...overrides,
  };
}

// --- tokenHasKanji (trivial, but the plan names it explicitly) -------------

check('tokenHasKanji is true for a token whose surface has a kanji',
  tokenHasKanji({ s: '電車' }));
check('tokenHasKanji is false for a pure-kana surface',
  !tokenHasKanji({ s: 'ねこ' }));
check('tokenHasKanji is false for punctuation',
  !tokenHasKanji({ s: '。' }));

// --- Stage 'kana': native kana orthography, spaced, particles joined ------
// --- and katakana annotated with derived hiragana (§5.6) ------------------

const catToken = { s: '猫', k: 'ねこ', ruby: [[0, 'ねこ']], pos: 'n' };
const topicPart = { s: 'は', k: 'は', ruby: null, pos: 'part' };
const coffeeLoanword = { s: 'コーヒー', k: 'コーヒー', ruby: null, pos: 'n' };
const subjPart = { s: 'が', k: 'が', ruby: null, pos: 'part' };
const likeAdj = { s: '好き', k: 'すき', ruby: [[0, 'す']], pos: 'adj' };
const copulaAux = { s: 'です', k: 'です', ruby: null, pos: 'aux' };
const period = { s: '。', k: '。', ruby: null, pos: 'punct' };

const kanaTokens = [catToken, topicPart, coffeeLoanword, subjPart, likeAdj, copulaAux, period];
const kanaRendered = renderSentence(kanaTokens, baseView());

check('stage kana: a kanji-bearing word has no kanji in its rendered text',
  !KANJI_RE.test(kanaRendered[0].text) && !KANJI_RE.test(kanaRendered[4].text),
  JSON.stringify([kanaRendered[0].text, kanaRendered[4].text]));
check('stage kana: a kanji-bearing word shown in kana carries no ruby of its own',
  !kanaRendered[0].annotated && !kanaRendered[4].annotated);
check('stage kana: a katakana loanword stays katakana, never transliterated away',
  kanaRendered[2].text === 'コーヒー', kanaRendered[2].text);
check('stage kana: every other token has no katakana at all',
  kanaRendered.filter((_, i) => i !== 2).every((r) => !KATAKANA_RE.test(r.text)),
  JSON.stringify(kanaRendered.map((r) => r.text)));

const kanaJoined = kanaRendered.map((r) => (r.spaceBefore ? ' ' : '') + r.text).join('');
check('stage kana: particles join their host with no space (むかしむかし-book style)',
  kanaJoined.includes('ねこは') && !kanaJoined.includes('ねこ は')
  && kanaJoined.includes('コーヒーが') && !kanaJoined.includes('コーヒー が')
  && kanaJoined.includes('すきです') && !kanaJoined.includes('すき です'),
  kanaJoined);
check('stage kana: punctuation attaches to what precedes it with no space',
  kanaJoined.endsWith('です。') && !kanaJoined.endsWith('です 。'), kanaJoined);

// The doc's own worked example (§5.2): おじいさんは, not おじいさん は.
const grandpaTokens = [
  { s: 'おじいさん', k: 'おじいさん', ruby: null, pos: 'n' },
  { s: 'は', k: 'は', ruby: null, pos: 'part' },
];
const grandpaRendered = renderSentence(grandpaTokens, baseView());
const grandpaJoined = grandpaRendered.map((r) => (r.spaceBefore ? ' ' : '') + r.text).join('');
check('the particle-joining rule produces おじいさんは, not おじいさん は',
  grandpaJoined === 'おじいさんは', grandpaJoined);

// --- Katakana ruby (§5.6): derived, hiragana, ー kept ----------------------

const coffeeUnknown = renderSentence([coffeeLoanword], baseView())[0];
check('an unknown katakana word is annotated, and the katakana itself stays on screen',
  coffeeUnknown.annotated && coffeeUnknown.text === 'コーヒー', JSON.stringify(coffeeUnknown));
check('its ruby is mora-for-mora hiragana keeping ー — こーひー, never こうひい',
  coffeeUnknown.spans.length === 1 && coffeeUnknown.spans[0].text === 'こーひー',
  JSON.stringify(coffeeUnknown.spans));
check('the katakana span covers the WHOLE run, not one character at a time',
  coffeeUnknown.spans[0].start === 0 && coffeeUnknown.spans[0].len === 4,
  JSON.stringify(coffeeUnknown.spans[0]));

const coffeeKnown = renderSentence([coffeeLoanword], baseView({ isKatakanaRunKnown: () => true }))[0];
check('a katakana word whose characters are known hides its ruby, exactly as a known kanji does',
  coffeeKnown.hidden === true && coffeeKnown.text === 'コーヒー',
  JSON.stringify(coffeeKnown));
check('...and keeps a two-tap ladder, so a learner who blanks can still ask for the reading',
  coffeeKnown.maxLevel === 2 && tokenAtLevel(coffeeKnown, 0).spans.length === 0
  && tokenAtLevel(coffeeKnown, 1).spans.length === 1,
  JSON.stringify(tokenAtLevel(coffeeKnown, 1)));

// The case that was broken before this rule existed: a learner who studied
// kanji long before katakana got furigana on every kanji and nothing at all
// over ウサギ.
const whiteRabbit = { s: '白ウサギ', k: 'しろウサギ', ruby: [[0, 'しろ']], pos: 'pn' };
const mixedView = baseView({ stage: 'kanji', windowActive: false });
const mixedRendered = renderSentence([whiteRabbit], mixedView)[0];
check('a mixed kanji+katakana word annotates both halves, in position order',
  mixedRendered.text === '白ウサギ'
  && JSON.stringify(mixedRendered.spans.map((sp) => [sp.start, sp.len, sp.text, sp.kind]))
    === JSON.stringify([[0, 1, 'しろ', 'kanji'], [1, 3, 'うさぎ', 'katakana']]),
  JSON.stringify(mixedRendered.spans));
check('the whole word is one visibility decision: unknown katakana keeps the kanji ruby showing',
  mixedRendered.hidden === false);
check('knowing only the kanji is not enough to hide a mixed word\'s ruby',
  !renderSentence([whiteRabbit], baseView({
    stage: 'kanji', isKanjiKnown: () => true, isKatakanaRunKnown: () => false,
  }))[0].hidden);
check('knowing both halves hides the whole word\'s ruby together',
  renderSentence([whiteRabbit], baseView({
    stage: 'kanji', isKanjiKnown: () => true, isKatakanaRunKnown: () => true,
  }))[0].hidden);

// ー and ・ extend a run without starting one; a run is found in the text
// that is actually on screen, not in the surface.
const longJohn = { s: 'ロング・ジョン', k: 'ロング・ジョン', ruby: null, pos: 'pn' };
const longJohnSpans = rubySpansFor(longJohn, baseView());
check('a ・ inside a foreign name keeps it one run rather than splitting the ruby',
  longJohnSpans.length === 1 && longJohnSpans[0].text === 'ろんぐ・じょん',
  JSON.stringify(longJohnSpans));

const glassBox = { s: 'ガラス箱', k: 'ガラスばこ', ruby: [[3, 'ばこ']], pos: 'n' };
const glassInKana = renderSentence([glassBox], baseView({
  stage: 'kanji', windowActive: true, inWindow: () => false,
}))[0];
check('a word pushed into kana form by the window is still annotated over its katakana',
  glassInKana.text === 'ガラスばこ'
  && glassInKana.spans.length === 1
  && glassInKana.spans[0].kind === 'katakana'
  && glassInKana.spans[0].text === 'がらす',
  JSON.stringify(glassInKana));

// --- Stage 'kanji', the frontier window (§5.4) — per WORD, not per char ----

const denshaToken = { s: '電車', k: 'でんしゃ', ruby: [[0, 'でん'], [1, 'しゃ']], pos: 'n' };
const hanabiToken = { s: '花火', k: 'はなび', ruby: [[0, 'はな'], [1, 'び']], pos: 'n' };
const catTokenNoRuby = { s: 'ねこ', k: 'ねこ', ruby: null, pos: 'n' };

function windowView(inSet, knownSet = new Set()) {
  return baseView({
    stage: 'kanji',
    windowActive: true,
    inWindow: (ch) => inSet.has(ch),
    isKanjiKnown: (ch) => knownSet.has(ch),
    // Every katakana known, so the window tests below are about kanji alone
    // and a stray katakana run cannot annotate a token out from under them.
    isKatakanaRunKnown: () => true,
  });
}

const straddling = renderSentence([denshaToken], windowView(new Set(['電'])))[0];
check('a word straddling the window edge renders wholly in kana (でんしゃ), never 電しゃ',
  !straddling.annotated && straddling.text === 'でんしゃ', JSON.stringify(straddling));

const wholeInWindow = renderSentence([hanabiToken], windowView(new Set(['花', '火'])))[0];
check('a word with every kanji inside the window renders in kanji',
  wholeInWindow.annotated && wholeInWindow.text === '花火', JSON.stringify(wholeInWindow));

const studiedOutside = renderSentence(
  [denshaToken],
  windowView(new Set(['電']), new Set(['車'])),
)[0];
check('a studied kanji outside the window still renders as kanji (never taken away)',
  studiedOutside.annotated && studiedOutside.text === '電車', JSON.stringify(studiedOutside));

const windowInactive = baseView({
  stage: 'kanji',
  windowActive: false,
  inWindow: () => false,
  isKanjiKnown: () => false,
  isKatakanaRunKnown: () => true,
});
const beyondWindow = renderSentence([denshaToken], windowInactive)[0];
check('once the window is gone (frontier grade 4+), every kanji renders regardless of inWindow',
  beyondWindow.annotated && beyondWindow.text === '電車', JSON.stringify(beyondWindow));

const kanaOnlyAtKanjiStage = renderSentence([catTokenNoRuby], windowInactive)[0];
check('a word with no kanji stays in kana form even at stage kanji',
  !kanaOnlyAtKanjiStage.annotated && kanaOnlyAtKanjiStage.text === 'ねこ',
  JSON.stringify(kanaOnlyAtKanjiStage));

// Spacing stops at stage 'kanji' (§5.4) — checked here since the window
// tests already have kanji-stage tokens on hand.
const kanjiStageSpaced = renderSentence([hanabiToken, topicPart], windowView(new Set(['花', '火'])));
check('spacing stops entirely at stage kanji',
  kanjiStageSpaced.every((r) => r.spaceBefore === false), JSON.stringify(kanjiStageSpaced));

// --- isTokenFuriganaHidden: the four-way OR (§6.1) --------------------------

// At stage 'kana' a kanji word renders in kana and has nothing to hide, so
// every case below is asked at stage 'kanji', where the kanji is on screen.
function hidingView(overrides = {}) {
  return baseView({ stage: 'kanji', ...overrides });
}

const denshaWordKey = exposureWordKey('電車');

check('no claim at all: furigana shows (not hidden) — the default a new kanji gets',
  !isTokenFuriganaHidden(denshaToken, hidingView()));

check('every kanji known (studied): furigana is hidden',
  isTokenFuriganaHidden(denshaToken, hidingView({ isKanjiKnown: () => true })));

check('only SOME kanji known: furigana still shows — the OR is over the whole word',
  !isTokenFuriganaHidden(denshaToken, hidingView({ isKanjiKnown: (ch) => ch === '電' })));

const promotedExposure = {};
[1_000, 2_000, 3_000, 4_000].forEach((t) => addExposure(promotedExposure, denshaWordKey, t));
check('exposure-promoted (seen 4 times with ruby showing): furigana is hidden',
  isTokenFuriganaHidden(denshaToken, hidingView({ exposure: promotedExposure })));

const mutedMap = {};
muteFuriganaKey(mutedMap, denshaWordKey, 5_000);
check('muted by hand: furigana is hidden',
  isTokenFuriganaHidden(denshaToken, hidingView({ muted: mutedMap })));

check('no ruby of any kind: nothing to hide, reported as not hidden',
  !isTokenFuriganaHidden(catTokenNoRuby, hidingView({
    isKanjiKnown: () => true, exposure: promotedExposure, muted: mutedMap,
  })));

// The same three rules reach katakana unchanged, because a katakana word is
// judged by the very same whole-word exposure key.
const coffeeWordKey = exposureWordKey('コーヒー');
const coffeePromoted = {};
[1_000, 2_000, 3_000, 4_000].forEach((t) => addExposure(coffeePromoted, coffeeWordKey, t));
check('a katakana word seen four times with its ruby showing earns its hidden default',
  isTokenFuriganaHidden(coffeeLoanword, baseView({ exposure: coffeePromoted })));
const coffeeMuted = {};
muteFuriganaKey(coffeeMuted, coffeeWordKey, 5_000);
check('a katakana word can be muted by hand like any other',
  isTokenFuriganaHidden(coffeeLoanword, baseView({ muted: coffeeMuted })));

// --- exposureTargetsForToken (§6.2): the word key AND one per ruby position ---

const kanjiStageView = baseView({ stage: 'kanji' });
check('a token rendered with no ruby has no exposure targets',
  exposureTargetsForToken(catTokenNoRuby, rubySpansFor(catTokenNoRuby, kanjiStageView)).length === 0);

const denshaTargets = exposureTargetsForToken(denshaToken, rubySpansFor(denshaToken, kanjiStageView));
check('a two-kanji word writes the word key plus one key per ruby position',
  JSON.stringify(denshaTargets) === JSON.stringify([
    exposureWordKey('電車'),
    exposureKanjiKey('電', 'でん'),
    exposureKanjiKey('車', 'しゃ'),
  ]),
  JSON.stringify(denshaTargets));

// A katakana run earns the WORD key and nothing per-character: the per-kanji
// keys are shared with the vocab quiz by design, but feeding the kana SRS
// from reading would be a much stronger claim than anybody asked for.
const coffeeTargets = exposureTargetsForToken(coffeeLoanword, rubySpansFor(coffeeLoanword, baseView()));
check('a katakana word writes only its word key, never per-character kana keys',
  JSON.stringify(coffeeTargets) === JSON.stringify([exposureWordKey('コーヒー')]),
  JSON.stringify(coffeeTargets));

const mixedTargets = exposureTargetsForToken(whiteRabbit, rubySpansFor(whiteRabbit, hidingView()));
check('a mixed word writes its word key and its kanji key, and nothing for the katakana',
  JSON.stringify(mixedTargets) === JSON.stringify([
    exposureWordKey('白ウサギ'), exposureKanjiKey('白', 'しろ'),
  ]),
  JSON.stringify(mixedTargets));

// --- tokenAtLevel: the reveal ladder (0 -> furigana -> romaji) -------------

const shownView = baseView({ stage: 'kanji', windowActive: false });
const shownRendered = renderSentence([denshaToken], shownView)[0];
check('an un-hidden kanji token already shows ruby at level 0',
  shownRendered.hidden === false && shownRendered.maxLevel === 1, JSON.stringify(shownRendered));
const shownLevel0 = tokenAtLevel(shownRendered, 0);
check('level 0 on an un-hidden token: ruby shown, no romaji yet',
  shownLevel0.showRuby === true && shownLevel0.showRomaji === false, JSON.stringify(shownLevel0));
const shownLevel1 = tokenAtLevel(shownRendered, 1);
check('level 1 on an un-hidden token: romaji now shown too',
  shownLevel1.showRuby === true && shownLevel1.showRomaji === true, JSON.stringify(shownLevel1));

const hiddenView = baseView({ stage: 'kanji', windowActive: false, isKanjiKnown: () => true });
const hiddenRendered = renderSentence([denshaToken], hiddenView)[0];
check('a hidden kanji token has a two-tap ladder',
  hiddenRendered.hidden === true && hiddenRendered.maxLevel === 2, JSON.stringify(hiddenRendered));
const hiddenLevel0 = tokenAtLevel(hiddenRendered, 0);
check('level 0 on a hidden token: no ruby, no romaji',
  hiddenLevel0.showRuby === false && hiddenLevel0.showRomaji === false, JSON.stringify(hiddenLevel0));
const hiddenLevel1 = tokenAtLevel(hiddenRendered, 1);
check('level 1 on a hidden token: tap one reveals furigana, not romaji yet',
  hiddenLevel1.showRuby === true && hiddenLevel1.showRomaji === false, JSON.stringify(hiddenLevel1));
const hiddenLevel2 = tokenAtLevel(hiddenRendered, 2);
check('level 2 on a hidden token: tap two adds romaji on top of the now-visible furigana',
  hiddenLevel2.showRuby === true && hiddenLevel2.showRomaji === true, JSON.stringify(hiddenLevel2));
const hiddenLevelClamped = tokenAtLevel(hiddenRendered, 99);
check('a level past maxLevel clamps rather than throwing or overflowing state',
  hiddenLevelClamped.showRuby === true && hiddenLevelClamped.showRomaji === true);

const kanaFormRendered = renderSentence([denshaToken], windowView(new Set(['電'])))[0]; // straddles -> kana form
check('a kana-form token has a one-tap ladder (romaji only)',
  !kanaFormRendered.annotated && kanaFormRendered.maxLevel === 1, JSON.stringify(kanaFormRendered));
const kanaLevel0 = tokenAtLevel(kanaFormRendered, 0);
check('level 0 on a kana-form token: no romaji yet',
  kanaLevel0.showRuby === false && kanaLevel0.showRomaji === false);
const kanaLevel1 = tokenAtLevel(kanaFormRendered, 1);
check('level 1 on a kana-form token: romaji shown',
  kanaLevel1.showRuby === false && kanaLevel1.showRomaji === true);

// --- storyOccurrenceIndex: counts per-page repeats, keyed by surface -------

const oniA = { s: '鬼', k: 'おに', ruby: [[0, 'おに']], pos: 'n' };
const oniB = { s: '鬼', k: 'おに', ruby: [[0, 'おに']], pos: 'n' };
const noRubyToken = { s: 'は', k: 'は', ruby: null, pos: 'part' };
const islandToken = { s: '島', k: 'しま', ruby: [[0, 'しま']], pos: 'n' };

const body = [
  [ // paragraph 0
    { t: [oniA, noRubyToken] }, // sentence 0
    { t: [oniB] }, // sentence 1
  ],
  [ // paragraph 1
    { t: [islandToken, oniA] }, // sentence 0
  ],
];
const occ = storyOccurrenceIndex(body);
check('the first showing of a word is occurrence 0',
  occ.get('0:0:0') === 0, JSON.stringify([...occ]));
check('a token with no ruby is never tracked (nothing to count exposures for)',
  !occ.has('0:0:1'));
check('the same word later in the story increments, even across sentences',
  occ.get('0:1:0') === 1);
check('a different word starts its own count at 0',
  occ.get('1:0:0') === 0);
check('counting continues across paragraphs',
  occ.get('1:0:1') === 2);

print('');
if (failures) throw new Error(`${failures} failure(s)`);
print('all reader tests passed');
