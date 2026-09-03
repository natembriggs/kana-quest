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
  storyOccurrenceIndex,
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
    stage: 'hira',
    windowActive: false,
    inWindow: () => false,
    isKanjiKnown: () => false,
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

// --- Stage 'hira': toHiragana(k) everywhere, except the §5.6 katakana ------
// --- loanword fallback, and particles/aux/punct join the previous token ---

const catToken = { s: '猫', k: 'ねこ', ruby: [[0, 'ねこ']], pos: 'n' };
const topicPart = { s: 'は', k: 'は', ruby: null, pos: 'part' };
const coffeeLoanword = { s: 'コーヒー', k: 'コーヒー', ruby: null, pos: 'n' };
const subjPart = { s: 'が', k: 'が', ruby: null, pos: 'part' };
const likeAdj = { s: '好き', k: 'すき', ruby: [[0, 'す']], pos: 'adj' };
const copulaAux = { s: 'です', k: 'です', ruby: null, pos: 'aux' };
const period = { s: '。', k: '。', ruby: null, pos: 'punct' };

const hiraTokens = [catToken, topicPart, coffeeLoanword, subjPart, likeAdj, copulaAux, period];
const hiraRendered = renderSentence(hiraTokens, baseView({ stage: 'hira' }));

check('stage hira: every token renders in kana form',
  hiraRendered.every((r) => r.form === 'kana'));
check('stage hira: a kanji-bearing word has no kanji in its rendered text',
  !KANJI_RE.test(hiraRendered[0].text) && !KANJI_RE.test(hiraRendered[4].text),
  JSON.stringify([hiraRendered[0].text, hiraRendered[4].text]));
check('stage hira: a katakana loanword stays katakana (§5.6 fallback), not こーひー',
  hiraRendered[2].text === 'コーヒー', hiraRendered[2].text);
check('stage hira: every other token has no katakana at all',
  hiraRendered.filter((_, i) => i !== 2).every((r) => !KATAKANA_RE.test(r.text)),
  JSON.stringify(hiraRendered.map((r) => r.text)));

const hiraJoined = hiraRendered.map((r) => (r.spaceBefore ? ' ' : '') + r.text).join('');
check('stage hira: particles join their host with no space (むかしむかし-book style)',
  hiraJoined.includes('ねこは') && !hiraJoined.includes('ねこ は')
  && hiraJoined.includes('コーヒーが') && !hiraJoined.includes('コーヒー が')
  && hiraJoined.includes('すきです') && !hiraJoined.includes('すき です'),
  hiraJoined);
check('stage hira: punctuation attaches to what precedes it with no space',
  hiraJoined.endsWith('です。') && !hiraJoined.endsWith('です 。'), hiraJoined);

// The doc's own worked example (§5.2): おじいさんは, not おじいさん は.
const grandpaTokens = [
  { s: 'おじいさん', k: 'おじいさん', ruby: null, pos: 'n' },
  { s: 'は', k: 'は', ruby: null, pos: 'part' },
];
const grandpaRendered = renderSentence(grandpaTokens, baseView({ stage: 'hira' }));
const grandpaJoined = grandpaRendered.map((r) => (r.spaceBefore ? ' ' : '') + r.text).join('');
check('the particle-joining rule produces おじいさんは, not おじいさん は',
  grandpaJoined === 'おじいさんは', grandpaJoined);

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
  });
}

const straddling = renderSentence([denshaToken], windowView(new Set(['電'])))[0];
check('a word straddling the window edge renders wholly in kana (でんしゃ), never 電しゃ',
  straddling.form === 'kana' && straddling.text === 'でんしゃ', JSON.stringify(straddling));

const wholeInWindow = renderSentence([hanabiToken], windowView(new Set(['花', '火'])))[0];
check('a word with every kanji inside the window renders in kanji',
  wholeInWindow.form === 'kanji' && wholeInWindow.text === '花火', JSON.stringify(wholeInWindow));

const studiedOutside = renderSentence(
  [denshaToken],
  windowView(new Set(['電']), new Set(['車'])),
)[0];
check('a studied kanji outside the window still renders as kanji (never taken away)',
  studiedOutside.form === 'kanji' && studiedOutside.text === '電車', JSON.stringify(studiedOutside));

const windowInactive = baseView({
  stage: 'kanji', windowActive: false, inWindow: () => false, isKanjiKnown: () => false,
});
const beyondWindow = renderSentence([denshaToken], windowInactive)[0];
check('once the window is gone (frontier grade 4+), every kanji renders regardless of inWindow',
  beyondWindow.form === 'kanji' && beyondWindow.text === '電車', JSON.stringify(beyondWindow));

const kanaOnlyAtKanjiStage = renderSentence([catTokenNoRuby], windowInactive)[0];
check('a word with no kanji stays in kana form even at stage kanji',
  kanaOnlyAtKanjiStage.form === 'kana' && kanaOnlyAtKanjiStage.text === 'ねこ',
  JSON.stringify(kanaOnlyAtKanjiStage));

// Spacing stops at stage 'kanji' (§5.4) — checked here since the window
// tests already have kanji-stage tokens on hand.
const kanjiStageSpaced = renderSentence([hanabiToken, topicPart], windowView(new Set(['花', '火'])));
check('spacing stops entirely at stage kanji',
  kanjiStageSpaced.every((r) => r.spaceBefore === false), JSON.stringify(kanjiStageSpaced));

// --- isTokenFuriganaHidden: the four-way OR (§6.1) --------------------------

const denshaWordKey = exposureWordKey('電車');

check('no claim at all: furigana shows (not hidden) — the default a new kanji gets',
  !isTokenFuriganaHidden(denshaToken, baseView()));

check('every kanji known (studied): furigana is hidden',
  isTokenFuriganaHidden(denshaToken, baseView({ isKanjiKnown: () => true })));

check('only SOME kanji known: furigana still shows — the OR is over the whole word',
  !isTokenFuriganaHidden(denshaToken, baseView({ isKanjiKnown: (ch) => ch === '電' })));

const promotedExposure = {};
[1_000, 2_000, 3_000, 4_000].forEach((t) => addExposure(promotedExposure, denshaWordKey, t));
check('exposure-promoted (seen 4 times with ruby showing): furigana is hidden',
  isTokenFuriganaHidden(denshaToken, baseView({ exposure: promotedExposure })));

const mutedMap = {};
muteFuriganaKey(mutedMap, denshaWordKey, 5_000);
check('muted by hand: furigana is hidden',
  isTokenFuriganaHidden(denshaToken, baseView({ muted: mutedMap })));

check('no kanji at all (ruby is null): nothing to hide, reported as not hidden',
  !isTokenFuriganaHidden(catTokenNoRuby, baseView({ isKanjiKnown: () => true, exposure: promotedExposure, muted: mutedMap })));

// --- exposureTargetsForToken (§6.2): the word key AND one per ruby position ---

check('a token with no ruby has no exposure targets',
  exposureTargetsForToken(catTokenNoRuby).length === 0);

const denshaTargets = exposureTargetsForToken(denshaToken);
check('a two-kanji word writes the word key plus one key per ruby position',
  JSON.stringify(denshaTargets) === JSON.stringify([
    exposureWordKey('電車'),
    exposureKanjiKey('電', 'でん'),
    exposureKanjiKey('車', 'しゃ'),
  ]),
  JSON.stringify(denshaTargets));

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
  kanaFormRendered.form === 'kana' && kanaFormRendered.maxLevel === 1, JSON.stringify(kanaFormRendered));
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
