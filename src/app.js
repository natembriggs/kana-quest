// Screen routing, session flow and event wiring.

import {
  COURSES, romajiFor, writingPromptFor, buildChoices,
} from './kana.js';
import {
  KANJI_COURSES, kanjiInfo, readingExample, meaningLabel, formatReading,
  buildKanjiOptions, buildAdvancedAdditions, buildDefinitionChoices, recomputeKanjiRollup,
  ensureKanjiUnitLoaded, kanjiUnitFor, areAllKanjiUnitsLoaded, unitLabel,
} from './kanji.js';
import {
  VOCAB_COURSES, VOCAB_ALL_COURSES, vocabCoursesFor,
  vocabInfo, wordHasKanji, unitLabel as vocabUnitLabel, unitGroupLabel as vocabUnitGroupLabel,
  unitLevelLabel as vocabUnitLevelLabel, unitBadge as vocabUnitBadge,
  ensureVocabUnitLoaded, vocabUnitFor, vocabIdForWord, buildMeaningChoices, buildYomiChoices,
  ensureExampleWordsLoaded, exampleWordInfo,
  wordMeaningLabel, wordGlossSummary,
  partialFuriganaIsAskable, pronunciationFor,
  buildRecallChoices, recallHasSpellingStage, buildSpellingChoices,
} from './vocab.js';
import {
  MODES, modesForKind, modeName, modeHint, defaultModeForKind, isModeComingSoon,
  itemKey, yomiKey, grade, gradeYomi, buildSession, courseStats,
  currentSetIndex, readyForMore, newRecord, newYomiRecord, masteryTier, autoWritingMode,
  deriveStudyList, isLegacyStudyShape, migrateStudyShape, enrollNext, newItems, introducedItems,
  isStudying, setStudying, studiedKanji, neverSeenItems, studyModes, isKanjiChar,
  recomputeVocabRollup, VOCAB_SUBKEYS,
  exposureKanjiKey, exposureWordKey, exposureCount, isExposurePromoted, EXPOSURE_THRESHOLD,
  addExposure, recordDemotionStrike, recomputeYomiRollupFromProgress,
  isFuriganaMuted, muteFuriganaKey,
} from './srs.js';
import {
  renderSentence, tokenAtLevel, exposureTargetsForToken, isTokenFuriganaHidden, tokenHasKanji,
  storyOccurrenceIndex,
} from './reader.js';
import { STORIES } from './data/story-manifest.js';
import { buildStrokeSVG, animateStrokes, ensureStrokeUnitLoaded } from './strokes.js';
import {
  createWritingAttempt, createFreeAttempt, setupCanvas, clearCanvas, redrawInk, toModelSpace,
  renderGuide, markGuideStrokeDone, markGuideStrokeReview, setGuidePeekFull, setStrokePeek,
} from './writing.js';
import { STRICTNESS_LEVELS, DEFAULT_STRICTNESS } from './stroke-grader.js';
import { CHANGELOG } from './changelog.js';
import * as store from './store.js';
import { syncProfile } from './sync-protocol.js';
import {
  transport, generateCode, normalizeCode, formatCode, deriveKeys, encryptProfile, decryptProfile,
} from './sync-transport.js';

// Search matches a typed reading against romaji regardless of which script
// it (or the query) is written in — see renderKanjiSearchResults() below.
const { toRomaji } = window.wanakana;

export const APP_VERSION = '2026-09-01h'; // keep in step with VERSION in sw.js
const CACHE_PREFIX = 'kana-quest-';

const ALL_COURSES = [...COURSES, ...KANJI_COURSES, ...VOCAB_ALL_COURSES];

/**
 * A merged index spanning every grade's kanji — needed whenever something
 * can span more than one grade at once (the "everything I'm studying" review
 * scope below, and kanji search, which by definition doesn't know which
 * grade to look in), since each grade's own course.index covers just its own
 * kanji. Kyoiku/jōyō kanji never repeat across grades, so a plain union is
 * exact.
 *
 * Rebuilt fresh on every call rather than cached: each course's `.index` now
 * fills in lazily, grade by grade (see kanji-expansion-plan.md §4), so a
 * cached snapshot taken before every grade had loaded would go stale as more
 * load in behind it. The union itself is cheap — at most ~2,100 Map inserts
 * over data already sitting in memory — so there is nothing worth caching.
 */
function allKanjiIndex() {
  const merged = new Map();
  KANJI_COURSES.forEach((course) => {
    course.index.forEach((info, kanji) => merged.set(kanji, info));
  });
  return merged;
}

/** Which grade's own course a kanji belongs to — needed to open the detail
 * screen on it (openCharacterDetail wants a real course, not the merged
 * index), since search results can't assume the currently-selected grade.
 * Resolved from the manifest (kanjiUnitFor), not course.index, so this works
 * even before that grade's real data has ever been loaded. */
function kanjiCourseFor(char) {
  const unit = kanjiUnitFor(char);
  return unit ? getAnyCourse(`kanji-grade-${unit}`) : undefined;
}

const STUDY_LIST_POOL_ID = 'study-list';

/**
 * A synthetic single-chunk course spanning every kanji enrolled in `mode`,
 * across every grade — see kanji-expansion-plan.md §1.5/§2.4. Rebuilt fresh
 * on every lookup (cheap: one array over an already-small study list) rather
 * than cached, so it can never go stale mid-session the way a cached pool
 * snapshot could. excludeForMode is deliberately empty: a kanji excluded
 * from a mode can never be enrolled in it in the first place — see
 * applicableStudyModes(), which hides that toggle entirely — so nothing
 * reaching this pool needs excluding by mode.
 */
function studyListPool(mode) {
  return {
    id: STUDY_LIST_POOL_ID,
    kind: 'kanji',
    name: "Everything you're studying",
    chunks: [{ items: studiedKanji(state.profile.study, mode) }],
    excludeForMode: {},
    index: allKanjiIndex(),
  };
}

const ALL_KANJI_POOL_ID = 'all-kanji';

/**
 * A synthetic pool spanning EVERY kanji unit's chunks, back to back in the
 * same order the grade picker lists them (KANJI_COURSES is already sorted
 * that way — see compareUnits in kanji.js). This is what "Learn N next"
 * draws from: new kanji are taught in one continuous curriculum order, not
 * reset to the start of whichever unit happens to be selected below, so
 * picking a different grade-picker tile must not change what "next" means.
 * Contrast with studyListPool just above, which is scoped to what's already
 * enrolled — this one is the whole teachable set, unenrolled included, since
 * enrolling the next few is exactly what "Learn next" is for.
 *
 * excludeForMode merges every unit's own exclusion set (see buildKanjiCourse
 * in kanji.js) into one, per mode — a pool spanning several courses can't
 * reuse any single course's Set, which only ever covered its own kanji.
 */
function allKanjiPool() {
  const excludeForMode = {};
  KANJI_COURSES.forEach((course) => {
    Object.entries(course.excludeForMode).forEach(([mode, excluded]) => {
      (excludeForMode[mode] ??= new Set());
      excluded.forEach((kanji) => excludeForMode[mode].add(kanji));
    });
  });
  return {
    id: ALL_KANJI_POOL_ID,
    kind: 'kanji',
    name: 'Kanji',
    chunks: KANJI_COURSES.flatMap((course) => course.chunks),
    excludeForMode,
    index: allKanjiIndex(),
  };
}

/**
 * The vocab twin of allKanjiIndex above. Each unit's `.index` fills in
 * lazily (ensureVocabUnitLoaded), so a pool spanning every unit has to union
 * whatever has loaded so far, rebuilt fresh on every call rather than
 * cached. Word ids are unique across the whole manifest, so a plain union is
 * exact.
 */
/** The vocab course list for the open profile's chosen progression — see
 * `vocabProgression` in store.js's defaultSettings(). Every browse list and
 * every total goes through here; only id lookups use VOCAB_ALL_COURSES. */
function activeVocabCourses() {
  const progression = state.profile ? state.profile.settings.vocabProgression : 'common';
  return vocabCoursesFor(progression);
}

function allVocabIndex() {
  const merged = new Map();
  VOCAB_COURSES.forEach((course) => {
    course.index.forEach((info, id) => merged.set(id, info));
  });
  return merged;
}

const VOCAB_STUDY_POOL_ID = 'vocab-study-list';
const ALL_VOCAB_POOL_ID = 'all-vocab';

/**
 * Vocabulary's twin of studyListPool/allKanjiPool above: what the two
 * quick actions at the top of the course screen draw from, so "Review due"
 * and "Learn next" mean the same unit-agnostic thing for words as they
 * already did for kanji. Words are enrolled into the very same study map
 * kanji use, keyed by word id under a vocab mode ('vmeaning'/'vrecall'), so
 * studiedKanji reads them back unchanged — the vocabUnitFor filter is only
 * there so a key that isn't a taught word (which no current code path can
 * produce) could never reach a session that has nothing to teach for it.
 */
function vocabStudyPool(mode) {
  return {
    id: VOCAB_STUDY_POOL_ID,
    kind: 'vocab',
    name: "Everything you're studying",
    chunks: [{ items: studiedKanji(state.profile.study, mode).filter(vocabUnitFor) }],
    excludeForMode: {},
    index: allVocabIndex(),
  };
}

/**
 * Every vocab unit's chunks back to back in teaching order (Core spine
 * first, then the theme units — VOCAB_COURSES is already sorted that way),
 * which is what "Learn N next" walks: new words are taught in one
 * continuous curriculum order rather than restarting at the top of whichever
 * unit the browser below happens to be showing. excludeForMode is empty
 * because every vocab course's own is (see buildVocabCourse in vocab.js) —
 * no word is unquizzable in a mode it can be enrolled in.
 */
function allVocabPool() {
  return {
    id: ALL_VOCAB_POOL_ID,
    kind: 'vocab',
    name: 'Vocabulary',
    chunks: activeVocabCourses().flatMap((course) => course.chunks),
    excludeForMode: {},
    index: allVocabIndex(),
  };
}

function getAnyCourse(courseId) {
  if (courseId === STUDY_LIST_POOL_ID) return studyListPool(state.mode);
  if (courseId === ALL_KANJI_POOL_ID) return allKanjiPool();
  if (courseId === VOCAB_STUDY_POOL_ID) return vocabStudyPool(state.mode);
  if (courseId === ALL_VOCAB_POOL_ID) return allVocabPool();
  return ALL_COURSES.find((c) => c.id === courseId);
}

// --- Lazy kanji-data loading ------------------------------------------------
// See kanji-expansion-plan.md §4. A grade's real per-kanji data (readings,
// meanings, example words) and stroke data are fetched together, on demand,
// the first time a screen actually needs to show that grade's kanji — course
// stats, the grade picker, and the overview grid all only need the manifest
// (character lists + progress records), so they need none of this.

/** Both halves of one grade's real data, loaded together and memoized —
 * ensureKanjiUnitLoaded/ensureStrokeUnitLoaded (kanji.js/strokes.js) each
 * dedupe their own fetch, so calling this repeatedly for an already-loaded
 * unit is just two resolved-Promise checks. */
async function ensureUnitReady(unit) {
  await Promise.all([ensureKanjiUnitLoaded(unit), ensureStrokeUnitLoaded(unit)]);
}
async function ensureUnitsReady(units) {
  await Promise.all([...units].map(ensureUnitReady));
}

// A small "Loading…" pill (see #data-loading in index.html), shown only if a
// load takes long enough to actually notice — delayed so an already-cached
// grade never flashes it. Depth-counted so overlapping loads (rare, but e.g.
// the study-list pool touching several grades at once) don't hide it early.
let loadingDepth = 0;
let loadingTimer = null;
function beginLoading() {
  loadingDepth += 1;
  if (loadingDepth > 1) return;
  loadingTimer = setTimeout(() => { $('data-loading').hidden = false; }, 200);
}
function endLoading() {
  loadingDepth = Math.max(0, loadingDepth - 1);
  if (loadingDepth > 0) return;
  clearTimeout(loadingTimer);
  $('data-loading').hidden = true;
}
async function withLoading(promise) {
  beginLoading();
  try {
    return await promise;
  } finally {
    endLoading();
  }
}

// The three things a learner picks between on the front page. Kanji fans out
// into one course per school grade; each kana script is a single course.
const SCRIPTS = [
  { id: 'hiragana', kind: 'kana', name: 'Hiragana', native: 'ひらがな', sample: 'あ' },
  { id: 'katakana', kind: 'kana', name: 'Katakana', native: 'カタカナ', sample: 'ア' },
  { id: 'kanji', kind: 'kanji', name: 'Kanji', native: '漢字', sample: '学' },
  { id: 'vocab', kind: 'vocab', name: 'Vocabulary', native: '単語', sample: '語' },
];

// Unit ids ("1".."6", "8-1".."8-6", "9-1".."9-N") in teaching order —
// KANJI_COURSES is already sorted that way (see compareUnits in kanji.js).
const KANJI_UNIT_IDS = KANJI_COURSES.map((c) => c.unit);

// Which group a unit belongs to, and the heading shown above its row in the
// grade picker — checked in this order since '8-'/'9-' are also matched by
// nothing else. Elementary units ("1".."6") have no dash at all.
const KANJI_UNIT_GROUPS = [
  { test: (unit) => unit.startsWith('9-'), label: 'Names & places' },
  { test: (unit) => unit.startsWith('8-'), label: 'Secondary school' },
  { test: (unit) => true, label: 'Primary school grade' },
];
function kanjiUnitGroup(unit) {
  return KANJI_UNIT_GROUPS.find((g) => g.test(unit));
}

const EMOJI_CHOICES = [
  '🌱', '🦊', '🐧', '🐙', '🦉', '🐳', '🍡', '🌸', '⚡️', '🚀', '🐢', '🍄',
  '🐱', '🐶', '🐼', '🦄', '🌈', '🍉', '🎨', '🌟',
];

// Settings > Theme colour. `swatch` is always the LIGHT-mode accent, shown
// for the picker button regardless of which theme is actually active — see
// the matching CSS comment above :root[data-accent] in styles.css for why
// only --accent/--accent-ink move per colour. 'coral' is the default
// (defaultSettings() in store.js, and also what an old profile with no
// accentColor at all falls back to — see applyAccentColor()).
const ACCENT_COLORS = [
  { id: 'coral', name: 'Coral', swatch: '#e8553d' },
  { id: 'blue', name: 'Blue', swatch: '#2f6fed' },
  { id: 'purple', name: 'Purple', swatch: '#8451d6' },
  { id: 'pink', name: 'Pink', swatch: '#e0559a' },
  { id: 'teal', name: 'Teal', swatch: '#12968a' },
  { id: 'amber', name: 'Amber', swatch: '#c9821a' },
  { id: 'green', name: 'Green', swatch: '#2f9e44' },
  { id: 'indigo', name: 'Indigo', swatch: '#4a55d1' },
  { id: 'crimson', name: 'Crimson', swatch: '#d1273f' },
  { id: 'sky', name: 'Sky', swatch: '#0891b2' },
];

/** Applies a learner's chosen accent colour app-wide. Falls back to
 * 'coral' for `undefined` (a profile saved before this setting existed) and
 * for anything unrecognised, rather than leaving data-accent pointing at a
 * colour with no matching CSS rule. */
function applyAccentColor(id) {
  const valid = ACCENT_COLORS.some((c) => c.id === id) ? id : 'coral';
  document.documentElement.dataset.accent = valid;
}

/**
 * Records when a settings field actually changed, so a future sync merge
 * (sync-plan.md §0.2) can tell which of two devices' conflicting choices is
 * newer instead of always favouring whichever device happens to be on the
 * receiving end of a merge. Call this at every place `profile.settings.*` is
 * assigned directly, right before saving.
 */
function stampSetting(profile, key) {
  if (!profile.settingsUpdatedAt) profile.settingsUpdatedAt = {};
  profile.settingsUpdatedAt[key] = Date.now();
}

const MASTERY_LABELS = ['Not started', 'Just started', 'Learning', 'Doing well', 'Well known'];

const state = {
  profile: null,
  scriptId: 'hiragana',
  kanjiUnit: KANJI_UNIT_IDS[0],
  vocabUnit: VOCAB_COURSES[0].unit,
  // "kanji:Secondary school" -> the unit last selected in that group, so
  // switching groups and back returns to where you were rather than to the
  // group's first unit. Session-only on purpose: which grade you last
  // browsed is not worth persisting, and every group has a sane default.
  lastUnitByGroup: {},
  mode: 'recognition',
  session: null,
  // Set overview / character detail — independent of the session state
  // above, since they're read-only browsing, reachable with or without one.
  overviewCourseId: null,
  detailCourseId: null,
  detailChar: null,
  // Detail screens opened on top of one another (drillIntoDetail below):
  // one frame per level, popped one press at a time by 'detail-back'.
  // Reset whenever a detail screen is opened from somewhere that ISN'T
  // another detail screen, so it can never grow without bound across a
  // session's worth of browsing.
  detailStack: [],
  // Stories (stories-plan.md) — all session-only; the only things that
  // outlive one reading sitting are profile.stories/exposure/muted, saved
  // as they happen (see saveReaderPosition, recordReaderExposure).
  readerBrowseLevel: null,  // the level strip's current selection in the library
  readerStoryId: null,
  readerStory: null,        // the loaded STORY record
  readerView: null,         // buildReaderView()'s output for the current profile
  storyRevealLevels: null,  // Map "p:s:i" -> reveal level, reset per story open
  storyOccurrence: null,    // Map "p:s:i" -> how many times this word already appeared earlier in the story
  storyCounted: null,       // Set of exposure keys already counted THIS reading (§6.3)
  readerLookedUp: null,     // Map surface -> token, for the end card (§8.5)
  readerCardKey: null,      // the info panel's open token key, or null
  readerCardRevealed: false, // has the open panel's "Show definition" been tapped
  readerFinished: false,
  readerCursor: -1,         // paragraph currently being read, for the resume cursor (readerScrollSync)
  readerFuriganaMode: 'smart', // reader settings (§8.4) — per device, never synced
  // Off by default: romaji is a beginner's crutch, and most learners who've
  // reached kanji stories don't want it offered at all, let alone on every
  // word's reveal ladder. See furiganaMaxLevel in reader.js for how this
  // shortens the ladder itself, not just what tokenAtLevel paints.
  readerShowRomaji: false,
  readerShowAllTranslations: false,
  readerTextSize: 3,        // 1-5, index into READER_TEXT_SIZES; persisted per device
  readerScrollY: 0,         // where in the story we were when leaving for a detail screen
  readerActiveKey: null,    // "p:s:i" of the last-tapped token, highlighted as a place marker
};

// The writing lesson card's stroke-order animation loops like a gif (see
// animateStrokes in strokes.js) — this is its stop handle, so a new card (or
// leaving the lesson screen entirely) can cancel the previous one instead of
// leaving its timers running forever against detached SVG nodes.
let lessonStrokeLoopStop = null;
function stopLessonStrokeLoop() {
  if (lessonStrokeLoopStop) lessonStrokeLoopStop();
  lessonStrokeLoopStop = null;
}

function currentScript() {
  return SCRIPTS.find((s) => s.id === state.scriptId);
}

/** The course the current script + grade selection resolves to. */
function currentCourse() {
  const kind = currentScript().kind;
  if (kind === 'kanji') return getAnyCourse(`kanji-grade-${state.kanjiUnit}`);
  if (kind === 'vocab') return getAnyCourse(`vocab-${state.vocabUnit}`);
  return getAnyCourse(state.scriptId);
}

/** Every course a script covers — one for kana, one per grade for kanji,
 * one per teaching unit for vocab. */
function coursesForScript(script) {
  if (script.kind === 'kanji') return KANJI_COURSES;
  if (script.kind === 'vocab') return activeVocabCourses();
  return [getAnyCourse(script.id)];
}

const $ = (id) => document.getElementById(id);
const screens = () => document.querySelectorAll('.screen');

// Bumped every time the visible screen changes — every navigation path ends
// up here, so this is one single place to detect "the user has moved on"
// generically. Used by async functions that await a lazy data load
// (openCharacterDetail, startSession — see kanji-expansion-plan.md §4) to
// avoid forcing the user onto a screen they've already navigated away from
// by the time that load finishes: capture navSeq before the await, and skip
// rendering if it no longer matches afterward.
let navSeq = 0;

function show(screenId) {
  navSeq += 1;
  screens().forEach((el) => { el.hidden = el.id !== screenId; });
  currentScreenId = screenId;
  updateInstallBannerVisibility();
  window.scrollTo(0, 0);
}

let currentScreenId = null;

// A lesson, a quiz/writing question, or the session summary all put
// something the learner needs to reach right at the bottom of the screen —
// the quiz/summary .bottom-bar is fixed there deliberately (see
// styles.css), and the install banner is fixed too, so it would sit on top
// and eat the tap meant for what's under it. Hidden outright rather than
// merely low z-index, for the same reason: a banner that's still there but
// unreachable is not actually less in the way. Reappears the moment show()
// lands anywhere else — settings, the course list, character detail, all
// fine to cover a corner of.
const INSTALL_BANNER_BLOCKED_SCREENS = new Set([
  'screen-lesson', 'screen-quiz', 'screen-writing', 'screen-summary',
]);

function updateInstallBannerVisibility() {
  $('install-banner').hidden = !installBannerEligible || INSTALL_BANNER_BLOCKED_SCREENS.has(currentScreenId);
}

// --- Profiles -------------------------------------------------------------

async function renderProfiles() {
  applyAccentColor('coral'); // no profile active here — the neutral default
  const profiles = await store.listProfiles();
  const list = $('profile-list');
  list.innerHTML = '';
  profiles.forEach((profile) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'profile-card';
    button.innerHTML = `<span class="avatar">${profile.emoji}</span><span class="profile-name"></span>`;
    button.querySelector('.profile-name').textContent = profile.name;
    button.addEventListener('click', () => openProfile(profile));
    list.appendChild(button);
  });
  // First run: go straight to the create form rather than an empty screen.
  const empty = profiles.length === 0;
  $('new-profile-form').hidden = !empty;
  $('add-profile').hidden = empty;
  show('screen-profiles');
}

function renderEmojiPicker() {
  const picker = $('emoji-picker');
  picker.innerHTML = '';
  EMOJI_CHOICES.forEach((emoji, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `emoji-option${index === 0 ? ' selected' : ''}`;
    button.textContent = emoji;
    button.addEventListener('click', () => {
      picker.querySelectorAll('.emoji-option').forEach((el) => el.classList.remove('selected'));
      button.classList.add('selected');
    });
    picker.appendChild(button);
  });
}

function selectedEmoji() {
  const chosen = $('emoji-picker').querySelector('.emoji-option.selected');
  return chosen ? chosen.textContent : EMOJI_CHOICES[0];
}

/**
 * Settings > Badge. The picker above (#emoji-picker) is a one-shot choice
 * while creating a profile; this one edits an existing profile's badge, the
 * same way renderColorPicker() below edits its accent colour.
 *
 * Stamping `profileUpdatedAt` is what makes the change actually travel
 * between devices: mergeIdentity() in merge.js resolves name/emoji by that
 * timestamp, and until this existed nothing ever wrote it — so every merge
 * tied at 0 and silently kept whichever copy was local, which is exactly why
 * a badge chosen on one device never showed up on another.
 */
function renderProfileEmojiPicker() {
  const picker = $('profile-emoji-picker');
  picker.innerHTML = '';
  EMOJI_CHOICES.forEach((emoji) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'emoji-option';
    button.textContent = emoji;
    button.addEventListener('click', () => {
      state.profile.emoji = emoji;
      state.profile.profileUpdatedAt = Date.now();
      store.saveProfile(state.profile);
      syncProfileEmojiSelection();
    });
    picker.appendChild(button);
  });
}

function syncProfileEmojiSelection() {
  $('profile-emoji-picker').querySelectorAll('.emoji-option').forEach((el) => {
    el.classList.toggle('selected', el.textContent === state.profile.emoji);
  });
}

/**
 * Settings > Theme colour. Unlike the emoji picker above (a one-shot choice
 * for a brand-new profile), this edits an EXISTING profile's setting live —
 * built once here, but which swatch reads .selected is re-synced every time
 * Settings opens (see renderSettings()), the same way writing-strictness's
 * slider value is. A click applies, saves and re-syncs all in one go, so
 * the rest of the app re-skins itself immediately, not just on next visit.
 */
function renderColorPicker() {
  const picker = $('color-picker');
  picker.innerHTML = '';
  ACCENT_COLORS.forEach((color) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'color-option';
    button.style.background = color.swatch;
    button.dataset.color = color.id;
    button.setAttribute('aria-label', color.name);
    button.addEventListener('click', () => {
      state.profile.settings.accentColor = color.id;
      stampSetting(state.profile, 'accentColor');
      applyAccentColor(color.id);
      store.saveProfile(state.profile);
      syncColorPickerSelection();
    });
    picker.appendChild(button);
  });
}

function syncColorPickerSelection() {
  const accentColor = state.profile.settings.accentColor || 'coral';
  $('color-picker').querySelectorAll('.color-option').forEach((el) => {
    el.classList.toggle('selected', el.dataset.color === accentColor);
  });
}

/**
 * One-time study-list migration(s), then open the profile. Two independent
 * profile ages can show up here:
 *
 * - No `study` field at all — before the study list existed, enrollment was
 *   implied by which progress records exist, and deriveStudyList() reads
 *   exactly that back out. See kanji-expansion-plan.md §1.3.
 * - `study` in the pre-timestamp array shape ({kanji: [mode, ...]}), or
 *   simply missing `unstudy` — before un-enrolling could survive a sync
 *   merge (sync-plan.md §0.1). migrateStudyShape() converts array entries to
 *   the timestamped shape; an already-timestamped `study` passes through
 *   unchanged.
 *
 * `undefined` is `study`'s trigger for the first case, deliberately, not
 * falsiness: `{}` is a legitimate state (everything removed) and must not
 * re-populate itself from history on the next load. Both migrations persist
 * immediately so they run once rather than on every open.
 */
function openProfile(profile) {
  state.profile = profile;
  applyAccentColor(profile.settings.accentColor);
  if (profile.study === undefined) {
    profile.study = deriveStudyList(profile.progress);
    profile.unstudy = {};
    store.saveProfile(profile);
  } else if (isLegacyStudyShape(profile.study) || profile.unstudy === undefined) {
    profile.study = migrateStudyShape(profile.study);
    profile.unstudy = profile.unstudy || {};
    store.saveProfile(profile);
  }
  // No migration needed here, unlike study above — a profile predating this
  // field legitimately has no exposures anywhere yet (vocab-plan.md §3.3),
  // so it just starts as {} without being persisted until something is
  // actually recorded into it.
  if (profile.exposure === undefined) profile.exposure = {};
  // Same reasoning as exposure above — a profile predating "hide furigana in
  // future" has muted nothing yet.
  if (profile.muted === undefined) profile.muted = {};
  // Same reasoning again — a profile predating stories has read none of them.
  if (profile.stories === undefined) profile.stories = { read: {}, pos: {} };
  renderHome();
  // Not awaited: opening a learner must never wait on the network. If this
  // brings anything in, it re-renders the home screen itself (autoSync).
  autoSync({ force: true });
}

// --- Home: pick a script --------------------------------------------------

function renderHome() {
  const profile = state.profile;
  $('home-avatar').textContent = profile.emoji;
  $('home-greeting').textContent = profile.name;
  // Not awaited: this reads IndexedDB, and the rest of the home screen must
  // never wait on it to draw.
  renderSyncNudge();
  renderReadCard();

  const list = $('script-list');
  list.innerHTML = '';
  SCRIPTS.forEach((script) => {
    // Progress shown here is for whichever mode applies to the script, summed
    // over its courses (all six grades, for kanji).
    const mode = MODES[state.mode].kinds.includes(script.kind)
      ? state.mode
      : defaultModeForKind(script.kind);
    const totals = coursesForScript(script).reduce((acc, course) => {
      const stats = courseStats(course, mode, profile);
      return { started: acc.started + stats.started, total: acc.total + stats.total, due: acc.due + stats.due };
    }, { started: 0, total: 0, due: 0 });
    const pct = Math.round((totals.started / totals.total) * 100);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'script-card';
    button.dataset.script = script.id;
    button.innerHTML = `
      <span class="script-sample glyph"></span>
      <span class="script-text">
        <span class="script-name"></span>
        <span class="script-native"></span>
      </span>
      <span class="script-meta">
        <span class="script-count"></span>
        <span class="progress"><span class="progress-fill" style="width:${pct}%"></span></span>
      </span>
    `;
    button.querySelector('.script-sample').textContent = script.sample;
    button.querySelector('.script-name').textContent = script.name;
    button.querySelector('.script-native').textContent = script.native;
    button.querySelector('.script-count').textContent = totals.due > 0
      ? `${totals.due} to review`
      : `${totals.started} / ${totals.total}`;
    button.addEventListener('click', () => openScript(script.id));
    list.appendChild(button);
  });

  show('screen-home');
}

// --- Course screen: modes, grade, and the session actions -----------------

function openScript(scriptId) {
  const previousKind = currentScript().kind;
  state.scriptId = scriptId;
  const script = currentScript();
  // Carry the mode over between scripts of the same kind, so switching
  // between hiragana and katakana keeps you in the same activity. Switching
  // to a different kind resets to that kind's own default instead — kana's
  // Reading and kanji's Yomi share a mode id, but arriving at kanji fresh
  // should open on Definition, not carry Reading in as Yomi.
  if (script.kind !== previousKind || !MODES[state.mode].kinds.includes(script.kind)) {
    state.mode = defaultModeForKind(script.kind);
  }
  renderCourse();
}

function renderModePicker(kind) {
  const picker = $('mode-picker');
  picker.innerHTML = '';
  modesForKind(kind).forEach((mode) => {
    const label = modeName(mode.id, kind);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `segment${state.mode === mode.id ? ' active' : ''}`;
    button.textContent = label;
    button.dataset.mode = mode.id;
    // Kanji writing needs its reading/meaning side panel (phase 4 of
    // writing-mode-plan.md), so it's still shown but inert there — kana
    // writing (Trace mode) is live.
    if (isModeComingSoon(mode, kind)) {
      button.disabled = true;
      button.classList.add('segment-soon');
      button.innerHTML = `${label} <small>soon</small>`;
    } else {
      button.addEventListener('click', () => { state.mode = mode.id; renderCourse(); });
    }
    picker.appendChild(button);
  });
  $('mode-hint').textContent = modeHint(state.mode, kind);
}

// Short badge text for the grade-picker tile — "1".."6" for elementary,
// "S1".."S6" for secondary jōyō sub-units, "N1".."N6" for beyond-jōyō names
// & places sub-units (see kanji-expansion-plan.md §5/§8).
function unitBadge(unit) {
  if (unit.startsWith('9-')) return `N${unit.slice(2)}`;
  if (unit.startsWith('8-')) return `S${unit.slice(2)}`;
  return unit;
}

/**
 * The unit groups a script's picker splits into, in teaching order:
 * [{ label, units }]. Kanji groups come from KANJI_UNIT_GROUPS (a per-unit
 * test table); vocab groups are baked into the unit id itself (§2.3's Core
 * spine first, then the five GCSE-style theme groups), so vocab.js's
 * unitGroupLabel answers directly. Both unit lists are already in teaching
 * order, so grouping consecutive runs is enough — no sorting here.
 */
function unitGroupsFor(kind) {
  const units = kind === 'kanji' ? KANJI_UNIT_IDS : activeVocabCourses().map((c) => c.unit);
  const labelFor = kind === 'kanji'
    ? (unit) => kanjiUnitGroup(unit).label
    : (unit) => vocabUnitGroupLabel(unit);
  const groups = [];
  units.forEach((unit) => {
    const label = labelFor(unit);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.units.push(unit);
    else groups.push({ label, units: [unit] });
  });
  return groups;
}

/** The real course behind a unit id, for whichever of the two unit-bearing
 * kinds is being browsed. */
function unitCourse(kind, unit) {
  return getAnyCourse(kind === 'kanji' ? `kanji-grade-${unit}` : `vocab-${unit}`);
}

function selectedUnit(kind) {
  if (kind === 'kanji') return state.kanjiUnit;
  // The remembered unit belongs to whichever progression was on screen when
  // it was chosen — switching progressions (or opening a profile that uses
  // the other one) leaves it pointing at a unit the active axis doesn't
  // have. Fall back to that axis's first unit rather than rendering a course
  // screen for a unit no tile on it can select.
  const active = activeVocabCourses();
  if (!active.some((c) => c.unit === state.vocabUnit)) {
    state.vocabUnit = active[0].unit;
  }
  return state.vocabUnit;
}

function selectUnit(kind, unit) {
  if (kind === 'kanji') state.kanjiUnit = unit;
  else state.vocabUnit = unit;
  // So that leaving a group and coming back lands where you left it rather
  // than at that group's first unit every time.
  const groups = unitGroupsFor(kind);
  const group = groups.find((g) => g.units.includes(unit));
  if (group) state.lastUnitByGroup[`${kind}:${group.label}`] = unit;
  renderCourse();
}

/** Tapping a group header selects a unit inside it — the one last looked at
 * there, or its first. There is deliberately no separate "which group am I
 * browsing" state: the open group is always the selected unit's own, so the
 * unit row, the group row and the course card underneath can never disagree
 * about what is selected. */
function openUnitGroup(kind, group) {
  const remembered = state.lastUnitByGroup[`${kind}:${group.label}`];
  selectUnit(kind, group.units.includes(remembered) ? remembered : group.units[0]);
}

/**
 * Kanji grades and vocab units, in two short horizontally-scrolling rows —
 * the groups, then the units of whichever group holds the selected unit.
 * Kanji has ~18 units and vocab ~33, which as one wrapped grid (what this
 * used to be) ran to eight or more rows and pushed the actual buttons —
 * Review, Learn, Test unlearned, View overview — off the bottom of a phone
 * screen entirely. Two fixed-height rows cost the same regardless of how
 * many units a script grows to, so nothing below them moves.
 *
 * A dot on a unit means reviews are waiting there; a dot on a GROUP means
 * they are waiting somewhere inside it, which is what keeps a due unit
 * findable now that only one group's units are on screen at a time.
 */
function renderGradePicker(script) {
  const groupRow = $('unit-groups');
  const picker = $('grade-picker');
  groupRow.innerHTML = '';
  picker.innerHTML = '';
  if (script.kind !== 'kanji' && script.kind !== 'vocab') {
    groupRow.hidden = true;
    picker.hidden = true;
    return;
  }

  const kind = script.kind;
  const groups = unitGroupsFor(kind);
  const unit = selectedUnit(kind);
  const openGroup = groups.find((g) => g.units.includes(unit)) || groups[0];

  // One group is no choice at all — the row would just be a label taking up
  // space above the only units there are.
  groupRow.hidden = groups.length < 2;
  groups.forEach((group) => {
    const due = group.units.some((u) => courseStats(unitCourse(kind, u), state.mode, state.profile).due > 0);
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = `unit-group${group === openGroup ? ' active' : ''}`;
    chip.dataset.group = group.label;
    chip.setAttribute('aria-pressed', group === openGroup ? 'true' : 'false');
    chip.innerHTML = '<span class="unit-group-name"></span><span class="unit-group-dot"></span>';
    chip.querySelector('.unit-group-name').textContent = group.label;
    chip.querySelector('.unit-group-dot').hidden = !due;
    chip.querySelector('.unit-group-dot').textContent = '•';
    chip.addEventListener('click', () => openUnitGroup(kind, group));
    groupRow.appendChild(chip);
  });

  picker.hidden = false;
  let activeTile = null;
  openGroup.units.forEach((u) => {
    const course = unitCourse(kind, u);
    const stats = courseStats(course, state.mode, state.profile);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `grade${u === unit ? ' active' : ''}`;
    button.dataset.grade = u;
    button.innerHTML = '<span class="grade-number"></span><span class="grade-dot"></span>';
    button.querySelector('.grade-number').textContent = kind === 'kanji' ? unitBadge(u) : vocabUnitBadge(u);
    button.querySelector('.grade-dot').textContent = stats.due > 0 ? '•' : '';
    const name = kind === 'kanji' ? course.name : vocabUnitLabel(u);
    button.setAttribute('aria-label', `${name}, ${stats.started} of ${stats.total} started`);
    button.addEventListener('click', () => selectUnit(kind, u));
    picker.appendChild(button);
    if (u === unit) activeTile = button;
  });

  // A group can hold more units than fit the row's width (vocab's themes run
  // to eight), so the selected one is scrolled to rather than left off the
  // end where it looks as though nothing is selected. Deferred a frame for
  // the same reason the overview's scroll is: the row was only just filled.
  if (activeTile && activeTile.scrollIntoView) {
    requestAnimationFrame(() => activeTile.scrollIntoView({ block: 'nearest', inline: 'center' }));
  }
}

const WRITING_MODE_PREFS = ['dynamic', 'trace', 'guided', 'free'];
const WRITING_MODE_PREF_LABELS = { dynamic: 'Dynamic', trace: 'Trace', guided: 'Guided', free: 'Free' };

/**
 * Writing mode only: chosen BEFORE a session starts, so a fixed choice
 * applies from the very first character, including one that's brand new —
 * without this, the first character of every session would still start in
 * Trace regardless (autoWritingMode's "new" case), and only the in-session
 * toggle could override it, one question too late for a learner who wants
 * to test themselves in Guided from the start. "Dynamic" is that per-
 * character mastery-based choice; see writing-mode-plan.md.
 */
function renderWritingModePicker() {
  const picker = $('writing-mode-picker');
  const hint = $('writing-mode-picker-hint');
  if (state.mode !== 'writing') {
    picker.hidden = true;
    hint.hidden = true;
    return;
  }
  picker.hidden = false;
  hint.hidden = false;
  const current = state.profile.settings.writingModePreference || 'dynamic';
  picker.innerHTML = '';
  WRITING_MODE_PREFS.forEach((pref) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `segment${pref === current ? ' active' : ''}`;
    button.textContent = WRITING_MODE_PREF_LABELS[pref];
    button.addEventListener('click', () => setWritingModePreference(pref));
    picker.appendChild(button);
  });
  hint.textContent = current === 'dynamic'
    ? 'Each character starts in whichever mode fits how well you know it.'
    : `Every character starts in ${WRITING_MODE_PREF_LABELS[current]} until you change this.`;
}

const VOCAB_PROGRESSIONS = ['common', 'syllabus'];
const VOCAB_PROGRESSION_LABELS = { common: 'By commonness', syllabus: 'By topic' };

/**
 * Vocabulary only: which order the words are taught in. Both progressions
 * cover the SAME words — a word's records are keyed by the word itself, not
 * by the unit it was met in — so switching reorders what is offered next
 * and loses nothing already learned. That is worth saying on screen, since
 * a learner mid-way through a course has every reason to assume otherwise.
 */
function renderVocabProgressionPicker() {
  const picker = $('vocab-progression-picker');
  const hint = $('vocab-progression-hint');
  const script = SCRIPTS.find((s) => s.id === state.scriptId);
  if (!script || script.kind !== 'vocab') {
    picker.hidden = true;
    hint.hidden = true;
    return;
  }
  picker.hidden = false;
  hint.hidden = false;
  const current = state.profile.settings.vocabProgression || 'common';
  picker.innerHTML = '';
  VOCAB_PROGRESSIONS.forEach((pref) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `segment${pref === current ? ' active' : ''}`;
    button.textContent = VOCAB_PROGRESSION_LABELS[pref];
    button.addEventListener('click', () => setVocabProgression(pref));
    picker.appendChild(button);
  });
  hint.textContent = current === 'common'
    ? 'Commonest words first, however they are used. Switching keeps everything you have learned.'
    : 'Grouped by GCSE and A-level topic. Switching keeps everything you have learned.';
}

function setVocabProgression(pref) {
  state.profile.settings.vocabProgression = pref;
  stampSetting(state.profile, 'vocabProgression');
  store.saveProfile(state.profile);
  // The remembered unit belongs to the axis being left behind; selectedUnit()
  // re-homes it on the next read, and the group memory keyed by the old
  // axis's labels is equally stale.
  state.lastUnitByGroup = {};
  renderCourse();
}

/** Persisted per profile — sticks across sessions, not just this one, until
 * changed again here or via the in-session toggle (writingSetSubMode). */
function setWritingModePreference(pref) {
  state.profile.settings.writingModePreference = pref;
  stampSetting(state.profile, 'writingModePreference');
  store.saveProfile(state.profile);
  renderWritingModePicker();
}

/**
 * "N sets left" counts down to the end of the unit — meaningless once a unit
 * runs to hundreds of sets (see kanji-expansion-plan.md §8), which sets of 5
 * kanji at a time will once full jōyō coverage lands, so this only ever shows
 * a countdown, never "set N of M".
 *
 * Suppressed entirely once a kanji has been manually added and studied out
 * of teaching order — detected here as "something beyond the current set is
 * already introduced", which can only happen via a manual add-and-study,
 * since ordinary progression always fills sets front to back. At that point
 * "N sets left" no longer describes a real linear position, so it is better
 * left unsaid than shown and wrong.
 *
 * A chunk excluded from this mode entirely (yōon kana in writing mode — see
 * kana.js) is never reachable as "current" and must not inflate the count
 * either, so only chunks with something actually eligible in this mode are
 * counted.
 */
function remainingSetsLabel(course, mode, profile, setIndex, fresh) {
  if (fresh === 0) return '';
  const introduced = new Set(introducedItems(course, mode, profile));
  const excluded = (course.excludeForMode && course.excludeForMode[mode]) || new Set();
  const rest = course.chunks.slice(setIndex + 1);
  const sequential = rest.every((chunk) => chunk.items.every((item) => !introduced.has(item)));
  if (!sequential) return '';
  const remaining = 1 + rest.filter((chunk) => chunk.items.some((item) => !excluded.has(item))).length;
  return ` · ${remaining} set${remaining === 1 ? '' : 's'} left`;
}

/** The two unit-agnostic pools behind the quick actions, per script kind.
 * Kana has neither: it is one course with no units to span and no study
 * list to pool, so its screen shows no quick-action row at all. */
const QUICK_ACTION_POOLS = {
  kanji: { due: STUDY_LIST_POOL_ID, next: ALL_KANJI_POOL_ID },
  vocab: { due: VOCAB_STUDY_POOL_ID, next: ALL_VOCAB_POOL_ID },
};

/**
 * The two things a learner actually does every day, ahead of all the
 * unit-by-unit browsing below: review whatever's due, across every unit
 * being studied at once (studyListPool/vocabStudyPool above), or learn the
 * next batch in overall curriculum order (allKanjiPool/allVocabPool). Both
 * are deliberately agnostic to whichever unit tile happens to be selected
 * below, which only controls what the browsing card underneath shows.
 *
 * Kanji had this already; vocabulary now has the same pair for the same
 * reason, and with thirty-odd units it needs them more, not less. Supersedes
 * the old "This set"/"Everything I'm studying" review-scope toggle: there is
 * no longer a reason to review (or learn) just one unit at a time, so that
 * choice is gone rather than hidden somewhere else.
 */
function renderQuickActions(script) {
  const wrap = $('quick-actions');
  const pools = QUICK_ACTION_POOLS[script.kind];
  if (!pools) {
    wrap.hidden = true;
    return;
  }
  wrap.hidden = false;

  const poolStats = courseStats(getAnyCourse(pools.due), state.mode, state.profile);
  const reviewButton = $('quick-review-due');
  if (poolStats.due > 0) {
    reviewButton.disabled = false;
    reviewButton.innerHTML = `Review <b>${poolStats.due}</b> due`;
  } else {
    reviewButton.disabled = true;
    reviewButton.textContent = 'Nothing due';
  }

  const stats = courseStats(getAnyCourse(pools.next), state.mode, state.profile);
  const newCount = Math.min(stats.fresh, state.profile.settings.newPerSession);
  // The number actually waiting, not stats.fresh's count — fresh counts the
  // whole remaining curriculum (always ≥ newPerSession in practice), so
  // newCount is always the full per-session batch size regardless of
  // whether anything is really pending. Capped at newPerSession the same
  // way: this is what the very next tap teaches, not the total backlog.
  const waitingCount = Math.min(stats.pending, state.profile.settings.newPerSession);
  const learnButton = $('quick-learn-next');
  if (newCount > 0) {
    learnButton.disabled = false;
    // "Waiting" whenever something here was deliberately enrolled already —
    // a word added from its own detail screen, or from a kanji page's
    // "Common words" Add badge, rather than just the next untouched item in
    // curriculum order — same distinction and wording renderCourse()'s own
    // per-unit "Learn" button makes. This is the one place that word is
    // actually findable regardless of which unit it landed in: it can
    // belong to any of thirty-odd vocab units, and this button already
    // spans all of them (pools.next), which the per-unit card doesn't.
    learnButton.innerHTML = stats.pending > 0
      ? `Learn <b>${waitingCount}</b> waiting`
      : `Learn <b>${newCount}</b> next`;
  } else {
    learnButton.disabled = true;
    learnButton.textContent = 'All caught up';
  }

  // Whichever is actually actionable reads as the primary action; if both
  // are (or neither is), review wins — same "due outranks new" precedence
  // the course card below already uses.
  reviewButton.className = `btn wide${poolStats.due > 0 ? ' btn-primary' : ''}`;
  learnButton.className = `btn wide${poolStats.due === 0 && newCount > 0 ? ' btn-primary' : ''}`;
}

// Wired once, not re-bound on every render (unlike the course-card buttons
// below, which are recreated from scratch each time) — these two live on
// static HTML elements, so each computes what it needs fresh at click time
// rather than capturing a pool/course from whichever render last ran.
function quickReviewDue() {
  const pools = QUICK_ACTION_POOLS[currentScript().kind];
  if (!pools) return;
  const pool = getAnyCourse(pools.due);
  if (courseStats(pool, state.mode, state.profile).due === 0) return;
  startSession(pool.id, 'review');
}

function quickLearnNext() {
  const pools = QUICK_ACTION_POOLS[currentScript().kind];
  if (!pools) return;
  const pool = getAnyCourse(pools.next);
  const stats = courseStats(pool, state.mode, state.profile);
  if (Math.min(stats.fresh, state.profile.settings.newPerSession) === 0) return;
  startSession(pool.id, 'new');
}

// Broad enough that a single common romaji letter could plausibly match
// dozens of readings; capped so an unrefined query doesn't dump the entire
// jouyou set into one grid, the way the set overview deliberately can.
const KANJI_SEARCH_RESULT_LIMIT = 60;

/** True if `char`'s reading `info` matches `query` on its character, any
 * English meaning, or any reading — kana or romaji, either direction, since
 * both `query` and each reading are compared as romaji regardless of which
 * script either was actually written in. */
function kanjiMatchesSearch(info, char, query, queryRomaji) {
  if (char === query) return true;
  if (info.meanings.some((m) => m.toLowerCase().includes(query))) return true;
  return [...info.on, ...info.kun]
    .some((reading) => toRomaji(reading.replace(/[-.]/g, '')).toLowerCase().includes(queryRomaji));
}

// Set once the first full load has been kicked off — search needs EVERY
// grade's real kanji data loaded to match against (it doesn't know which
// grade a query might match ahead of time), unlike detail/session which
// only ever need one or a few. Stroke data isn't needed for matching or for
// the result tiles themselves, only once a specific result is opened — see
// openCharacterDetail() — so this loads kanji data only, not strokes, to
// keep the one-time cost proportionate to what search actually needs.
let kanjiSearchLoadStarted = false;

/**
 * Kanji only — finds a kanji by character, English meaning, or reading,
 * across every grade at once, without needing to know which one it's in
 * (kanji-expansion-plan.md §2.2). Reuses the exact same tiles as the set
 * overview (buildMasteryTile), tapping through to the same detail screen —
 * search has no enrollment UI of its own to keep in sync with §2.1's.
 */
function renderKanjiSearchResults(query) {
  const grid = $('kanji-search-results');
  const empty = $('kanji-search-empty');
  const truncated = $('kanji-search-truncated');
  const loading = $('kanji-search-loading');
  grid.innerHTML = '';
  empty.hidden = true;
  truncated.hidden = true;
  loading.hidden = true;
  if (!query) return;

  if (!areAllKanjiUnitsLoaded()) {
    loading.hidden = false;
    if (!kanjiSearchLoadStarted) {
      kanjiSearchLoadStarted = true;
      Promise.all(KANJI_COURSES.map((c) => ensureKanjiUnitLoaded(c.unit))).then(() => {
        // Only re-render if the search box still holds a query — it may
        // have been cleared, or the learner navigated away and back with a
        // different one, while this was loading.
        const current = $('kanji-search').value.trim();
        if (current) renderKanjiSearchResults(current);
      });
    }
    return;
  }

  const queryLower = query.toLowerCase();
  const queryRomaji = toRomaji(query).toLowerCase();
  const matches = [];
  allKanjiIndex().forEach((info, char) => {
    if (kanjiMatchesSearch(info, char, queryLower, queryRomaji)) matches.push(char);
  });

  if (matches.length === 0) {
    empty.hidden = false;
    return;
  }

  matches.slice(0, KANJI_SEARCH_RESULT_LIMIT).forEach((char) => {
    grid.appendChild(buildMasteryTile(kanjiCourseFor(char), char, 'course'));
  });
  if (matches.length > KANJI_SEARCH_RESULT_LIMIT) {
    truncated.textContent = `${matches.length - KANJI_SEARCH_RESULT_LIMIT} more match — try a more specific search.`;
    truncated.hidden = false;
  }
}

function renderCourse() {
  const profile = state.profile;
  const script = currentScript();
  $('course-title').textContent = script.name;
  renderModePicker(script.kind);
  // Before renderGradePicker: switching progression changes which units
  // exist, and the picker below must be drawn from the new axis.
  renderVocabProgressionPicker();
  renderGradePicker(script);
  renderQuickActions(script);
  renderWritingModePicker();
  // Only in the syllabus progression — it is entirely about how the GCSE/
  // A-level topic groups were built, and says nothing true of the
  // commonness ladder, which has no exam-board shape to explain.
  $('vocab-source-hint').hidden = script.kind !== 'vocab'
    || (state.profile.settings.vocabProgression || 'common') !== 'syllabus';

  $('kanji-search-wrap').hidden = script.kind !== 'kanji';
  const searchQuery = script.kind === 'kanji' ? $('kanji-search').value.trim() : '';
  $('kanji-search-clear').hidden = !searchQuery;
  renderKanjiSearchResults(searchQuery);

  const list = $('course-list');
  if (searchQuery) {
    // Search spans every grade at once — the grade-scoped card and pickers
    // below would be misleading alongside results that aren't limited to
    // whichever grade happens to be selected, so they step aside entirely
    // rather than showing two answers to "what should I do next" at once.
    $('unit-groups').hidden = true;
    $('grade-picker').hidden = true;
    $('writing-mode-picker').hidden = true;
    list.innerHTML = '';
    show('screen-course');
    return;
  }

  const course = currentCourse();
  list.innerHTML = '';

  const stats = courseStats(course, state.mode, profile);
  const setIndex = currentSetIndex(course, state.mode, profile);
  const currentChunk = course.chunks[setIndex];
  const pct = Math.round((stats.started / stats.total) * 100);
  const newCount = Math.min(stats.fresh, profile.settings.newPerSession);
  // The true waiting count, not newCount — see renderQuickActions()'s own
  // waitingCount for why these can't share one number.
  const waitingCount = Math.min(stats.pending, profile.settings.newPerSession);
  const settled = readyForMore(course, state.mode, profile);
  const setsLeft = remainingSetsLabel(course, state.mode, profile, setIndex, stats.fresh);

  // Vocab only: which GCSE-style group this unit falls under, and (for a
  // themed unit, not Core) which frequency level it is — "Common words 1"
  // is otherwise invisible on screen, since it's the implicit default and
  // unitGroupLabel alone only names it for a Higher-tier unit ("Common
  // words 2"). Without this line the course card looks identical for a
  // unit and its harder sibling, which is exactly the confusion this fixes
  // — see the "Vocabulary word lists" card in Settings for what the levels
  // and groups actually mean and where the words come from.
  // vocabUnitGroupLabel is called on the level-stripped id, not course.unit
  // itself — for a Higher unit ("2.4h") it otherwise collapses straight to
  // "Common words 2" (the browse-tab grouping, which deliberately hides
  // theme so every Higher unit sits in one tab), which would duplicate the
  // level label computed alongside it here instead of naming the theme.
  const vocabLevel = script.kind === 'vocab' ? vocabUnitLevelLabel(course.unit) : null;
  const vocabTheme = script.kind === 'vocab'
    ? vocabUnitGroupLabel(course.unit.endsWith('h') ? course.unit.slice(0, -1) : course.unit)
    : '';
  const vocabGroupLine = script.kind === 'vocab'
    ? `<div class="course-group">${vocabLevel ? `${vocabLevel} · ` : ''}${vocabTheme}</div>`
    : '';

  const card = document.createElement('div');
  card.className = 'card course-card';
  card.innerHTML = `
    <div class="course-head">
      <div>
        <h3>${course.name}</h3>
        ${vocabGroupLine}
        <div class="course-native">${course.native}</div>
      </div>
      <div class="course-count">${stats.started}<span>/${stats.total}</span></div>
    </div>
    <div class="progress"><div class="progress-fill" style="width:${pct}%"></div></div>
    <div class="hint">Current set: <b>${currentChunk.label}</b>${setsLeft} · ★ ${stats.mastered} mastered</div>
  `;

  // A real, clearly-bordered button rather than styled text — that it was
  // tappable wasn't obvious before. Opens every character in the course at
  // once (glyphs colour-coded by how well each is known, tap through to
  // stroke order and readings for any of them), scrolled to the current set.
  const viewSet = document.createElement('button');
  viewSet.type = 'button';
  viewSet.className = 'btn overview-button';
  viewSet.innerHTML = '📋 View set overview';
  viewSet.addEventListener('click', () => openOverview(course, currentChunk.items[0]));

  // "Place in": an already-capable learner tests every not-yet-started item
  // in this unit cold, no lesson step, so nothing is shown before being
  // asked. A correct first answer jumps straight to the top box instead of
  // the usual one-box-at-a-time climb (see grade()'s `placement` option) —
  // the whole point is skipping the slow climb for something already known.
  // No count in the label on purpose: this used to say "Test N unlearned",
  // but N was how many were ENROLLED by tapping the button, not a preview —
  // quitting after just one meant the rest of that N sat there marked
  // "waiting to learn" despite never being touched. Enrollment now happens
  // lazily, one item at a time, only once actually attempted (see
  // ensurePlacementEnrolled() below), so there is no longer a single count
  // to show honestly before the learner has done anything.
  const row = document.createElement('div');
  row.className = 'row';
  row.appendChild(viewSet);

  const untested = neverSeenItems(course, state.mode, profile).length;
  const placement = document.createElement('button');
  placement.type = 'button';
  placement.className = 'btn';
  if (untested > 0) {
    placement.innerHTML = '🎯 Test unlearned';
    placement.addEventListener('click', () => startSession(course.id, 'placement'));
  } else {
    placement.textContent = 'Nothing left to test';
    placement.disabled = true;
  }
  row.appendChild(placement);
  card.appendChild(row);

  // Learning new characters and reviewing are separate buttons, so adding
  // more to study is always a decision rather than something that happens
  // automatically at the start of a session.
  const actions = document.createElement('div');
  actions.className = 'actions';

  const review = document.createElement('button');
  review.type = 'button';
  review.className = 'btn btn-primary';
  if (stats.due > 0) {
    review.innerHTML = `Review <b>${stats.due}</b>`;
    review.addEventListener('click', () => startSession(course.id, 'review'));
  } else if (stats.started > 0) {
    review.className = 'btn';
    review.textContent = 'Practise';
    review.addEventListener('click', () => startSession(course.id, 'practice'));
  } else {
    review.textContent = 'Nothing to review';
    review.disabled = true;
  }
  actions.appendChild(review);

  const learn = document.createElement('button');
  learn.type = 'button';
  learn.className = stats.due > 0 ? 'btn' : 'btn btn-primary';
  if (newCount > 0) {
    // "Waiting" when at least one of this batch is a manual add already
    // sitting enrolled, rather than "new" — it was chosen from a detail
    // screen (§1.6 for kanji; a word's own page, or a kanji page's "Common
    // words" Add badge, for vocab), not freshly reached in course order.
    // Kana has no enrollment step at all, so stats.pending there just means
    // "never seen yet" and must not trigger this wording — every kana would
    // otherwise show as "waiting" until the whole course is memorised; kana
    // never reaches here with a nonzero pending count for real, but the
    // kind check stays explicit rather than relying on that being true.
    learn.innerHTML = course.kind !== 'kana' && stats.pending > 0
      ? `Learn <b>${waitingCount}</b> waiting`
      : `Learn <b>${newCount}</b> new`;
    learn.addEventListener('click', () => startSession(course.id, 'new'));
  } else {
    learn.textContent = 'All characters started';
    learn.disabled = true;
  }
  actions.appendChild(learn);

  card.appendChild(actions);

  // A suggestion, not a restriction: adding more is always allowed.
  if (newCount > 0 && stats.started > 0 && !settled) {
    const note = document.createElement('p');
    note.className = 'hint';
    note.textContent = 'Tip: the current set isn\'t solid yet — a review first will make it stick.';
    card.appendChild(note);
  }
  list.appendChild(card);

  show('screen-course');
}

// --- Set overview: every character in the whole course, colour-coded by
// --- mastery, in one scrollable grid ---------------------------------------

async function openOverview(course, scrollToChar) {
  state.overviewCourseId = course.id;
  // A vocab tile's label is the word's own surface (buildMasteryTile), which
  // needs that unit's real data — unlike kanji/kana, nothing before this
  // point guarantees it's loaded (a session starting it does, but the
  // overview can be opened without ever having started one).
  if (course.kind === 'vocab') {
    const requestNav = navSeq;
    await withLoading(ensureVocabUnitLoaded(course.unit));
    if (navSeq !== requestNav) return;
  }
  renderOverview(scrollToChar);
}

/**
 * One overview-style tile for `item`, coloured by mastery and marked pending
 * where applicable — shared between the set overview and kanji search
 * (§2.2) so the two never drift out of sync on what a tile means. `course`
 * must be the item's OWN course (search spans every grade, so it can't
 * assume the currently-selected one the way the overview always could).
 */
function buildMasteryTile(course, item, returnTo) {
  const progress = state.profile.progress;
  const tier = masteryTier(progress[itemKey(state.mode, item)]);
  // masteryTier alone can't tell "never enrolled" apart from "enrolled but
  // not yet taught" — both have no progress record, so both are tier 0.
  // Enrolling from the detail screen and coming straight back here was
  // otherwise indistinguishable from having done nothing at all.
  //
  // Enrollment itself is checked across every applicable mode (studyStatus),
  // not just state.mode — the tile is scoped to whichever mode's overview
  // this is (that's what tier means), but a kanji enrolled by hand via a
  // single mode toggle (say, just Writing) is still "waiting to learn" and
  // should show as such even while browsing a different mode's overview.
  const pending = course.kind === 'kanji' && tier === 0
    && studyStatus(state.profile.study, progress, item, applicableStudyModes(course, item)) !== 'not-studying';
  const tile = document.createElement('button');
  tile.type = 'button';
  // overview-tile-vocab: set the word top-to-bottom instead of wrapping a
  // multi-character word left-to-right in a square tile (see styles.css) —
  // a kana/kanji tile is always one glyph, so this only applies to vocab.
  tile.className = `overview-tile tier-${tier}${course.kind === 'vocab' ? ' overview-tile-vocab' : ''}${pending ? ' is-pending' : ''}`;
  // Vocab word ids are the surface form, or surface|reading on a homograph
  // collision (vocab-plan.md §3.3) — .w is always the plain surface to show.
  const label = course.kind === 'vocab' ? vocabInfo(course, item).w : item;
  tile.textContent = label;
  tile.setAttribute('aria-label', `${label}: ${pending ? 'Waiting to learn' : MASTERY_LABELS[tier]}`);
  tile.addEventListener('click', () => openCharacterDetail(course, item, returnTo));
  return tile;
}

/**
 * `scrollToChar`, if given, is scrolled into view after rendering — used
 * both to open on the learner's current set (rather than the top of a course
 * that can run to 200 characters) and, when returning from the detail
 * screen, to land back near whichever character was just being looked at
 * rather than snapping to the top of the list.
 */

function renderOverview(scrollToChar) {
  const course = getAnyCourse(state.overviewCourseId);
  const allItems = course.chunks.flatMap((c) => c.items);

  $('overview-title').textContent = course.name;
  $('overview-counter').textContent = `${allItems.length} characters`;
  $('legend-pending').hidden = course.kind !== 'kanji';

  const grid = $('overview-grid');
  grid.innerHTML = '';
  let scrollTarget = null;
  allItems.forEach((item) => {
    const tile = buildMasteryTile(course, item, 'overview');
    grid.appendChild(tile);
    if (item === scrollToChar) scrollTarget = tile;
  });

  show('screen-overview');
  // Deferred a frame: the grid was just unhidden, and scrollIntoView needs
  // its layout to have actually happened first.
  if (scrollTarget && typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => scrollTarget.scrollIntoView({ block: 'center' }));
  }
}

// --- Character detail: stroke order, readings, meanings -------------------

/**
 * `returnTo` is which screen the back button (data-action="detail-back")
 * returns to — 'overview' (the set overview, tapping a tile), 'summary' (the
 * end-of-session summary, tapping a chip — see finishSession()), 'course'
 * (a kanji search result on the course screen itself — see
 * renderKanjiSearchResults()), or 'quiz' (a graded question still on screen,
 * via "Full details →" in the info panel). Kept on state rather than derived
 * from "whichever screen was visible before", since detail can itself be
 * re-entered from detail-adjacent actions with no other screen in between.
 *
 * 'quiz' is the only one that returns to something MID-flight: the session
 * and the whole graded quiz screen are left untouched while detail is open,
 * so going back just un-hides it again — no re-render, which is what keeps
 * the revealed answer, the green readings and the feedback exactly as they
 * were left. See the 'detail-back' case in wire().
 */
async function openCharacterDetail(course, char, returnTo = 'overview') {
  // Arriving from anywhere that isn't a detail screen (an overview tile, a
  // summary chip, a search result, a quiz) starts a fresh chain — only
  // drillIntoDetail() stacks, and only a 'stack' return unwinds one.
  if (returnTo !== 'stack') state.detailStack = [];
  state.detailCourseId = course.id;
  state.detailChar = char;
  state.detailReturn = returnTo;
  if (course.kind === 'kanji') {
    const requestNav = navSeq;
    // kanjiUnitFor(char), not course.unit: `course` can be a synthetic
    // multi-grade pool (studyListPool/allKanjiPool), which has no `.unit` of
    // its own — ensureUnitReady(undefined) would try to load a
    // "kanji-grade-undefined" chunk that doesn't exist, so a chip/tile from
    // one of those pools would never resolve. The character's own real unit,
    // resolved from the manifest, is correct either way (see the same
    // reasoning in renderCharacterDetail() below for `detail-unit`).
    await withLoading(ensureUnitReady(kanjiUnitFor(char)));
    // The user may have navigated elsewhere (or tapped a different
    // character) while this was loading — only the most recent request
    // should ever paint a screen.
    if (navSeq !== requestNav) return;
  } else if (course.kind === 'vocab') {
    // vocabUnitFor(char), not course.unit, for the same reason the kanji
    // branch above uses kanjiUnitFor: `course` can be one of the synthetic
    // cross-unit vocab pools (vocabStudyPool/allVocabPool), which has no
    // `.unit` of its own. Belt and braces otherwise — every current path
    // here already has the word's unit loaded, and a load already done
    // resolves on the same tick.
    const requestNav = navSeq;
    await withLoading(ensureVocabUnitLoaded(vocabUnitFor(char)));
    if (navSeq !== requestNav) return;
  }
  renderCharacterDetail();
}

// Every mode a kanji or a vocab word can be enrolled in, in the order that
// reads best on the detail screen — same order the course mode picker uses.
// The five HTML buttons (index.html's #detail-study-modes) cover both sets
// at once; renderDetailStudy() below shows only whichever apply to `course`.
const STUDY_MODE_IDS = [...modesForKind('kanji').map((m) => m.id), ...modesForKind('vocab').map((m) => m.id)];

/** Which modes actually apply to this item — every vocab mode always does
 * (vocab.js's excludeForMode is always empty), but a handful of kanji (媛/
 * 栃/茨 and friends) have no reading any common word uses, so Yomi has
 * nothing to ask about them; see excludeForMode in kanji.js. */
function applicableStudyModes(course, char) {
  return modesForKind(course.kind).map((m) => m.id).filter((mode) => {
    const excluded = course.excludeForMode && course.excludeForMode[mode];
    return !excluded || !excluded.has(char);
  });
}

/** The three-state model from kanji-expansion-plan.md §1.2: not enrolled in
 * any applicable mode, enrolled but never taught in any of them, or enrolled
 * and on the schedule in at least one. */
function studyStatus(study, progress, char, modes) {
  const enrolled = modes.filter((mode) => isStudying(study, char, mode));
  if (enrolled.length === 0) return 'not-studying';
  const started = enrolled.some((mode) => !!progress[itemKey(mode, char)]);
  return started ? 'learning' : 'waiting';
}

/** Every applicable mode `char` is enrolled in but hasn't been taught in yet
 * — what "Study it now" (studyDetailCharNow below) actually has to offer. */
function pendingStudyModes(study, progress, char, modes) {
  return modes.filter((mode) => isStudying(study, char, mode) && !progress[itemKey(mode, char)]);
}

/**
 * Kanji and vocab both have a study list (kana doesn't — see the module note
 * above deriveStudyList in srs.js). The headline button is a bulk
 * convenience — enrolling turns on every applicable mode, un-enrolling turns
 * all of them off — sitting above independent per-mode toggles for fine
 * control (I want to write 龍 but don't care about its readings; I want
 * 電車's Meaning but not its Recall). Both act on the same underlying list,
 * so neither can leave the other looking wrong: toggling one mode by hand
 * always updates what the headline button says next.
 */
function renderDetailStudy(course, char) {
  $('detail-study').hidden = course.kind === 'kana';
  if (course.kind === 'kana') return;

  const { study, progress } = state.profile;
  const modes = applicableStudyModes(course, char);
  const status = studyStatus(study, progress, char, modes);
  const tier = masteryTier(progress[itemKey(state.mode, char)]);

  // One button, carrying both what's true and what tapping it does, rather
  // than this and the separate mastery line above both saying almost the
  // same thing in the same amount of space. Mastery only adds anything once
  // there's real progress in the mode currently being browsed; below that
  // it's just "waiting"/"not started", same as studyStatus already says.
  const toggle = $('detail-study-toggle');
  toggle.className = `btn wide${status === 'not-studying' ? ' btn-primary' : ''}`;
  toggle.textContent = status === 'not-studying'
    ? 'Not started — tap to start studying'
    : tier === 0
      ? 'Waiting to learn — tap to stop studying'
      : `${MASTERY_LABELS[tier]} — tap to stop studying`;

  STUDY_MODE_IDS.forEach((mode) => {
    const button = $(`detail-mode-${mode}`);
    button.hidden = !modes.includes(mode);
    if (!modes.includes(mode)) return; // modeName(mode, kind) needs a kind this mode actually belongs to
    button.textContent = modeName(mode, course.kind);
    button.className = `segment${isStudying(study, char, mode) ? ' active' : ''}`;
  });

  // Visible whenever ANY applicable mode is enrolled-but-untaught, not just
  // whichever mode the learner happens to be browsing under right now — a
  // per-mode toggle unrelated to state.mode (or even state.mode itself)
  // being switched off elsewhere on this same screen must never make this
  // disappear as a side effect. studyDetailCharNow() below picks the actual
  // mode to teach in from this same set.
  // ...but never while a quiz question is waiting behind this screen: it
  // starts a brand new session, which would throw away the one the learner
  // is standing in the middle of. Every other control here is safe, so only
  // this one is withheld. See openCharacterDetail()'s 'quiz' returnTo.
  $('detail-study-now').hidden = state.detailReturn === 'quiz'
    || pendingStudyModes(study, progress, char, modes).length === 0;
}

function toggleDetailStudy() {
  const course = getAnyCourse(state.detailCourseId);
  const char = state.detailChar;
  const { study, unstudy, progress } = state.profile;
  const modes = applicableStudyModes(course, char);
  const turnOn = studyStatus(study, progress, char, modes) === 'not-studying';
  modes.forEach((mode) => setStudying(study, unstudy, char, mode, turnOn));
  store.saveProfile(state.profile);
  renderDetailStudy(course, char);
}

function toggleDetailStudyMode(mode) {
  const course = getAnyCourse(state.detailCourseId);
  const char = state.detailChar;
  const { study, unstudy } = state.profile;
  setStudying(study, unstudy, char, mode, !isStudying(study, char, mode));
  store.saveProfile(state.profile);
  renderDetailStudy(course, char);
}

/** "Study it now" — see startSession()'s `items` parameter. Jumps straight
 * into a lesson-then-quiz session containing only this one character,
 * rather than waiting for "Add more" to reach it through whatever else
 * happens to be pending ahead of it in course order. Studies whichever
 * enrolled mode is actually pending: state.mode if that's one of them,
 * otherwise the first pending mode found — so this keeps working even after
 * the mode it was originally enrolled under gets toggled off elsewhere on
 * the same screen (see renderDetailStudy() above).
 */
function studyDetailCharNow() {
  const course = getAnyCourse(state.detailCourseId);
  const char = state.detailChar;
  const { study, progress } = state.profile;
  const pending = pendingStudyModes(study, progress, char, applicableStudyModes(course, char));
  if (pending.length === 0) return; // button should be hidden in this case
  if (!pending.includes(state.mode)) state.mode = pending[0];
  startSession(course.id, 'new', [char]);
}

/**
 * Every graded event and study-list addition for one character/word, across
 * every mode that applies to it, oldest first — the raw material for the
 * "My study history" screen (openStudyHistory/renderStudyHistory below).
 *
 * Most modes score straight into itemKey(mode, char) via grade(), which
 * keeps its own [timestamp, 0|1] history. Two don't, and need their real
 * records found elsewhere:
 *  - Kanji's Yomi (recognition) is scored per reading (yomiKey), so its
 *    events live on each of the kanji's quizzed readings' own records —
 *    itemKey('recognition', kanji) is a rollup recomputeKanjiRollup rebuilds
 *    from scratch on every answer and always leaves history: [].
 *  - Vocabulary's Meaning/Recall are themselves rollups of two sub-key
 *    records each (VOCAB_SUBKEYS) for the same reason.
 * "Added" events come from the study list's per-(char, mode) enrollment
 * timestamp; a bulk toggle enrolls every mode in the same instant, so those
 * collapse into one row rather than one per mode. Timestamp 0 is the legacy
 * "enrolled before this was tracked" sentinel (deriveStudyList/
 * migrateStudyShape) and carries no real date, so it's left out.
 */
function buildStudyHistory(course, char) {
  const { progress, study } = state.profile;
  const modes = applicableStudyModes(course, char);
  const events = [];

  const addFromRecord = (record, label) => {
    (record?.history || []).forEach(([ts, ok]) => {
      events.push({ ts, type: ok ? 'pass' : 'fail', label });
    });
  };

  modes.forEach((mode) => {
    if (course.kind === 'kanji' && mode === 'recognition') {
      kanjiInfo(course, char).quizReadings.forEach((reading) => {
        addFromRecord(progress[yomiKey('recognition', char, reading)], `Yomi — ${reading}`);
      });
    } else if (course.kind === 'vocab' && VOCAB_SUBKEYS[mode]) {
      VOCAB_SUBKEYS[mode].forEach((prefix) => {
        addFromRecord(progress[itemKey(prefix, char)], modeName(mode, course.kind));
      });
    } else {
      addFromRecord(progress[itemKey(mode, char)], modeName(mode, course.kind));
    }
  });

  if (study && study[char]) {
    const labelsByTs = new Map();
    modes.forEach((mode) => {
      const ts = study[char][mode];
      if (!ts) return; // absent, or the legacy 0 sentinel — no real date to show
      if (!labelsByTs.has(ts)) labelsByTs.set(ts, []);
      labelsByTs.get(ts).push(modeName(mode, course.kind));
    });
    labelsByTs.forEach((labels, ts) => events.push({ ts, type: 'added', label: labels.join(', ') }));
  }

  events.sort((a, b) => a.ts - b.ts);
  return events;
}

const STUDY_HISTORY_TYPE_LABEL = { added: 'Added', pass: 'Passed', fail: 'Failed' };

const DAY_MS = 24 * 60 * 60 * 1000;

/** Local-time calendar-day key, so "same day" groups the way a learner reads
 * their own timeline rather than by raw UTC offset. */
function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/**
 * A small time-axis SVG: one dot per event at its real date, coloured by
 * outcome. Events sharing a calendar day land at (nearly) the same x, so
 * they're additionally staggered in y within that day — otherwise a pass and
 * a fail on the same day would sit on top of one another. See the module
 * note on buildStudyHistory above for what an event actually is.
 */
function buildStudyHistorySVG(events) {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const W = 600;
  const H = 130;
  const PAD_X = 24;
  const AXIS_Y = H - 28;
  const LANE_GAP = 13;

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.classList.add('study-history-svg');

  let minTs = events[0].ts;
  let maxTs = events[events.length - 1].ts;
  if (minTs === maxTs) { minTs -= DAY_MS; maxTs += DAY_MS; }
  const x = (ts) => PAD_X + ((ts - minTs) / (maxTs - minTs)) * (W - PAD_X * 2);

  const axis = document.createElementNS(SVG_NS, 'line');
  axis.setAttribute('x1', PAD_X); axis.setAttribute('x2', W - PAD_X);
  axis.setAttribute('y1', AXIS_Y); axis.setAttribute('y2', AXIS_Y);
  axis.setAttribute('class', 'study-history-axis');
  svg.appendChild(axis);

  // A handful of evenly-spaced date labels along the axis, rather than one
  // per event — with weeks of daily reviews the latter would overlap into
  // an unreadable smear. Capped to the number of distinct days actually
  // spanned too, so a history barely a day old doesn't repeat "29 Aug" five
  // times over.
  const spanDays = Math.max(1, Math.round((maxTs - minTs) / DAY_MS));
  const TICKS = Math.max(2, Math.min(5, spanDays + 1));
  const fmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
  let lastLabel = null;
  for (let i = 0; i < TICKS; i += 1) {
    const ts = minTs + ((maxTs - minTs) * i) / (TICKS - 1);
    const text = fmt.format(ts);
    if (text === lastLabel) continue; // adjacent ticks landed on the same calendar day
    lastLabel = text;
    const tickX = x(ts);
    const tick = document.createElementNS(SVG_NS, 'line');
    tick.setAttribute('x1', tickX); tick.setAttribute('x2', tickX);
    tick.setAttribute('y1', AXIS_Y); tick.setAttribute('y2', AXIS_Y + 5);
    tick.setAttribute('class', 'study-history-axis');
    svg.appendChild(tick);
    const label = document.createElementNS(SVG_NS, 'text');
    label.setAttribute('x', tickX);
    label.setAttribute('y', AXIS_Y + 18);
    label.setAttribute('text-anchor', i === 0 ? 'start' : i === TICKS - 1 ? 'end' : 'middle');
    label.setAttribute('class', 'study-history-tick-label');
    label.textContent = text;
    svg.appendChild(label);
  }

  // Lane assignment: events sharing a day are laid out around a shared
  // centre, alternating above/below it (0, -1, +1, -2, +2, ...) so the group
  // grows outward from the axis rather than piling up on one side.
  const byDay = new Map();
  events.forEach((event) => {
    const key = dayKey(event.ts);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(event);
  });
  byDay.forEach((dayEvents) => {
    dayEvents.forEach((event, i) => {
      const lane = i % 2 === 0 ? -i / 2 : (i + 1) / 2;
      event.laneY = AXIS_Y - 14 + lane * LANE_GAP;
    });
  });

  events.forEach((event) => {
    const dot = document.createElementNS(SVG_NS, 'circle');
    dot.setAttribute('cx', x(event.ts));
    dot.setAttribute('cy', event.laneY);
    dot.setAttribute('r', event.type === 'added' ? 4 : 5);
    dot.setAttribute('class', `study-history-dot study-history-dot-${event.type}`);
    svg.appendChild(dot);
  });

  return svg;
}

/** List half of the timeline: one row per event, most recent first, date on
 * the left and the outcome (plus which mode) on the right. */
function renderStudyHistoryList(events) {
  const list = $('study-history-list');
  list.innerHTML = '';
  const dateFmt = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  [...events].reverse().forEach((event) => {
    const row = document.createElement('div');
    row.className = 'study-history-row';
    const date = document.createElement('span');
    date.className = 'study-history-row-date';
    date.textContent = dateFmt.format(event.ts);
    const result = document.createElement('span');
    result.className = `study-history-row-result study-history-row-${event.type}`;
    result.textContent = STUDY_HISTORY_TYPE_LABEL[event.type];
    const mode = document.createElement('span');
    mode.className = 'study-history-row-mode';
    mode.textContent = event.label;
    const right = document.createElement('span');
    right.className = 'study-history-row-right';
    right.appendChild(result);
    right.appendChild(mode);
    row.appendChild(date);
    row.appendChild(right);
    list.appendChild(row);
  });
}

function openStudyHistory() {
  renderStudyHistory();
  show('screen-study-history');
}

function renderStudyHistory() {
  const course = getAnyCourse(state.detailCourseId);
  const char = state.detailChar;
  $('study-history-glyph').textContent = char;
  const events = buildStudyHistory(course, char);

  const graph = $('study-history-graph');
  graph.innerHTML = '';
  const empty = events.length === 0;
  graph.hidden = empty;
  $('study-history-empty').hidden = !empty;
  if (!empty) graph.appendChild(buildStudyHistorySVG(events));

  renderStudyHistoryList(events);
}

function renderCharacterDetail() {
  const course = getAnyCourse(state.detailCourseId);
  const char = state.detailChar;
  const progress = state.profile.progress;
  const fromQuiz = state.detailReturn === 'quiz';

  // Opened mid-question, the bare "←" is genuinely ambiguous — it could
  // just as easily mean "quit the session". Spelling it out is the whole
  // point of letting a graded question expand into this screen.
  const back = $('detail-back');
  back.className = fromQuiz ? 'btn btn-back-text' : 'btn btn-icon';
  back.textContent = fromQuiz ? '← Back to test' : '←';
  back.setAttribute('aria-label', fromQuiz ? 'Back to test' : 'Back');

  // Reset to the kanji/kana sizing unconditionally — the vocab branch below
  // is the only one that ever changes this, via renderVocabWordGlyph(), and
  // nothing must inherit that once the learner backs out to a different
  // kind of item.
  $('detail-glyph').className = 'glyph glyph-lg';
  $('detail-glyph').textContent = char;

  // No stroke order for a whole word — vocab-plan.md §7 gives it kanji
  // chips instead (below), which is where "how do I write it" actually
  // belongs for something longer than one character.
  $('detail-stroke-wrap').hidden = course.kind === 'vocab';
  if (course.kind !== 'vocab') {
    const strokeContainer = $('detail-stroke');
    strokeContainer.innerHTML = '';
    const { svg, paths } = buildStrokeSVG(char);
    strokeContainer.appendChild(svg);
    const playButton = $('detail-play-strokes');
    playButton.hidden = paths.length === 0;
    playButton.onclick = () => animateStrokes(paths);
  }

  // Which unit this item is taught in — resolved from the manifest rather
  // than trusting `course` itself, since a detail screen opened from one of
  // the cross-unit review/learn pools (studyListPool, vocabStudyPool and
  // friends, which have no unit of their own) would otherwise show that
  // pool's name instead of the item's real unit.
  $('detail-unit').hidden = course.kind === 'kana';
  if (course.kind === 'kanji') {
    const unit = kanjiUnitFor(char);
    $('detail-unit').textContent = unit ? unitLabel(unit) : '';
  } else if (course.kind === 'vocab') {
    const unit = vocabUnitFor(char);
    $('detail-unit').textContent = unit ? `${vocabUnitGroupLabel(unit)} · ${vocabUnitLabel(unit)}` : '';
  }

  // Kanji and vocab both fold mastery into the single study-status button
  // below instead — see renderDetailStudy(). Kana has no study list, so this
  // stays its own line, same as ever.
  if (course.kind === 'kanji' || course.kind === 'vocab') {
    $('detail-mastery').hidden = true;
  } else {
    const tier = masteryTier(progress[itemKey(state.mode, char)]);
    $('detail-mastery').hidden = false;
    $('detail-mastery').textContent = MASTERY_LABELS[tier];
    $('detail-mastery').className = `mastery-label tier-${tier}`;
  }

  renderDetailStudy(course, char);

  if (course.kind === 'kanji') {
    const info = kanjiInfo(course, char);
    $('detail-romaji').hidden = true;
    $('detail-pronunciation').hidden = true;
    $('detail-readings').hidden = false;
    renderReadingChips($('detail-readings'), $('detail-word'), course, char, info, drillIntoDetail);
    renderExposureSummary(char, info);
    $('detail-meanings').hidden = false;
    $('detail-meanings').textContent = info.meanings.join(', ');
    $('detail-word').hidden = true;
    $('detail-word').innerHTML = '';
    $('detail-word-kanji').hidden = true;
    $('detail-example').hidden = true;
    renderGeneralWords(info.words);
  } else if (course.kind === 'vocab') {
    const info = vocabInfo(course, char);
    renderVocabWordGlyph($('detail-glyph'), info);
    // The furigana above already gives the reading in kana; romaji and,
    // where it differs, the actual pronunciation (こんにちは spells as
    // "konnichiha" but is said "konnichiwa") are the two things a learner
    // can't get from the kana alone — same pair the lesson card shows
    // (renderLesson()'s lesson-romaji/lesson-pronunciation), shown openly
    // here too since this screen has no reveal ladder to protect.
    $('detail-romaji').hidden = false;
    $('detail-romaji').textContent = toRomaji(info.r);
    const pronunciation = pronunciationFor(info.r);
    $('detail-pronunciation').hidden = !pronunciation;
    $('detail-pronunciation').textContent = pronunciation ? `said: ${pronunciation}` : '';
    $('detail-readings').hidden = true;
    $('detail-readings').innerHTML = '';
    $('detail-exposure').hidden = true;
    $('detail-meanings').hidden = false;
    $('detail-meanings').textContent = wordGlossSummary(info);
    $('detail-word').hidden = true;
    $('detail-word').innerHTML = '';
    renderWordKanjiChips(info);
    renderWordExamples(info);
    $('detail-general-words').hidden = true;
  } else {
    $('detail-word-kanji').hidden = true;
    $('detail-romaji').hidden = false;
    $('detail-romaji').textContent = romajiFor(char);
    $('detail-pronunciation').hidden = true;
    $('detail-readings').hidden = true;
    $('detail-readings').innerHTML = '';
    $('detail-exposure').hidden = true;
    $('detail-meanings').hidden = true;
    $('detail-word').hidden = true;
    $('detail-example').hidden = true;
    $('detail-general-words').hidden = true;
  }

  show('screen-character-detail');
}

/**
 * A word's own kanji, as tappable chips into the EXISTING kanji detail
 * screen (vocab-plan.md §7 — "the piece that makes the two halves of the
 * app one app rather than two"). One chip per unique kanji in the surface
 * form, in the order they appear; a kana-only word (uk, or plain hiragana/
 * katakana) has none, and the container hides.
 *
 * Shared by the word detail screen and the vocabulary lesson card, which
 * differ only in where Back should land — hence `open` rather than a
 * hardcoded navigation (drillIntoDetail vs openFromLesson above).
 */
function fillWordKanjiChips(containerEl, surface, open) {
  containerEl.innerHTML = '';
  // Only kanji the app actually teaches: a chip for one outside the
  // curriculum would have no detail screen to open and just sit there dead.
  const chars = [...new Set([...surface])].filter((ch) => isKanjiChar(ch) && kanjiCourseFor(ch));
  chars.forEach((kanji) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'reading-chip';
    chip.textContent = kanji;
    chip.setAttribute('aria-label', `Open the kanji ${kanji}`);
    chip.addEventListener('click', () => open(kanjiCourseFor(kanji), kanji));
    containerEl.appendChild(chip);
  });
  containerEl.hidden = chars.length === 0;
}

function renderWordKanjiChips(info) {
  fillWordKanjiChips($('detail-word-kanji'), info.w, drillIntoDetail);
}

/**
 * Opens another item's detail screen ON TOP of the one currently showing,
 * so the back button returns HERE rather than to wherever this screen was
 * itself opened from.
 *
 * This started life (vocab-plan.md §7) as one remembered frame — a vocab
 * word's kanji chips were the only way to reach a detail screen from
 * another one, so "back to the word" only ever needed one level. It is a
 * real stack now because drilling in is offered nearly everywhere a word or
 * kanji appears: 電 → the word 電車 → its kanji 車 → a word of 車's → … is
 * an ordinary path, and a single frame would have 車 sending you back to
 * 電車 forever instead of unwinding. See the 'stack' case in detail-back
 * (wire()), which pops one frame per press.
 */
function drillIntoDetail(course, char) {
  state.detailStack.push({
    courseId: state.detailCourseId, char: state.detailChar, returnTo: state.detailReturn,
  });
  openCharacterDetail(course, char, 'stack');
}

/**
 * Drilling in from the LESSON card, which is not a detail screen and so has
 * no frame to stack: the session is left exactly as it is and 'detail-back'
 * simply re-shows it, the same trick the quiz's own "Full details" already
 * uses ('quiz' returnTo) to survive a trip away and back. Teaching, not
 * testing — a word shown to be learned from is precisely where wanting to
 * look closer at one of its kanji is reasonable.
 */
function openFromLesson(course, item) {
  openCharacterDetail(course, item, 'lesson');
}

/** The vocab course a word id belongs to, or null — vocabUnitFor() only
 * gives the unit string, same two-step lookup kanji.js's own
 * kanjiUnitFor -> KANJI_COURSES.find() pairing already uses. */
function vocabCourseForId(id) {
  const unit = vocabUnitFor(id);
  return unit ? VOCAB_COURSES.find((c) => c.unit === unit) : null;
}

// --- Drilling into a word, and into the kanji inside it --------------------
//
// The rule everywhere outside a live question: if you can see a word or a
// kanji, you can tap it and get somewhere useful. Two levels, because a word
// made of kanji is genuinely two things at once and guessing which one was
// meant would be wrong half the time:
//
//   tap the word   -> it opens a tray: its own kanji as separate chips, a way
//                     through to its full detail screen, and a one-tap add to
//                     the vocabulary study list
//   tap a chip     -> that kanji's own detail screen
//
// The "Add" badge stays on the row itself rather than moving into the tray,
// so adding a word you already recognise is still one tap and never needs
// the tray opened at all.
//
// Deliberately NOT applied while a question is live: the quiz's own answer
// panel and the writing screen's prompt panel both show a word as part of
// the thing being asked (the writing one is even deliberately masked), and
// both already offer "Full details" once the answer is in. See renderWord(),
// which stays the plain presentational renderer those two use.

/** The vocab curriculum entry for one of kanji.js's own JMdict-derived
 * words, or null when that word isn't taught here at all — the two lists
 * are built independently and kanji.js's is much the wider of the two
 * (vocab-plan.md §3.5), so most common words have no vocab entry. */
function vocabTargetForWord(word) {
  const id = vocabIdForWord(word.kanji, word.kana);
  if (!id) return null;
  const course = vocabCourseForId(id);
  return course ? { id, course } : null;
}

/** Definitions behind the two register badges buildRegisterBadges() renders —
 * shared so the icon and its tap-to-explain popover always agree. */
const WORD_REGISTER_BADGES = [
  ['spoken', '🗣️', 'Spoken', 'Common in everyday conversation.'],
  ['written', '🖊️', 'Written', 'Common in newspapers and other formal writing.'],
];

/** The one register-badge popover open at a time, or null — module-level
 * since only one can ever be open regardless of which word row it's for. */
let openRegisterPopover = null;

function closeRegisterPopover() {
  if (!openRegisterPopover) return;
  document.removeEventListener('click', openRegisterPopover.onOutsideClick);
  window.removeEventListener('scroll', openRegisterPopover.onOutsideClick, true);
  openRegisterPopover.el.remove();
  openRegisterPopover = null;
}

/**
 * A speech-bubble popover anchored to `badge`, appended to <body> (so it
 * floats above everything — the row it lives in may be mid-list, inside a
 * scrolling section, anywhere) with a tail pointing back at the badge that
 * opened it. `position: fixed` throughout, so no ancestor scroll offset
 * needs accounting for — only the badge's own viewport rect.
 *
 * Dismissal is a single outside click/scroll listener, added AFTER this
 * click finishes (the badge's own handler below stops propagation, so the
 * very click that opens this one can never immediately close it): tapping
 * anywhere else closes it and, because nothing here calls
 * preventDefault/stopPropagation, still lets that tap's own effect happen
 * (opening another popover, adding a word, following a link) — tapping the
 * popover itself or empty space closes it with nothing else to do, since
 * neither has any handler of its own.
 */
function openRegisterPopoverFor(badge, label, text) {
  const bubble = document.createElement('div');
  bubble.className = 'word-reg-popover';
  bubble.setAttribute('role', 'tooltip');
  bubble.textContent = `${label} — ${text}`;
  const tail = document.createElement('span');
  tail.className = 'word-reg-popover-tail';
  bubble.appendChild(tail);
  document.body.appendChild(bubble);

  const margin = 8;
  const gap = 8;
  const badgeRect = badge.getBoundingClientRect();
  const above = badgeRect.top > bubble.offsetHeight + gap + margin;
  let top = above ? badgeRect.top - bubble.offsetHeight - gap : badgeRect.bottom + gap;
  top = Math.max(margin, Math.min(top, window.innerHeight - bubble.offsetHeight - margin));
  const badgeCenterX = badgeRect.left + badgeRect.width / 2;
  const left = Math.max(margin, Math.min(
    badgeCenterX - bubble.offsetWidth / 2, window.innerWidth - bubble.offsetWidth - margin,
  ));
  bubble.style.top = `${top}px`;
  bubble.style.left = `${left}px`;
  bubble.classList.add(above ? 'tail-bottom' : 'tail-top');
  tail.style.left = `${Math.max(10, Math.min(badgeCenterX - left - 5, bubble.offsetWidth - 20))}px`;

  const onOutsideClick = () => closeRegisterPopover();
  document.addEventListener('click', onOutsideClick);
  window.addEventListener('scroll', onOutsideClick, true);
  openRegisterPopover = { el: bubble, badge, onOutsideClick };
}

/**
 * Small icons noting which register(s) a word is common in — from the
 * `written`/`spoken` flags build_kanji_data.py's choose_examples() computes
 * per word (see written_band/spoken_signal there). Absent on any word not
 * built by that script (vocab lookups, EXAMPLE_WORDS, ...), so this quietly
 * renders nothing for those rather than needing a separate code path.
 *
 * A badge already the popover's owner toggles it closed on a second tap
 * rather than closing-then-reopening its own popover — otherwise a repeat
 * tap on the very icon that opened it would look like nothing happened.
 */
function buildRegisterBadges(word) {
  const defs = WORD_REGISTER_BADGES.filter(([key]) => word[key]);
  if (!defs.length) return null;

  const wrap = document.createElement('div');
  wrap.className = 'word-reg-badges';

  defs.forEach(([, icon, label, text]) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'word-reg-badge';
    btn.textContent = icon;
    btn.setAttribute('aria-label', `${label}: ${text}`);
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      const wasOwner = openRegisterPopover && openRegisterPopover.badge === btn;
      closeRegisterPopover();
      if (!wasOwner) openRegisterPopoverFor(btn, label, text);
    });
    wrap.appendChild(btn);
  });
  return wrap;
}

/**
 * One tappable word. `open(course, item)` is how this surface navigates —
 * drillIntoDetail() from another detail screen, a plain openCharacterDetail
 * with the right `returnTo` from anywhere else — and `rerender` is called
 * after an add, so the caller can redraw whatever list this row is part of
 * and flip the badge to "Studying".
 *
 * A word with nothing to offer (no taught kanji AND no vocab entry) is
 * returned as an inert row rather than a button that opens an empty tray.
 */
function buildWordRow(word, open, rerender) {
  const target = vocabTargetForWord(word);
  const modes = target ? applicableStudyModes(target.course, target.id) : [];
  const added = modes.length > 0 && modes.every((mode) => isStudying(state.profile.study, target.id, mode));
  // Only kanji the app actually teaches — a word's surface can contain one
  // outside the curriculum, which has no detail screen to open.
  const kanjiChars = [...new Set([...word.kanji])].filter((ch) => isKanjiChar(ch) && kanjiCourseFor(ch));
  const interactive = kanjiChars.length > 0 || target !== null;

  const row = document.createElement('div');
  row.className = `word-row${added ? ' is-added' : ''}`;

  const line = document.createElement('div');
  line.className = 'word-line';
  row.appendChild(line);

  const main = document.createElement(interactive ? 'button' : 'div');
  main.className = 'kanji-word word-main';
  if (interactive) {
    main.type = 'button';
    main.setAttribute('aria-expanded', 'false');
  }
  renderWord(main, word);
  line.appendChild(main);

  const registerBadges = buildRegisterBadges(word);
  if (registerBadges) line.appendChild(registerBadges);

  // One-tap add, kept out of the tray so it works without opening it. A word
  // already being studied shows the same badge as a plain label instead —
  // un-enrolling belongs on the word's own detail screen, next to the rest
  // of its per-mode toggles, not on a one-line row in someone else's list.
  if (modes.length > 0) {
    const badge = document.createElement(added ? 'span' : 'button');
    badge.className = 'word-add-badge';
    badge.textContent = added ? 'Studying' : 'Add';
    if (!added) {
      badge.type = 'button';
      badge.setAttribute('aria-label', `Add ${word.kanji} to the vocabulary study list`);
      badge.addEventListener('click', () => {
        const { study, unstudy } = state.profile;
        modes.forEach((mode) => setStudying(study, unstudy, target.id, mode, true));
        store.saveProfile(state.profile);
        rerender();
      });
    }
    line.appendChild(badge);
  }

  if (!interactive) return row;

  const tray = document.createElement('div');
  tray.className = 'word-tray';
  tray.hidden = true;

  kanjiChars.forEach((kanji) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'reading-chip reading-chip-sm';
    chip.textContent = kanji;
    chip.setAttribute('aria-label', `Open the kanji ${kanji}`);
    chip.addEventListener('click', () => open(kanjiCourseFor(kanji), kanji));
    tray.appendChild(chip);
  });

  if (target) {
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'btn btn-quiet word-more';
    more.textContent = 'Word details ›';
    more.addEventListener('click', () => open(target.course, target.id));
    tray.appendChild(more);
  } else {
    // Said out loud rather than left as a silently missing button: the
    // learner has just been offered "Add" on the row above this one and
    // needs to know why this word doesn't get the same.
    const note = document.createElement('p');
    note.className = 'hint word-note';
    note.textContent = 'Not part of the vocabulary course — tap a kanji instead.';
    tray.appendChild(note);
  }

  row.appendChild(tray);
  main.addEventListener('click', () => {
    const open_ = tray.hidden;
    tray.hidden = !open_;
    main.setAttribute('aria-expanded', open_ ? 'true' : 'false');
    row.classList.toggle('is-open', open_);
  });
  return row;
}

/**
 * Kanji detail's own "Common words" list — every word JMdict associates with
 * this kanji, from kanji.js's own list (built independently of vocab.js's
 * separate, smaller frequency-based curriculum — see vocab-plan.md §3.5).
 *
 * Every row is a drillable word (buildWordRow above): tap it for its kanji
 * and, where the word is taught here too, a way through to its own detail
 * screen; the "Add" badge on the row still enrolls in one tap without
 * opening anything. This is a shortcut into the same study list that word's
 * own detail screen writes to, not a separate one, so it needs no state
 * beyond study/unstudy.
 */
function renderGeneralWords(words) {
  const section = $('detail-general-words');
  const list = $('detail-general-words-list');
  list.innerHTML = '';
  if (!words.length) {
    section.hidden = true;
    return;
  }
  words.forEach((word) => {
    list.appendChild(buildWordRow(word, drillIntoDetail, () => renderGeneralWords(words)));
  });
  section.hidden = false;
}

// --- Session --------------------------------------------------------------

/**
 * `items`, when given, bypasses course order and the enrollment top-up below
 * entirely: exactly those items are taught and quizzed, nothing more, in the
 * order given. This is "Study it now" from the detail screen (see
 * studyDetailCharNow below, and kanji-expansion-plan.md §2.6) — a kanji just
 * added by hand shouldn't have to wait for "Add more" to work through
 * whatever else was already pending ahead of it in course order. The caller
 * is responsible for `items` already being enrolled; this only teaches and
 * quizzes.
 *
 * `skipLesson` drops the lesson step even when `items` is given — for
 * "Practise N missed" (finishSession() below): those characters were
 * already taught, either moments ago in the same session's own lesson step
 * or long before, so showing a "here's a new character" card for them again
 * would be redundant. Placement-test misses are the one case that still
 * wants the lesson step (they were never taught at all — the placement quiz
 * skips straight past it), so that caller leaves this false.
 *
 * `carriedResults`, also for "Practise N missed": the summary being left
 * behind's full (right + wrong) result set, so THIS session's own finish
 * can show the whole picture merged with whatever happens now, rather than
 * just this small practice round in isolation. See finishSession().
 */
async function startSession(courseId, kind, items, { skipLesson = false, carriedResults } = {}) {
  const requestNav = navSeq;
  state.courseId = courseId;
  state.kind = kind;
  const course = getAnyCourse(courseId);
  const profile = state.profile;
  const { settings } = profile;

  let built;
  if (items) {
    built = { lesson: skipLesson ? [] : items, quiz: items };
  } else {
    // "Add more" is now two steps: enroll the next few kanji in the study
    // list, then teach whatever is waiting. Anything added by hand from the
    // detail screen is already waiting, so it gets taught first and this
    // tops up from course order only if there is room left. Kana have no
    // study list, so enrollNext is a no-op there and `new` keeps meaning
    // "next never-seen".
    // 'placement' ("Test unlearned") deliberately enrolls NOTHING here,
    // unlike 'new' — buildSession's 'placement' branch quizzes every
    // never-seen item in the unit regardless of enrollment, and each one is
    // only enrolled lazily, the moment it's actually attempted (see
    // ensurePlacementEnrolled). Enrolling the whole batch upfront, the way
    // 'new' does, would mean quitting after one kanji left every other
    // untouched kanji in the unit marked "waiting to learn" — exactly the
    // bug this avoids.
    if (kind === 'new') {
      const waiting = newItems(course, state.mode, profile, settings.newPerSession).length;
      if (waiting < settings.newPerSession) {
        enrollNext(course, state.mode, profile, settings.newPerSession - waiting);
        store.saveProfile(profile);
      }
    }
    built = buildSession(course, state.mode, profile, kind, {
      newPerSession: settings.newPerSession,
      maxReviews: settings.maxReviews,
    });
  }

  if (built.lesson.length === 0 && built.quiz.length === 0) {
    renderCourse();
    return;
  }

  // The item list can span several grades — the "everything I'm studying"
  // pool (§2.4) is the whole study list, not one grade — so every grade
  // actually touched gets loaded, not just course.unit (which for that pool
  // doesn't even exist as a single grade). Kana courses have no kanji items,
  // so kanjiUnitFor returns null for all of them and this is a no-op.
  //
  // A vocab session's items are word ids, not characters — kanjiUnitFor
  // returns null for every one of them, so they need their own lookup
  // (vocabUnitFor) and their own loader (ensureVocabUnitLoaded). The two
  // never collide (a kanji unit id and a vocab unit id are never equal —
  // "1".."9-6" vs "C1".."5.4"), so both can run off the same combined item
  // list without needing to know which course kind produced which item.
  const sessionItems = [...built.lesson, ...built.quiz];
  const units = new Set(sessionItems.map(kanjiUnitFor).filter(Boolean));
  const vocabUnits = new Set(sessionItems.map(vocabUnitFor).filter(Boolean));
  if (units.size || vocabUnits.size) {
    await withLoading(Promise.all([
      ensureUnitsReady(units),
      ...[...vocabUnits].map(ensureVocabUnitLoaded),
    ]));
  }
  // The user may have navigated elsewhere while this was loading — only the
  // most recent request should ever commit a session and render it.
  if (navSeq !== requestNav) return;

  const writingModePref = settings.writingModePreference;

  state.session = {
    lesson: built.lesson,
    lessonIndex: 0,
    queue: built.quiz,
    position: 0,
    total: built.quiz.length,
    results: new Map(), // kana -> true/false (first attempt, THIS session only)
    carriedResults, // prior summary's full result set to merge with, or undefined
    // Exposure keys already recorded THIS session (vocab-plan.md §5.3's
    // "at most one per session per (kanji, reading)") — meeting 電車 five
    // times in one sitting is one encounter with 電:でん, not five.
    vocabExposed: new Set(),
    // "Unlearned kanji test": a correct first answer jumps straight to the
    // top box instead of climbing one at a time — see grade()'s `placement`
    // option in srs.js and recordResult()/recordYomiResult() below.
    placementTest: kind === 'placement',
    // Writing only: null means each question picks Trace/Guided/Free itself
    // from that character's own mastery (autoWritingMode in srs.js) —
    // "Dynamic" on the course-screen picker. A fixed preference chosen there
    // (writingModePreference in profile.settings) seeds this instead, so it
    // applies from the very first character of the session, not just from
    // whenever the in-session toggle is first touched. Touching the toggle
    // (or a difficulty-ladder button) mid-session also sets this and it
    // sticks for the rest of THIS session — see writingSetSubMode() below —
    // but that's session-only and does not itself change the persisted
    // preference; only the course-screen picker does that.
    //
    // A placement test overrides even a fixed Trace/Guided preference to
    // Free: Trace shows the whole character before a stroke is drawn and
    // Guided reveals each stroke the moment it's accepted, both of which
    // directly contradict "without being shown the answers first" — Free's
    // no-guide-until-self-graded is the only sub-mode that actually tests
    // blind. The learner can still switch away mid-attempt via the ordinary
    // toggle if they want to.
    writingModeOverride: kind === 'placement'
      ? 'free'
      : (writingModePref && writingModePref !== 'dynamic' ? writingModePref : null),
    // Derived fresh per question in renderWritingQuestion() below; only
    // initialized here so it has a sane value before the first question
    // renders.
    writingSubMode: 'trace',
  };

  if (built.lesson.length) renderLesson();
  else startQuiz();
}

function renderLesson() {
  const session = state.session;
  const item = session.lesson[session.lessonIndex];
  const course = getAnyCourse(state.courseId);

  $('lesson-kana').textContent = item;
  $('lesson-counter').textContent = `${session.lessonIndex + 1}/${session.lesson.length}`;
  $('lesson-next').textContent = session.lessonIndex === session.lesson.length - 1 ? 'Start quiz' : 'Next';

  $('lesson-pronunciation').hidden = true;

  if (course.kind === 'kanji') {
    const info = kanjiInfo(course, item);
    $('lesson-kana').className = 'glyph glyph-xl';
    $('lesson-romaji').hidden = true;
    // Only the readings that are actually quizzed are taught — showing the
    // full KANJIDIC list would include readings no common word ever uses.
    // Each one is tappable, same as after answering a Yomi question, since
    // seeing the word a rare reading actually comes from is exactly what
    // makes it stick on a first encounter, not just at review time.
    $('lesson-readings').hidden = false;
    renderReadingChips($('lesson-readings'), $('lesson-word'), course, item, info, openFromLesson);
    $('lesson-meanings').hidden = false;
    $('lesson-meanings').textContent = info.meanings.join(', ');
    $('lesson-word').hidden = true;
    $('lesson-word').innerHTML = '';
    $('lesson-hint').textContent = state.mode === 'definition'
      ? 'Remember what it means — the quiz asks you to pick the meaning.'
      : 'Tap a reading to see a word that uses it.';
  } else if (course.kind === 'vocab') {
    const info = vocabInfo(course, item);
    // Teaching, not testing — the reveal ladder's hiding rule (§5.2) has no
    // place here; every reading is shown openly, the same way a kanji's
    // full reading list is on its own lesson card just above.
    renderVocabWordGlyph($('lesson-kana'), info);
    $('lesson-romaji').hidden = false;
    $('lesson-romaji').textContent = toRomaji(info.r);
    // Only shown when it genuinely differs from the romaji above — see
    // pronunciationFor()'s module note in vocab.js (こんばんは vs "konbanha",
    // long vowels needing a macron rather than a doubled letter).
    const pronunciation = pronunciationFor(info.r);
    $('lesson-pronunciation').hidden = !pronunciation;
    $('lesson-pronunciation').textContent = pronunciation ? `said: ${pronunciation}` : '';
    // A word being TAUGHT is exactly where its kanji are worth a closer
    // look, so the chip row a kanji lesson uses for its readings carries
    // this word's own kanji instead — same chips as the word detail screen
    // (§7), reaching the same place. Teaching, not testing: the session is
    // untouched and Back returns straight to this card (openFromLesson).
    fillWordKanjiChips($('lesson-readings'), info.w, openFromLesson);
    $('lesson-meanings').hidden = false;
    $('lesson-meanings').textContent = wordGlossSummary(info);
    $('lesson-word').hidden = true;
    $('lesson-word').innerHTML = '';
    $('lesson-hint').textContent = state.mode === 'vrecall'
      ? "Remember the word — the quiz gives you the English and asks you to pick it out in Japanese."
      : 'Remember what it means — the quiz asks you to pick the meaning.';
  } else {
    $('lesson-kana').className = 'glyph glyph-xl';
    $('lesson-romaji').hidden = false;
    $('lesson-romaji').textContent = romajiFor(item);
    $('lesson-readings').hidden = true;
    $('lesson-readings').innerHTML = '';
    $('lesson-meanings').hidden = true;
    $('lesson-word').hidden = true;
    $('lesson-hint').textContent = "Say it out loud, then remember it — it's coming up in the quiz.";
  }

  // Writing mode: watch the stroke order drawn in, on repeat, before being
  // quizzed on it — introducing a brand-new character is exactly when
  // watching it more than once actually helps. Same SVG builder as the
  // character-detail screen (which stays one-shot, triggered by its own
  // Play button, not looped — that one is on-demand review, not an intro).
  stopLessonStrokeLoop();
  const strokeWrap = $('lesson-stroke-wrap');
  strokeWrap.hidden = state.mode !== 'writing';
  if (state.mode === 'writing') {
    const strokeContainer = $('lesson-stroke');
    strokeContainer.innerHTML = '';
    const { svg, paths } = buildStrokeSVG(item);
    strokeContainer.appendChild(svg);
    lessonStrokeLoopStop = animateStrokes(paths, { loop: true });
    $('lesson-hint').textContent = "Watch how it's drawn — you'll trace it in the quiz.";
  }

  show('screen-lesson');
}

/**
 * Tappable reading chips wired to reveal an example word — the same
 * interaction on the lesson card, the character detail screen, and (via its
 * own click handler in the quiz code) after a Yomi question resolves. Shared
 * here rather than duplicated per screen: same data, same behaviour, only
 * the target elements differ.
 */
function renderReadingChips(containerEl, wordEl, course, kanji, info, open) {
  containerEl.innerHTML = '';
  const { exposure } = state.profile;
  info.quizReadings.forEach((reading) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    const exposed = isExposurePromoted(exposure, exposureKanjiKey(kanji, reading));
    chip.className = `reading-chip${exposed ? ' is-exposed' : ''}`;
    chip.textContent = formatReading(info, reading);
    chip.dataset.reading = reading;
    if (exposed) chip.title = 'Seen often enough in words to hide its furigana by default';
    chip.addEventListener('click', () => showChipReadingExample(containerEl, wordEl, course, kanji, reading, chip, open));
    containerEl.appendChild(chip);
  });
}

/** "seen 6x in words" (vocab-plan.md §5.3) — the total exposure count summed
 * across every reading this kanji actually quizzes, shown only once there is
 * something to show. The per-chip marker above says WHICH reading; this
 * line is the one place the raw count is visible at all. */
function renderExposureSummary(kanji, info) {
  const { exposure } = state.profile;
  const total = info.quizReadings.reduce((sum, reading) => sum + exposureCount(exposure, exposureKanjiKey(kanji, reading)), 0);
  const el = $('detail-exposure');
  el.hidden = total === 0;
  if (total > 0) el.textContent = `Seen ${total}× in words`;
}

/**
 * Fills a word slot with one drillable row (buildWordRow), re-rendering
 * itself in place when the word's study state changes so the "Add" badge
 * flips to "Studying" without redrawing the screen around it.
 */
function showWordInSlot(wordEl, word, open) {
  wordEl.innerHTML = '';
  wordEl.appendChild(buildWordRow(word, open, () => showWordInSlot(wordEl, word, open)));
}

function showChipReadingExample(containerEl, wordEl, course, kanji, reading, chip, open) {
  const wasActive = chip.classList.contains('is-active');
  containerEl.querySelectorAll('.reading-chip').forEach((el) => el.classList.remove('is-active'));
  if (wasActive) {
    // Tapping the already-selected chip again unselects it, rather than
    // just re-showing the same example word.
    wordEl.hidden = true;
    wordEl.innerHTML = '';
    return;
  }
  chip.classList.add('is-active');

  const example = readingExample(course, kanji, reading);
  if (example) {
    showWordInSlot(wordEl, example, open);
  } else {
    wordEl.innerHTML = '';
    wordEl.textContent = `No common example word found for ${reading}.`;
  }
  wordEl.hidden = false;
}

function advanceLesson() {
  const session = state.session;
  session.lessonIndex += 1;
  if (session.lessonIndex >= session.lesson.length) startQuiz();
  else renderLesson();
}

function startQuiz() {
  stopLessonStrokeLoop(); // leaving the lesson screen — nothing left to loop
  show(state.mode === 'writing' ? 'screen-writing' : 'screen-quiz');
  renderQuestion();
}

/**
 * How many questions in this session are genuinely finished. A miss no
 * longer comes back later in the queue (see chooseAnswer()/
 * markKanjiError()) — every character is answered exactly once, right or
 * wrong — so `session.position` alone is always the count of resolved
 * questions; nothing about a miss needs special-casing here.
 */
function sessionProgress(session) {
  return { done: session.position, total: session.total };
}

function renderQuestion() {
  const session = state.session;
  if (session.position >= session.queue.length) {
    finishSession();
    return;
  }
  const item = session.queue[session.position];
  const course = getAnyCourse(state.courseId);

  if (state.mode === 'writing') {
    renderWritingQuestion(course, item);
    return;
  }

  // A vocab word can run to several characters, unlike every other kind of
  // prompt this screen shows — glyph-vocab is sized (and allowed to wrap)
  // for that; see the CSS comment there. Recall's prod stage overrides both
  // the class and textContent itself (its prompt is English, not `item`) —
  // set here first anyway so every OTHER mode need not repeat this line, and
  // `lang` is reset to 'ja' here for the same reason: Recall's prod stage is
  // the only one that ever sets it to 'en', and nothing else must inherit
  // that once the learner moves on to a different question.
  $('quiz-kana').className = `glyph ${course.kind === 'vocab' ? 'glyph-vocab' : 'glyph-xl'}`;
  $('quiz-kana').lang = 'ja';
  $('quiz-kana').textContent = item;
  $('quiz-prompt-hint').hidden = true;
  $('quiz-prompt-pronunciation').hidden = true;
  $('quiz-hide-furigana').hidden = true;
  $('quiz-feedback').textContent = '';
  $('quiz-feedback').className = 'feedback';
  $('quiz-card').className = 'quiz-card';
  $('quiz-info').hidden = true;
  $('quiz-back-previous').hidden = !(session.placementTest && session.position > 0);
  session.locked = false;

  const choices = $('quiz-choices');
  choices.innerHTML = '';

  // Yomi on a kanji is the only multi-answer quiz; kana reading and kanji
  // definition are both "one right option out of ten".
  if (course.kind === 'vocab' && state.mode === 'vmeaning') renderVocabMeaningQuestion(course, item);
  else if (course.kind === 'vocab' && state.mode === 'vrecall') renderVocabRecallQuestion(course, item);
  else if (course.kind === 'kanji' && state.mode === 'recognition') renderKanjiChoices(course, item);
  else renderSingleChoice(course, item);

  const { done, total } = sessionProgress(session);
  $('quiz-counter').textContent = `${Math.min(done + 1, total)}/${total}`;
  $('quiz-progress').style.width = `${(done / Math.max(total, 1)) * 100}%`;
}

// --- Single answer (kana reading, kanji definition): tap once, grades
// --- instantly -------------------------------------------------------

function renderSingleChoice(course, item) {
  const session = state.session;
  session.attempt = 0;
  $('quiz-ok').hidden = true;
  $('quiz-kanji-actions').hidden = true;

  const isDefinition = state.mode === 'definition';
  const { options, answer } = isDefinition
    ? buildDefinitionChoices(course, item)
    : { options: buildChoices(course, item), answer: romajiFor(item) };
  session.singleAnswer = answer;

  const choices = $('quiz-choices');
  // English definitions are far longer than romaji, so they get a roomier
  // two-column layout instead of the five-across kana grid.
  choices.className = isDefinition ? 'choice-grid choice-grid-text' : 'choice-grid';
  options.forEach((value) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'choice';
    button.textContent = value;
    button.dataset.value = value;
    button.addEventListener('click', () => chooseAnswer(value, button));
    choices.appendChild(button);
  });
}

/**
 * A wrong tap gets one more try rather than immediately revealing the
 * answer: the button turns red and is disabled, and a second, different tap
 * is expected. The grade (and the item's pass/fail record) is always locked
 * to the *first* attempt, though — a correct recovery on attempt two still
 * counts as a miss for spaced repetition, per the request that a retry not
 * launder the original wrong answer out of the record.
 *
 * A resolved question (right, or wrong-out-of-chances) never auto-advances —
 * the feedback stays up until the learner presses Next (the button, or the
 * Enter key on a real keyboard — see the keydown handler in wire()) to move
 * on themselves. This used to auto-advance on a timer (550ms right, 2600ms
 * wrong); Yomi mode and Writing mode never did, and kana/definition now
 * matches them instead of being the odd one out — a right/wrong result
 * flashing past on its own gives no chance to actually register it, which
 * was the reported complaint. A tap anywhere ELSE on the quiz screen used
 * to count as Next too; it no longer does, because it made it far too easy
 * to skip past the answer panel with a stray tap without meaning to.
 */
function chooseAnswer(value, button) {
  const session = state.session;
  // session.locked is set the moment a question resolves, so nothing here
  // can re-grade a question that is already sitting on its Next button.
  if (!session || session.locked || button.disabled) return;

  const item = session.queue[session.position];
  const answer = session.singleAnswer;
  const correct = value === answer;
  session.attempt += 1;

  if (session.attempt === 1) {
    recordResult(item, correct);
  }

  if (correct) {
    button.classList.add('is-right');
    $('quiz-card').className = 'quiz-card is-correct';
    $('quiz-feedback').className = 'feedback ok';
    // Nothing to say that the card turning green has not already said. The
    // element collapses when empty (see .feedback:empty in styles.css), so
    // this is real vertical space handed back to the answers below.
    $('quiz-feedback').textContent = '';
    session.locked = true;
    disableRemainingChoices();
    if (state.mode === 'definition') showKanjiInfo(getAnyCourse(state.courseId), item);
    $('quiz-ok').hidden = false;
    $('quiz-ok').textContent = 'Next';
    $('quiz-kana').classList.add('quiz-glyph-tap');
    return;
  }

  button.classList.add('is-wrong');
  button.disabled = true;

  // A miss no longer comes back later in the same session — it used to get
  // silently reinserted a few questions ahead, which meant "how many are
  // left" kept moving in ways nothing on screen explained. The session now
  // runs through its queue exactly once regardless of misses; the summary
  // offers to go practise whatever came back wrong afterward instead
  // (state.summaryMissed, see finishSession() below).
  //
  // Every wrong tap takes this same branch, not just the first — the
  // correct option is never auto-highlighted for the learner by elimination
  // (that used to happen on the second miss). Scoring is unaffected: only
  // the FIRST attempt (above) is ever recorded, so trying a third or fourth
  // option costs nothing but does mean they still have to find and tap the
  // right one themselves before the question resolves — the whole point,
  // early on, is the tap itself landing on the right answer.
  $('quiz-card').className = 'quiz-card is-wrong';
  $('quiz-feedback').className = 'feedback bad';
  $('quiz-feedback').textContent = 'Try once more';
}

/** Once a single-answer question resolves, every remaining option goes
 * inert — otherwise, with no auto-advance timer to paper over it, an
 * un-disabled choice would sit there looking tappable (doing nothing if
 * tapped) for however long the learner takes to hit Next. */
function disableRemainingChoices() {
  $('quiz-choices').querySelectorAll('.choice').forEach((el) => { el.disabled = true; });
}

function revealSingleAnswer(answer) {
  $('quiz-choices').querySelectorAll('.choice').forEach((el) => {
    if (el.dataset.value === answer) el.classList.add('is-right');
  });
}

// --- Vocabulary: Meaning mode (vocab-plan.md §5) --------------------------
//
// Two stages shown as one question: an English-meaning choice (always), then
// — only when it was answered right, at least one kanji's furigana was
// hidden, and it was never revealed — a kana-reading follow-up (§5.4). Both
// grade separate progress records (vdef/vyomi) that roll up into the single
// itemKey('vmeaning', word) card the rest of srs.js schedules against; see
// recomputeVocabRollup in srs.js.
//
// The reveal ladder (§5.2/§5.3) is the other half of this: which kanji show
// their furigana by default is a genuine per-question decision (it depends
// on the study list, read fresh each time), computed once into
// session.vocabHidden when the question is built and consulted by every tap.

// Above this many characters a Meaning option stops fitting a half-width
// column and the grid goes single-column instead (§5.6). Measured, not
// guessed: at .choice-grid-text's 16px/1.3 on a 360px-wide phone a half
// column holds about this much before a four-option grid starts scrolling.
const LONG_MEANING_LABEL = 24;

/** Whether a kanji has any claim on it at all — enrolled in Definition, Yomi
 * OR Writing. Per vocab-plan.md §5.2: broader than "enrolled in Yomi" on
 * purpose, since Yomi itself is the strict, slow way to learn a reading —
 * gating furigana on it would hand the reading to exactly the learner most
 * likely to already be able to produce it unaided. */
// The three real kanji-course modes — deliberately excludes vmeaning/vrecall.
// `study` is keyed by bare item id with no mode namespacing (study[item][mode]
// — see the study-list notes in srs.js), so a single-kanji vocab word (船,
// 水, ...) shares its very key with the kanji of the same name: enrolling the
// WORD in vmeaning writes to the exact same study['船'] entry enrolling the
// KANJI in Definition would. isStudying() below is already safe from this —
// it checks one specific mode key, and 'vmeaning' is never one of the three
// checked here — but a bare "any mode at all" test is not, and would read a
// vocab-only enrollment as proof the kanji itself had been studied.
const KANJI_STUDY_MODES = new Set(['definition', 'recognition', 'writing']);

function isKanjiKnown(kanji) {
  return studyModes(state.profile.study, kanji).some((mode) => KANJI_STUDY_MODES.has(mode));
}

/** The exposure key a ruby position's reading accrues against — the
 * build-time-validated `credits` (base reading, rendaku/gemination undone)
 * when there is one, else the literal kana shown. Falling back to the raw
 * kana rather than dropping the position entirely means a reading KANJIDIC
 * doesn't recognise for this kanji (so it never made `quizReadings`, and
 * `credits` is absent — vocab-plan.md §3.2) can still earn its own hidden
 * default; it just never surfaces on the kanji detail screen's reading
 * chips, which only ever iterate `quizReadings`. */
function vocabExposureReading(rubyEntry) {
  return rubyEntry[2] || rubyEntry[1];
}

/** Full furigana, always shown — the lesson (teaching) card's word display,
 * as opposed to updateVocabWordDisplay's quiz-time version, which hides
 * whatever the reveal ladder says to. Introducing a word is not testing it. */
function renderVocabWordGlyph(el, info) {
  el.className = 'glyph glyph-vocab';
  if (!wordHasKanji(info.w)) {
    // Kana-only (hiragana or katakana): furigana annotates KANJI, so there
    // is nothing to show here — just the word itself.
    el.textContent = info.w;
    return;
  }
  if (!info.ruby) {
    // Jukujikun (大人, ...) — no per-kanji breakdown exists, so one ruby
    // spans the whole word (vocab-plan.md §3.2).
    el.innerHTML = `<ruby>${info.w}<rt>${info.r}</rt></ruby>`;
    return;
  }
  const rubyByPos = new Map(info.ruby.map((r) => [r[0], r]));
  let html = '';
  [...info.w].forEach((ch, pos) => {
    const r = rubyByPos.get(pos);
    html += r ? `<ruby>${ch}<rt>${r[1]}</rt></ruby>` : ch;
  });
  el.innerHTML = html;
}

/**
 * Up to three real sentences using this word, furigana over every kanji in
 * them and a translation of each whole sentence — the vocab detail screen's
 * answer to "yes, but how is it actually used?", which neither a gloss list
 * nor a kanji breakdown can give.
 *
 * Three rather than one because one usage is often the least representative
 * thing about a word: ご招待をありがとうございます is a correct sentence for
 * 招待 and a set phrase that says nothing about 招待する. The build picks
 * three that differ from each other — see choose_examples() in
 * tools/build_vocab_data.py.
 */
function renderWordExamples(info) {
  const wrap = $('detail-example');
  const examples = info.ex || [];
  wrap.hidden = examples.length === 0;
  if (!examples.length) return;
  $('detail-example-heading').textContent = examples.length > 1 ? 'In sentences' : 'In a sentence';
  const list = $('detail-example-list');
  list.innerHTML = '';
  examples.forEach((example) => list.appendChild(buildExample(example, info.w)));
}

/**
 * `example.r` is a list of [start, length, kana] over the sentence string:
 * the same idea as a word's own `ruby`, widened to a span because a sentence
 * contains readings that don't divide character by character (昨日 is きのう
 * across both, 人々 is ひとびと across both).
 *
 * Renders one span of the sentence — the whole thing, or just one word of it
 * for the tapped-word panel — as ruby elements and plain text. Text between
 * two spans goes in as one node rather than one per character, so the
 * browser can apply its own line-breaking rules across a run of kana (see
 * .example-jp in styles.css).
 */
function appendSentenceRange(el, example, from, to) {
  const rubyByStart = new Map((example.r || []).map((span) => [span[0], span]));
  const boundaries = new Set([to]);
  (example.r || []).forEach(([start, length]) => boundaries.add(start).add(start + length));
  let pos = from;
  while (pos < to) {
    const span = rubyByStart.get(pos);
    if (span) {
      const ruby = document.createElement('ruby');
      ruby.appendChild(document.createTextNode(example.j.slice(pos, pos + span[1])));
      const rt = document.createElement('rt');
      rt.textContent = span[2];
      ruby.appendChild(rt);
      el.appendChild(ruby);
      pos += span[1];
    } else {
      const next = Math.min(...[...boundaries].filter((b) => b > pos && b <= to));
      el.appendChild(document.createTextNode(example.j.slice(pos, next)));
      pos = next;
    }
  }
}

/**
 * One example sentence: the Japanese, its translation, and — under both, on
 * demand — whichever word of it was last tapped.
 *
 * `example.w` is a list of [start, length] or [start, length, glossary key]
 * covering every word the corpus index found in the sentence, which is every
 * word in it bar the punctuation. Each becomes its own tap target, because
 * the rule everywhere else in this app is that if you can see a word you can
 * tap it, and a sentence full of untappable words in the middle of a screen
 * where everything else drills in would be the one place that rule stopped.
 *
 * `target` is the word this sentence is an example OF, marked where it
 * appears. Found by plain search, which finds it in the form the sentence
 * writes it: the build prefers a sentence using the word as the learner is
 * taught it, but a verb is often bent (会う taught, 会います written) and then
 * there is simply nothing to mark.
 */
function buildExample(example, target) {
  const block = document.createElement('div');
  block.className = 'example';

  if (example.i) {
    // Kept only where a word has nothing better (一寸 is barely used outside
    // idioms), and never passed off as ordinary usage: an idiom's English is
    // an equivalent saying rather than a translation of the words, so a
    // learner reading one for the grammar would be misled without this.
    const tag = document.createElement('p');
    tag.className = 'example-tag';
    tag.textContent = 'Idiom — the English is the equivalent saying, not a word-for-word translation';
    block.appendChild(tag);
  }

  const jp = document.createElement('p');
  jp.className = 'example-jp';
  jp.lang = 'ja';
  const panel = document.createElement('div');
  panel.className = 'example-word-panel';
  panel.hidden = true;

  const hitAt = target ? example.j.indexOf(target) : -1;
  const hitEnd = hitAt < 0 ? -1 : hitAt + target.length;
  const wordByStart = new Map((example.w || []).map((span) => [span[0], span]));
  const stops = new Set([example.j.length, hitAt, hitEnd]);
  (example.w || []).forEach(([start, length]) => stops.add(start).add(start + length));

  // 禁則処理: word buttons are inline-block, which the layout engine treats
  // as atomic boxes with a break opportunity either side, so a 。 in its own
  // box would happily start a line. Same fix as the reader's — group into
  // `white-space: nowrap` runs a break cannot fall inside. See
  // renderReaderParagraph(), whose NO_LINE_START/NO_LINE_END these are.
  let run = null;
  let heldOpen = false;
  let pos = 0;
  while (pos < example.j.length) {
    // `start` and `end` are per-piece constants, not the loop's own cursor:
    // the tap handler below outlives this iteration and has to remember the
    // piece it was built for.
    const start = pos;
    const word = wordByStart.get(start);
    const end = word ? start + word[1] : Math.min(...[...stops].filter((b) => b > start));
    const text = example.j.slice(start, end);
    if (!run || !(NO_LINE_START.test(text) || heldOpen)) {
      run = document.createElement('span');
      run.className = 'example-run';
      jp.appendChild(run);
    }
    const node = document.createElement(word ? 'button' : 'span');
    node.className = `example-piece${word ? ' example-word' : ''}`
      + (start >= hitAt && start < hitEnd ? ' example-hit' : '');
    if (word) {
      node.type = 'button';
      node.setAttribute('aria-label', `What does ${text} mean?`);
      const key = word.length > 2 ? word[2] : text;
      node.addEventListener('click', () => showExampleWord(jp, panel, example, start, end, key, node));
    }
    appendSentenceRange(node, example, start, end);
    run.appendChild(node);
    heldOpen = NO_LINE_END.test(text);
    pos = end;
  }

  const en = document.createElement('p');
  en.className = 'example-en';
  en.textContent = example.en;

  block.appendChild(jp);
  block.appendChild(en);
  block.appendChild(panel);
  return block;
}

/**
 * A word inside an example sentence, tapped: what it says, what it comes
 * from, what it means, and the ways on from it (its kanji, and its own page
 * where this app teaches it).
 *
 * The glossary is one shared file covering every word of every example
 * sentence — see ensureExampleWordsLoaded() in vocab.js — so this is async
 * on the first tap of the session and instant afterwards. `sequence` guards
 * against a second tap landing while the first is still loading.
 */
let exampleWordSequence = 0;

async function showExampleWord(sentenceEl, panel, example, from, to, key, button) {
  const wasActive = button.classList.contains('is-active');
  sentenceEl.querySelectorAll('.example-word').forEach((b) => b.classList.remove('is-active'));
  if (wasActive) {
    panel.hidden = true;
    return;
  }
  button.classList.add('is-active');
  panel.hidden = false;
  panel.innerHTML = '';
  exampleWordSequence += 1;
  const sequence = exampleWordSequence;

  await ensureExampleWordsLoaded();
  if (sequence !== exampleWordSequence) return; // another word was tapped while this loaded
  const entry = exampleWordInfo(key);

  const written = document.createElement('p');
  written.className = 'example-word-written';
  written.lang = 'ja';
  appendSentenceRange(written, example, from, to);
  panel.innerHTML = '';
  panel.appendChild(written);

  if (!entry) {
    const missing = document.createElement('p');
    missing.className = 'hint';
    missing.textContent = 'No dictionary entry for this one.';
    panel.appendChild(missing);
    return;
  }

  // "from 行く（いく）" — the dictionary word this written form belongs to,
  // shown only when the sentence bends it into something else. The meaning
  // below is that dictionary word's, so without this line an inflected form
  // would be handed a definition that doesn't obviously belong to it.
  //
  // Not when the written form is already the word said out loud, though:
  // きっと is JMdict's 屹度 spelled the way everybody writes it, not a form
  // of some other word, and "from 屹度（きっと）" would introduce a kanji
  // spelling nobody uses as if it were the answer.
  const surface = example.j.slice(from, to);
  if (entry.word !== surface && entry.kana !== surface) {
    const from_ = document.createElement('p');
    from_.className = 'hint';
    from_.lang = 'ja';
    from_.textContent = `from ${entry.word}（${entry.kana}）`;
    panel.appendChild(from_);
  }

  const meaning = document.createElement('p');
  meaning.className = 'example-word-meaning';
  meaning.textContent = entry.en;
  panel.appendChild(meaning);

  const chips = document.createElement('div');
  chips.className = 'reading-chips';
  chips.lang = 'ja';
  fillWordKanjiChips(chips, surface, drillIntoDetail);
  panel.appendChild(chips);

  const taught = vocabTargetForWord({ kanji: entry.word, kana: entry.kana });
  if (taught) {
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'btn btn-quiet word-more';
    more.textContent = 'Word details ›';
    more.addEventListener('click', () => drillIntoDetail(taught.course, taught.id));
    panel.appendChild(more);
  }
}

/**
 * How this word's furigana should default (vocab-plan.md §5.2), computed
 * once per question:
 * - `none` — no kanji at all, nothing to hide; the ladder skips straight to
 *   romaji.
 * - `katakana` — a katakana word; the ladder is katakana -> hiragana ->
 *   romaji, same length as the kanji ladder but with no "known" gate.
 * - `whole` — a jukujikun word (build_vocab_data.py couldn't align it to
 *   per-kanji readings, e.g. 大人) — all-or-nothing: hidden only if EVERY
 *   kanji in it is known, OR the word itself has earned the hidden default by
 *   exposure (vocab-plan.md §5.3 — jukujikun words accrue against the whole
 *   word, having no per-kanji reading to key on), OR the learner muted it by
 *   hand ("Hide furigana in future" — clickHideFuriganaButton below).
 * - `perchar` — the normal case: each kanji position hides independently,
 *   enrolled in any mode, OR its specific (kanji, reading) pair promoted by
 *   exposure, OR muted by hand — a three-way OR, per §5.3.
 */
function vocabHiddenState(info) {
  if (!wordHasKanji(info.w)) {
    const isKatakana = [...info.w].some((ch) => ch >= 'ァ' && ch <= 'ヶ');
    return { mode: isKatakana ? 'katakana' : 'none' };
  }
  const { exposure, muted } = state.profile;
  if (!info.ruby) {
    const chars = [...info.w].filter(isKanjiChar);
    const known = chars.length > 0 && chars.every(isKanjiKnown);
    const key = exposureWordKey(info.w);
    const promoted = isExposurePromoted(exposure, key);
    const mutedByChoice = isFuriganaMuted(muted, key);
    return { mode: 'whole', hidden: known || promoted || mutedByChoice };
  }
  const hidden = new Set();
  info.ruby.forEach((entry) => {
    const pos = entry[0];
    const key = exposureKanjiKey(info.w[pos], vocabExposureReading(entry));
    const known = isKanjiKnown(info.w[pos]);
    const promoted = isExposurePromoted(exposure, key);
    const mutedByChoice = isFuriganaMuted(muted, key);
    if (known || promoted || mutedByChoice) hidden.add(pos);
  });
  // Showing SOME of a word's furigana narrows what the yomi follow-up can
  // fairly ask with, since every option then has to agree with what's on
  // screen (§5.4). For a hidden kanji with almost no plausible misreadings
  // that leaves too few options to ask at all — so hide the word's furigana
  // outright instead. Nothing is lost: the ladder still reveals it on a tap,
  // and with nothing showing to contradict, every distractor is back in play.
  const partial = hidden.size > 0 && hidden.size < info.ruby.length;
  if (partial && !partialFuriganaIsAskable(info, hidden)) {
    info.ruby.forEach(([pos]) => hidden.add(pos));
  }
  return { mode: 'perchar', hidden };
}

/** How many taps the reveal ladder has for this word — 1 for a kana-only
 * word (straight to romaji), 2 for everything else (furigana/hiragana, then
 * romaji). */
function vocabMaxRevealLevel(hiddenInfo) {
  return hiddenInfo.mode === 'none' ? 1 : 2;
}

/** Whether this word's furigana had anything genuinely hidden to test — the
 * gate on the yomi follow-up stage (§5.4) and on grading a reveal as a miss
 * (§5.3). A katakana or fully-visible word has nothing to test either way. */
function vocabHasHiddenReading(hiddenInfo) {
  if (hiddenInfo.mode === 'perchar') return hiddenInfo.hidden.size > 0;
  if (hiddenInfo.mode === 'whole') return hiddenInfo.hidden;
  return false;
}

/**
 * Every exposure key this word's ruby can accrue against, with whether that
 * key is CURRENTLY hidden on screen and whether it got there via exposure
 * promotion specifically (as opposed to study enrollment, or the partial-
 * furigana fallback in vocabHiddenState forcing everything hidden). Shared
 * by recordVocabExposureOnShow and recordVocabExposureOnReveal below so the
 * two can't drift on what counts as "this word's readings".
 *
 * Empty for `none`/`katakana` words — there is no kanji reading to earn a
 * hidden default for either way.
 */
function vocabExposureTargets(info, hiddenInfo) {
  const { exposure } = state.profile;
  if (hiddenInfo.mode === 'whole') {
    const key = exposureWordKey(info.w);
    return [{ key, hidden: hiddenInfo.hidden, promoted: isExposurePromoted(exposure, key) }];
  }
  if (hiddenInfo.mode !== 'perchar') return [];
  return info.ruby.map((entry) => {
    const pos = entry[0];
    const key = exposureKanjiKey(info.w[pos], vocabExposureReading(entry));
    return { key, hidden: hiddenInfo.hidden.has(pos), promoted: isExposurePromoted(exposure, key) };
  });
}

/**
 * Called once when a Meaning question is first built (vocabRevealLevel 0):
 * every reading NOT hidden is, by definition, being shown right now — the
 * plain "ruby was shown" half of vocab-plan.md §5.3. A key already promoted
 * is necessarily hidden at this point (promotion is one of the two things
 * that can cause `hidden`), so there is nothing here that needs skipping for
 * being frozen — that only comes up on a later reveal (see the "on reveal"
 * counterpart below).
 */
function recordVocabExposureOnShow(info, hiddenInfo) {
  const session = state.session;
  const { exposure } = state.profile;
  let changed = false;
  vocabExposureTargets(info, hiddenInfo).forEach(({ key, hidden }) => {
    if (hidden || session.vocabExposed.has(key)) return;
    session.vocabExposed.add(key);
    addExposure(exposure, key, Date.now());
    changed = true;
  });
  if (changed) store.saveProfile(state.profile);
}

/**
 * Called on the reveal-ladder's first tap (vocabRevealLevel 0 -> 1): every
 * reading that WAS hidden just got shown, which is exactly as much an
 * exposure as one shown by default ("A revealed ruby (the learner tapped)
 * counts. They saw it; that is what an exposure is.") — UNLESS it is already
 * promoted, in which case it is frozen (vocab-plan.md §5.3) and the reveal is
 * evidence for the DIFFERENT mechanism instead: if this word had exactly one
 * hidden reading and it was the promoted one, the reveal is unambiguously
 * about it, and counts as a demotion strike ("when exposure was not
 * enough"). A word with several hidden readings gives no way to tell which
 * one the learner actually needed, so an ambiguous reveal does nothing here
 * — it is already recorded against the word's own `vyomi` record instead.
 */
function recordVocabExposureOnReveal(info, hiddenInfo) {
  const { exposure } = state.profile;
  const targets = vocabExposureTargets(info, hiddenInfo);
  const hiddenTargets = targets.filter((t) => t.hidden);
  let changed = false;

  if (hiddenTargets.length === 1 && hiddenTargets[0].promoted) {
    recordDemotionStrike(exposure, hiddenTargets[0].key, Date.now());
    changed = true;
  }
  const session = state.session;
  hiddenTargets.forEach(({ key, promoted }) => {
    if (promoted || session.vocabExposed.has(key)) return;
    session.vocabExposed.add(key);
    addExposure(exposure, key, Date.now());
    changed = true;
  });
  if (changed) store.saveProfile(state.profile);
}

/** Repaints #quiz-kana and #quiz-prompt-hint for the current reveal level —
 * called on every tap, and once up front to establish the starting state. */
function updateVocabWordDisplay() {
  const session = state.session;
  const course = getAnyCourse(state.courseId);
  const item = session.queue[session.position];
  const info = vocabInfo(course, item);
  const hiddenInfo = session.vocabHidden;
  const level = session.vocabRevealLevel;
  const el = $('quiz-kana');

  if (hiddenInfo.mode === 'none') {
    el.textContent = info.w;
  } else if (hiddenInfo.mode === 'katakana') {
    el.textContent = level >= 1 ? info.r : info.w;
  } else if (hiddenInfo.mode === 'whole') {
    el.innerHTML = (level >= 1 || !hiddenInfo.hidden)
      ? `<ruby>${info.w}<rt>${info.r}</rt></ruby>`
      : info.w;
  } else {
    const rubyByPos = new Map(info.ruby.map((r) => [r[0], r]));
    let html = '';
    [...info.w].forEach((ch, pos) => {
      const r = rubyByPos.get(pos);
      if (!r) { html += ch; return; }
      const shown = level >= 1 || !hiddenInfo.hidden.has(pos);
      html += shown ? `<ruby>${ch}<rt>${r[1]}</rt></ruby>` : ch;
    });
    el.innerHTML = html;
  }

  const romajiLevel = hiddenInfo.mode === 'none' ? 1 : 2;
  const hint = $('quiz-prompt-hint');
  const pronunciation = $('quiz-prompt-pronunciation');
  hint.hidden = level < romajiLevel;
  if (!hint.hidden) {
    hint.textContent = toRomaji(info.r);
    // Only shown when it genuinely differs — see pronunciationFor()'s module
    // note in vocab.js.
    const said = pronunciationFor(info.r);
    pronunciation.hidden = !said;
    pronunciation.textContent = said ? `said: ${said}` : '';
  } else {
    pronunciation.hidden = true;
  }

  el.classList.toggle('vocab-word-tap', level < vocabMaxRevealLevel(hiddenInfo));

  // Only worth offering while furigana is actually showing BY DEFAULT — once
  // the learner has tapped to reveal it (level >= 1) everything is visible
  // regardless of hidden state, and "hide in future" would mute the wrong
  // thing: kanji they'd have wanted hidden anyway, not the ones currently
  // being handed to them for free. See clickHideFuriganaButton below.
  const hasVisibleDefault = level === 0 && (
    (hiddenInfo.mode === 'whole' && !hiddenInfo.hidden)
    || (hiddenInfo.mode === 'perchar' && hiddenInfo.hidden.size < info.ruby.length)
  );
  $('quiz-hide-furigana').hidden = !hasVisibleDefault;
}

/**
 * The reveal-ladder tap target. Bound once in wire() to the static #quiz-kana
 * element; a no-op outside a vocab Meaning question's first (definition)
 * stage, so nothing needs unbinding between question types.
 *
 * Grades `vyomi` as a miss on the FIRST tap that reveals something that was
 * actually hidden (vocab-plan.md §5.3) — immediately, not at Next, because
 * that is the honest answer to "did you know this reading" and the record
 * is locked to what was known before anything was shown, same rule as
 * everywhere else in this app. A tap that only reaches romaji on a word with
 * nothing hidden (katakana, or every kanji already known) grades nothing —
 * there was nothing being tested.
 */
function clickVocabWord() {
  const session = state.session;
  if (!session || !session.vocabHidden || session.vocabStage !== 'definition') return;
  const hiddenInfo = session.vocabHidden;
  if (session.vocabRevealLevel >= vocabMaxRevealLevel(hiddenInfo)) return;
  const isFirstReveal = session.vocabRevealLevel === 0;
  session.vocabRevealLevel += 1;
  if (isFirstReveal && !session.vocabRevealed) {
    session.vocabRevealed = true;
    if (vocabHasHiddenReading(hiddenInfo)) {
      recordVocabYomi(session.queue[session.position], false);
      const course = getAnyCourse(state.courseId);
      const info = vocabInfo(course, session.queue[session.position]);
      recordVocabExposureOnReveal(info, hiddenInfo);
    }
  }
  updateVocabWordDisplay();
}

/**
 * "Hide furigana in future" (vocab-plan.md §5.3) — a manual, permanent
 * alternative to earning the hidden default by exposure, for whenever the
 * learner would rather not wait to meet a reading four times. Mutes every
 * key that is CURRENTLY showing by default (updateVocabWordDisplay only
 * shows the button when at least one such key exists), never a key already
 * hidden — this button opts kanji OUT of being shown, it does not un-hide
 * anything. Bound once in wire() to the static #quiz-hide-furigana element,
 * a sibling of #quiz-kana rather than a descendant, so it needs no
 * stopPropagation to avoid also triggering clickVocabWord's reveal.
 *
 * Takes effect immediately — the current word's display is recomputed from
 * the just-updated profile, same as any other quiz screen edit — not only
 * for the next time this word comes up.
 */
function clickHideFuriganaButton() {
  const session = state.session;
  if (!session || !session.vocabHidden || session.vocabStage !== 'definition') return;
  const hiddenInfo = session.vocabHidden;
  if (session.vocabRevealLevel !== 0) return;
  const course = getAnyCourse(state.courseId);
  const info = vocabInfo(course, session.queue[session.position]);
  const { muted } = state.profile;
  const now = Date.now();
  if (hiddenInfo.mode === 'whole') {
    if (hiddenInfo.hidden) return;
    muteFuriganaKey(muted, exposureWordKey(info.w), now);
  } else if (hiddenInfo.mode === 'perchar') {
    info.ruby.forEach((entry) => {
      const pos = entry[0];
      if (hiddenInfo.hidden.has(pos)) return;
      muteFuriganaKey(muted, exposureKanjiKey(info.w[pos], vocabExposureReading(entry)), now);
    });
  } else {
    return;
  }
  store.saveProfile(state.profile);
  session.vocabHidden = vocabHiddenState(info);
  updateVocabWordDisplay();
}

/**
 * A correct, never-revealed yomi answer also credits the constituent
 * kanji's OWN reading records (vocab-plan.md §4.5) — vocabulary becomes a
 * second way a kanji reading gets learned, not just a parallel quiz. Only
 * the positions actually being TESTED this question — the ones hidden on
 * screen — are credited; a kanji whose reading was already visible wasn't
 * being asked about, so answering the word correctly proves nothing new
 * about it (this is exactly `hiddenInfo.hidden`, the same set the reveal
 * ladder hides). Two more safeguards fall straight out of the data: a
 * jukujikun word (`mode !== 'perchar'`) has no per-kanji reading to credit
 * at all, and a ruby entry with no `credits` (build time couldn't map it to
 * a real, quizzable reading — vocab-plan.md §3.2/§4.5 safeguard 4) is
 * skipped rather than guessed at.
 *
 * Deliberately does NOT call kanji.js's recomputeKanjiRollup — that needs
 * kanjiInfo(course, kanji), i.e. that kanji's own course unit already
 * loaded, which a vocab session has no reason to have done. Grading a
 * question must not pause to fetch it, so this rebuilds the rollup by
 * scanning progress instead (recomputeYomiRollupFromProgress in srs.js).
 */
function creditVocabYomi(info, hiddenInfo) {
  if (hiddenInfo.mode !== 'perchar') return;
  const { progress } = state.profile;
  info.ruby.forEach((entry) => {
    const [pos, , credits] = entry;
    if (!credits || !hiddenInfo.hidden.has(pos)) return;
    const kanji = info.w[pos];
    const key = yomiKey('recognition', kanji, credits);
    progress[key] = gradeYomi(progress[key] || newYomiRecord(), true, Date.now());
    recomputeYomiRollupFromProgress(progress, 'recognition', kanji);
  });
}

function recordVocabYomi(word, correct) {
  const { progress } = state.profile;
  const key = itemKey('vyomi', word);
  progress[key] = grade(progress[key] || newRecord(), correct, Date.now());
  recomputeVocabRollup(word, 'vmeaning', progress);
  store.saveProfile(state.profile);
}

function recordVocabDef(word, correct) {
  ensurePlacementEnrolled(word);
  const session = state.session;
  const { progress } = state.profile;
  const key = itemKey('vdef', word);
  progress[key] = grade(progress[key] || newRecord(), correct, Date.now(), { placement: session.placementTest });
  recomputeVocabRollup(word, 'vmeaning', progress);
  if (!session.results.has(word)) session.results.set(word, correct);
  store.saveProfile(state.profile);
}

function renderVocabMeaningQuestion(course, item) {
  const session = state.session;
  const info = vocabInfo(course, item);

  session.attempt = 0;
  session.vocabStage = 'definition';
  session.vocabRevealLevel = 0;
  session.vocabRevealed = false;
  session.vocabHidden = vocabHiddenState(info);
  recordVocabExposureOnShow(info, session.vocabHidden);

  $('quiz-ok').hidden = true;
  $('quiz-kanji-actions').hidden = true;
  updateVocabWordDisplay();

  const { options, answer } = buildMeaningChoices(course, item);
  session.vocabAnswer = answer;
  const choices = $('quiz-choices');
  // vocab-plan.md §5.6: a Meaning label now carries every sense the word has
  // ("why, for what reason / how, in what way"), which does not fit half a
  // phone. Drop to one full-width column when any option is long — the same
  // trade §5.1 made when it chose four options over six, one step further
  // along. Short-gloss questions (a unit of one-sense nouns) keep the
  // compact two-column grid.
  const wide = options.some((o) => o.length > LONG_MEANING_LABEL);
  choices.className = `choice-grid choice-grid-text${wide ? ' choice-grid-wide' : ''}`;
  options.forEach((value) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'choice';
    button.textContent = value;
    button.dataset.value = value;
    button.addEventListener('click', () => chooseVocabMeaning(value, button));
    choices.appendChild(button);
  });
}

function chooseVocabMeaning(value, button) {
  const session = state.session;
  if (!session || session.vocabStage !== 'definition' || button.disabled) return;
  const course = getAnyCourse(state.courseId);
  const item = session.queue[session.position];
  const correct = value === session.vocabAnswer;
  session.attempt += 1;

  if (session.attempt === 1) recordVocabDef(item, correct);

  if (correct) {
    button.classList.add('is-right');
    $('quiz-card').className = 'quiz-card is-correct';
    disableRemainingChoices();
    session.locked = true;
    finishVocabDefinitionStage(course, item);
    return;
  }

  button.classList.add('is-wrong');
  button.disabled = true;

  // Every wrong tap takes this branch, not just the first — see chooseAnswer
  // above for why the correct option is never auto-revealed by elimination.
  $('quiz-card').className = 'quiz-card is-wrong';
  $('quiz-feedback').className = 'feedback bad';
  $('quiz-feedback').textContent = 'Try once more';
}

/**
 * A correct definition answer: the card stays green, "Next" appears, and —
 * only when a reading follow-up is actually coming (§5.4: something was
 * genuinely hidden and never revealed) — the feedback line and the Next
 * button itself both say so, rather than the reading stage's choices
 * silently replacing the definition's the moment this click landed. See
 * vocab-plan.md's UX note and nextQuestion() above, which is what actually
 * runs beginVocabYomiStage on the FOLLOWING press.
 */
function finishVocabDefinitionStage(course, item) {
  const session = state.session;
  const qualifies = !session.vocabRevealed && vocabHasHiddenReading(session.vocabHidden);
  if (qualifies) {
    $('quiz-feedback').className = 'feedback ok';
    $('quiz-feedback').textContent = "Correct! Next, its reading.";
    session.vocabNextStage = () => beginVocabYomiStage(course, item);
    $('quiz-ok').textContent = 'Next: the reading →';
    // NOT made tappable here: the reading stage is still coming, and the
    // word's own detail screen shows every reading it has — opening it now
    // would hand over the very answer that stage is about to ask for.
  } else {
    $('quiz-feedback').textContent = '';
    session.vocabStage = 'done';
    $('quiz-ok').textContent = 'Next';
    $('quiz-kana').classList.add('quiz-glyph-tap');
  }
  $('quiz-ok').hidden = false;
}

/** The options are constrained by whatever furigana stayed on screen
 * (§5.4); vocabHiddenState already guaranteed back at question-build time
 * that the display it chose leaves enough of them. */
function beginVocabYomiStage(course, item) {
  const session = state.session;
  const hiddenInfo = session.vocabHidden;
  session.vocabStage = 'yomi';
  session.locked = false;
  renderVocabYomiStage(buildYomiChoices(
    course,
    item,
    hiddenInfo.mode === 'perchar' ? hiddenInfo.hidden : null,
  ));
}

function renderVocabYomiStage({ options, answer }) {
  state.session.vocabYomiAnswer = answer;

  // A fresh question about the same word — announced, not just swapped in.
  // See finishVocabDefinitionStage above, which is what paused on the
  // definition's own green card for one "Next" press before this ran.
  $('quiz-ok').hidden = true;
  $('quiz-feedback').textContent = "Now choose how it's read.";
  $('quiz-feedback').className = 'feedback hint';
  $('quiz-card').className = 'quiz-card';

  const choices = $('quiz-choices');
  choices.className = 'choice-grid';
  choices.innerHTML = '';
  options.forEach((value) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'choice';
    button.textContent = value;
    button.dataset.value = value;
    button.addEventListener('click', () => chooseVocabYomi(value, button));
    choices.appendChild(button);
  });
}

/** Single attempt, right or wrong grades and ends it either way — the
 * definition stage already showed the word, so there is nothing left to
 * protect by giving a second try (vocab-plan.md §5.4). */
function chooseVocabYomi(value, button) {
  const session = state.session;
  if (!session || session.vocabStage !== 'yomi' || session.locked) return;
  const item = session.queue[session.position];
  const correct = value === session.vocabYomiAnswer;
  recordVocabYomi(item, correct);
  if (correct) {
    const course = getAnyCourse(state.courseId);
    creditVocabYomi(vocabInfo(course, item), session.vocabHidden);
    store.saveProfile(state.profile);
  }

  $('quiz-choices').querySelectorAll('.choice').forEach((el) => { el.disabled = true; });
  button.classList.add(correct ? 'is-right' : 'is-wrong');
  $('quiz-feedback').className = 'feedback';
  $('quiz-feedback').textContent = '';
  if (!correct) revealSingleAnswer(session.vocabYomiAnswer);
  $('quiz-card').className = `quiz-card ${correct ? 'is-correct' : 'is-wrong'}`;

  session.vocabStage = 'done';
  session.locked = true;
  $('quiz-ok').hidden = false;
  $('quiz-ok').textContent = 'Next';
  $('quiz-kana').classList.add('quiz-glyph-tap');
}

// --- Vocabulary: Recall mode (vocab-plan.md §6) ---------------------------
//
// English -> Japanese, the mirror image of Meaning. Stage 1 (vprod) always
// runs: the English gloss is the prompt, six kana options the choices, with
// a wrong first tap getting one more try before revealing — exactly
// chooseAnswer()'s pattern. Stage 2 (vspell) is a bonus after a correct
// stage 1, gated on the word actually having kanji worth asking about (§6.2)
// — reusing isKanjiKnown, the same "studied in ANY mode" test §5.2 applies
// to furigana, for the same reason: caring about a kanji at all is enough
// to be asked how a word using it is spelled.

function recordVocabProd(word, correct) {
  ensurePlacementEnrolled(word);
  const session = state.session;
  const { progress } = state.profile;
  const key = itemKey('vprod', word);
  progress[key] = grade(progress[key] || newRecord(), correct, Date.now(), { placement: session.placementTest });
  recomputeVocabRollup(word, 'vrecall', progress);
  if (!session.results.has(word)) session.results.set(word, correct);
  store.saveProfile(state.profile);
}

function recordVocabSpell(word, correct) {
  const { progress } = state.profile;
  const key = itemKey('vspell', word);
  progress[key] = grade(progress[key] || newRecord(), correct, Date.now());
  recomputeVocabRollup(word, 'vrecall', progress);
  store.saveProfile(state.profile);
}

function renderVocabRecallQuestion(course, item) {
  const session = state.session;
  const info = vocabInfo(course, item);

  session.attempt = 0;
  session.vocabRecallStage = 'prod';

  $('quiz-kana').className = 'quiz-prompt-text';
  $('quiz-kana').lang = 'en';
  // Every sense, not just the first (§5.6). The prompt has to name the word
  // unambiguously enough that the learner can produce it, and "how" alone
  // named both どう and どうして; "why, for what reason / how, in what way"
  // names exactly one of them.
  $('quiz-kana').textContent = wordMeaningLabel(info);
  $('quiz-prompt-hint').hidden = true;
  $('quiz-prompt-pronunciation').hidden = true;
  $('quiz-ok').hidden = true;
  $('quiz-kanji-actions').hidden = true;

  const { options, answer } = buildRecallChoices(course, item);
  session.vocabAnswer = answer;
  const choices = $('quiz-choices');
  choices.className = 'choice-grid';
  choices.lang = 'ja';
  options.forEach((value) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'choice';
    button.textContent = value;
    button.dataset.value = value;
    button.addEventListener('click', () => chooseVocabProd(value, button));
    choices.appendChild(button);
  });
}

function chooseVocabProd(value, button) {
  const session = state.session;
  if (!session || session.vocabRecallStage !== 'prod' || button.disabled) return;
  const course = getAnyCourse(state.courseId);
  const item = session.queue[session.position];
  const correct = value === session.vocabAnswer;
  session.attempt += 1;

  if (session.attempt === 1) recordVocabProd(item, correct);

  if (correct) {
    button.classList.add('is-right');
    $('quiz-card').className = 'quiz-card is-correct';
    disableRemainingChoices();
    session.locked = true;
    finishVocabProdStage(course, item);
    return;
  }

  button.classList.add('is-wrong');
  button.disabled = true;

  // Every wrong tap takes this branch, not just the first — see chooseAnswer
  // above for why the correct option is never auto-revealed by elimination.
  $('quiz-card').className = 'quiz-card is-wrong';
  $('quiz-feedback').className = 'feedback bad';
  $('quiz-feedback').textContent = 'Try once more';
}

/**
 * A correct stage-1 answer: pause here, card still green, before deciding
 * whether the spelling follow-up (§6.2 — word has kanji worth asking about,
 * at least one under study) is coming — see finishVocabDefinitionStage
 * above, same reasoning, same pattern. Nothing survived the mastered-kanji
 * exclusion even after §6.4's fallback ladder is treated as "not eligible",
 * same as the caller already did before this split out.
 */
function finishVocabProdStage(course, item) {
  const session = state.session;
  const info = vocabInfo(course, item);
  const eligible = recallHasSpellingStage(info) && [...info.w].some((ch) => isKanjiChar(ch) && isKanjiKnown(ch));
  const masteryOf = (kanji) => masteryTier(state.profile.progress[itemKey('definition', kanji)]);
  const built = eligible ? buildSpellingChoices(course, item, masteryOf) : null;

  if (built) {
    $('quiz-feedback').className = 'feedback ok';
    $('quiz-feedback').textContent = 'Correct! Next, spell it.';
    session.vocabNextStage = () => beginVocabSpellStage(info, built);
    $('quiz-ok').textContent = 'Next: spell it →';
    // NOT made tappable here: the spelling stage is still coming, and the
    // word's own detail screen shows its kanji spelling outright — opening
    // it now would hand over the very answer that stage is about to ask for.
  } else {
    $('quiz-feedback').textContent = '';
    session.vocabRecallStage = 'done';
    $('quiz-ok').textContent = 'Next';
    $('quiz-kana').classList.add('quiz-glyph-tap');
  }
  $('quiz-ok').hidden = false;
}

function beginVocabSpellStage(info, built) {
  state.session.vocabRecallStage = 'spell';
  state.session.locked = false;
  renderVocabSpellStage(info, built);
}

function renderVocabSpellStage(info, { options, answer }) {
  state.session.vocabSpellAnswer = answer;

  $('quiz-kana').className = 'glyph glyph-vocab';
  $('quiz-kana').lang = 'ja';
  $('quiz-kana').textContent = info.r;
  // The reading stays on screen (§6.3) — the learner already produced it;
  // hiding it here would turn one question into two. The English gloss
  // rides along as a small subtitle, matching the mockup's "reading — gloss"
  // layout, reusing the pronunciation line's quiet italic styling rather
  // than adding new markup for a one-off.
  $('quiz-prompt-pronunciation').hidden = false;
  $('quiz-prompt-pronunciation').textContent = `"${wordMeaningLabel(info)}"`;

  // A fresh question about the same word — announced, not just swapped in.
  // See finishVocabProdStage above, which paused on stage 1's own green
  // card for one "Next" press before this ran.
  $('quiz-ok').hidden = true;
  $('quiz-feedback').textContent = "Now choose how it's spelled.";
  $('quiz-feedback').className = 'feedback hint';
  $('quiz-card').className = 'quiz-card';

  const choices = $('quiz-choices');
  choices.className = 'choice-grid';
  choices.lang = 'ja';
  choices.innerHTML = '';
  options.forEach((value) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'choice';
    button.textContent = value;
    button.dataset.value = value;
    button.addEventListener('click', () => chooseVocabSpell(value, button));
    choices.appendChild(button);
  });
}

/** Single attempt, right or wrong grades and ends it either way — stage 1
 * already produced the word; there is nothing left to protect by giving a
 * second try (mirrors chooseVocabYomi). */
function chooseVocabSpell(value, button) {
  const session = state.session;
  if (!session || session.vocabRecallStage !== 'spell' || session.locked) return;
  const item = session.queue[session.position];
  const correct = value === session.vocabSpellAnswer;
  recordVocabSpell(item, correct);

  $('quiz-choices').querySelectorAll('.choice').forEach((el) => { el.disabled = true; });
  button.classList.add(correct ? 'is-right' : 'is-wrong');
  $('quiz-feedback').className = 'feedback';
  $('quiz-feedback').textContent = '';
  if (!correct) revealSingleAnswer(session.vocabSpellAnswer);
  $('quiz-card').className = `quiz-card ${correct ? 'is-correct' : 'is-wrong'}`;

  session.vocabRecallStage = 'done';
  session.locked = true;
  $('quiz-ok').hidden = false;
  $('quiz-ok').textContent = 'Next';
  $('quiz-kana').classList.add('quiz-glyph-tap');
}

// --- Writing (Trace / Guided / Free): draw each stroke against the -------
// --- KanjiVG guide ---------------------------------------------------------
//
// See writing-mode-plan.md. The guide, wherever and whenever it appears, is
// always shown at the character's TRUE position — placement within the box
// is part of what's being taught, so it is never shifted to match where the
// learner started.
//
// Trace and Guided share the same live, stroke-by-stroke grading with
// unlimited retries on a rejected stroke; what's locked in for spaced
// repetition is whether every stroke was accepted on its very first try,
// the same rule every other mode in this app already uses (see
// chooseAnswer() above). They differ only in what's rendered: Trace shows
// the whole model faintly from the start, Guided reveals each stroke only
// once it's been accepted, so the guide can never be used to place a stroke
// in advance — see createWritingAttempt() in writing.js.
//
// Free mode is different in kind, not just degree: no guide, no live
// rejection, no fixed stroke count to hit — every completed pointer gesture
// is simply captured, right or wrong, until the learner presses Done. Only
// then is anything graded, strokes are aligned to the model sequentially,
// and the guide appears for the first time, coloured per stroke as a
// review. See createFreeAttempt() in writing.js.
//
// All three converge on the same ending: the character never auto-advances
// once finished. One row, up to three buttons: Try again (a pure redo — it
// no longer touches the record on its own, see writingRetry below), one
// button that switches difficulty (labelled "Try harder mode" after a clean
// pass or "Switch to easier mode" after a miss, hidden entirely at either
// end of the ladder), and Next. For Free mode, the automatic verdict itself
// is only ever a SUGGESTION — the learner's own yes/no self-grade is what
// actually gets recorded.
//
// The completion MESSAGE and the RECORD are allowed to disagree, on
// purpose: finishing every stroke of a Trace/Guided attempt is praised
// every time, even if a stroke needed a retry along the way and the record
// (correct, in finishWritingCharacter below) quietly reflects that — a kid
// who got there in the end shouldn't be told "good try" as if they failed.
// That message now appears ABOVE the canvas, replacing the prompt and
// stroke count in the same slot, rather than adding new space below it.
//
// A redo (Try again) finishing cleanly is the one case where that slot shows
// a button instead of text: the record is already locked in from the first
// pass, so "Nicely done!" is replaced by "Mark this attempt as bad" — an
// explicit, opt-in way to say the original grade was too generous, rather
// than Try again silently applying that override every time. See
// writingMarkBad below.

const WRITING_SUB_MODES = ['trace', 'guided', 'free'];

/** One level up/down the difficulty ladder, or null at either end — used
 * for the "try one level harder" / "switch to <easier>" suggestions below,
 * not just the toggle itself. */
function nextHarderMode(mode) {
  if (mode === 'trace') return 'guided';
  if (mode === 'guided') return 'free';
  return null;
}
function nextEasierMode(mode) {
  if (mode === 'free') return 'guided';
  if (mode === 'guided') return 'trace';
  return null;
}

const WRITING_FEEDBACK = {
  backwards: 'Try drawing that stroke the other way.',
  'too-short': 'Keep going a bit further.',
  'too-long': 'A little short of that — try stopping sooner.',
  start: 'Start a little closer to where this stroke begins.',
  end: 'Finish a little closer to where this stroke ends.',
  'too-straight': 'This stroke should curve more — try bowing it further.',
  'wrong-bend': 'This stroke bends the other way — check which side it curves toward.',
  shape: 'Close — try following the stroke a bit more closely.',
  wild: 'That strayed quite far from the stroke — give it another go.',
};

function writingFeedbackMessage(result) {
  if (result.matchedLaterStroke != null) {
    return `That looks like stroke ${result.matchedLaterStroke + 1} — stroke ${result.strokeIndex + 1} comes first.`;
  }
  return WRITING_FEEDBACK[result.verdict] || 'Try that stroke again.';
}

function createAttemptForMode(item, mode) {
  const strictness = state.profile.settings.strictness || DEFAULT_STRICTNESS;
  return mode === 'free'
    ? createFreeAttempt(item, { strictness })
    : createWritingAttempt(item, { strictness });
}

function renderWritingQuestion(course, item) {
  const session = state.session;
  // writingModeOverride is set either from a fixed practice-mode choice made
  // before the session started (the course-screen picker) or from touching
  // the in-session toggle/a difficulty-ladder button (writingSetSubMode()) —
  // either way it wins outright. Left null ("Dynamic"), each question picks
  // its own mode fresh from THIS character's own mastery instead — see
  // autoWritingMode() in srs.js.
  const record = state.profile.progress[itemKey('writing', item)];
  const mode = session.writingModeOverride || autoWritingMode(record);
  session.writingSubMode = mode;

  const isKanji = course.kind === 'kanji';
  $('writing-romaji').hidden = isKanji;
  $('writing-romaji').textContent = isKanji ? '' : writingPromptFor(item);
  $('writing-script-label').textContent = isKanji ? '' : `Write it in ${course.name.toLowerCase()}`;
  $('writing-kanji-info').hidden = !isKanji;
  if (isKanji) renderWritingKanjiInfo(course, item);
  $('writing-peek-full').textContent = `Show full ${isKanji ? 'kanji' : 'kana'}`;
  $('writing-feedback').textContent = '';
  $('writing-feedback').className = 'hint writing-feedback';
  // In progress: prompt + stroke count. The result message that replaces
  // them lives in the same slot — see finishWritingCharacter() below.
  $('writing-prompt').hidden = false;
  $('writing-stroke-counter').hidden = false;
  $('writing-result-glyph').hidden = true;
  $('writing-result-message').hidden = true;
  $('writing-mark-bad').hidden = true;
  $('writing-result').hidden = true;
  $('writing-self-grade').hidden = true;
  $('writing-free-actions').hidden = true;
  $('writing-switch-mode').hidden = true;
  // Trace already shows the whole guide — the hint row only makes sense
  // where something is actually being hidden, and only while still in
  // progress (finishWritingCharacter hides it again once finished).
  $('writing-hints').hidden = mode === 'trace';
  // Test hook only — never rendered as text, so it can't give the answer away.
  $('screen-writing').dataset.char = item;

  WRITING_SUB_MODES.forEach((m) => { $(`writing-mode-${m}`).className = `segment${m === mode ? ' active' : ''}`; });

  session.writingGuidePaths = renderGuide($('writing-guide'), item, mode);
  session.writingAttempt = createAttemptForMode(item, mode);
  session.writingStrokes = [];
  session.writingCurrentPoints = null;
  session.writingPointerId = null;
  session.writingPeekedStrokeIndex = null;
  session.writingLastCorrect = false;
  // NOTE: session.writingRecorded is NOT reset here — this function also
  // runs for a redo or a mode-toggle switch on a question already recorded,
  // and re-arming it here would let either one write a second, conflicting
  // record. It resets only in nextQuestion() above, when the question
  // actually changes.

  const sized = setupCanvas($('writing-canvas'));
  session.writingCtx = sized ? sized.ctx : null;
  session.writingCanvasSize = sized ? { width: sized.width, height: sized.height } : { width: 300, height: 300 };
  redrawWritingCanvas();

  updateWritingStrokeCounter();

  const { done, total } = sessionProgress(session);
  $('writing-counter').textContent = `${Math.min(done + 1, total)}/${total}`;
  $('writing-progress').style.width = `${(done / Math.max(total, 1)) * 100}%`;
}

/**
 * Kanji prompt: readings and meaning are the clue, same as Yomi/Definition
 * mode — only the readings that are actually quizzed are shown, matching
 * what the lesson/detail screens teach. The example word is masked (see
 * maskKanjiWord below): it exists to show the kanji used in context, not to
 * hand over its correct form before a single stroke is drawn.
 */
function renderWritingKanjiInfo(course, kanji) {
  const info = kanjiInfo(course, kanji);
  const on = info.quizOn.join('・');
  const kun = info.quizKun.map((r) => formatReading(info, r)).join('・');
  $('writing-kanji-readings').textContent = [on && `On: ${on}`, kun && `Kun: ${kun}`].filter(Boolean).join('   ');
  $('writing-kanji-meanings').textContent = info.meanings.join(', ');
  renderWord($('writing-kanji-word'), info.words[0] ? maskKanjiWord(info.words[0], kanji) : null);
}

/** Every occurrence of the target kanji in the word's spelling becomes ○ —
 * any other kanji in a multi-character word (校 in 学校) stays visible,
 * since only the character being tested is the answer. */
function maskKanjiWord(word, kanji) {
  return { ...word, kanji: word.kanji.split(kanji).join('○') };
}

/** Switches Trace/Guided/Free for the rest of this session and re-renders
 * the CURRENT question fresh in the new mode — not a second chance at a
 * question already recorded, just a different way to look at it (see the
 * writingRecorded note in renderWritingQuestion above). Setting the override
 * here (rather than just writingSubMode) is what makes it stick for every
 * later question too, instead of being recomputed from mastery next render.
 * Session-only, deliberately NOT written back to writingModePreference: this
 * fires from both the toggle and the "try harder/easier" difficulty-ladder
 * buttons, and a quick ladder nudge on one character (still Dynamic overall)
 * is a different thing from a deliberate fixed choice made before starting —
 * only the course-screen picker (setWritingModePreference) persists. */
function writingSetSubMode(mode) {
  const session = state.session;
  if (!session) return;
  session.writingModeOverride = mode;
  session.writingSubMode = mode;
  renderQuestion();
}

function updateWritingStrokeCounter() {
  const session = state.session;
  const attempt = session && session.writingAttempt;
  if (!attempt) return;
  if (session.writingSubMode === 'free') {
    const drawn = attempt.drawnCount();
    $('writing-stroke-counter').textContent = drawn === 0 ? '' : `${drawn} stroke${drawn === 1 ? '' : 's'} drawn`;
    return;
  }
  const total = attempt.strokeCount();
  const current = Math.min(attempt.currentStrokeIndex() + 1, total);
  $('writing-stroke-counter').textContent = total ? `Stroke ${current} of ${total}` : '';
}

/**
 * For buttons that appear right after a canvas drawing gesture ends —
 * Next, Try again, Done, and the rest of the writing screen's result/self-
 * grade panel — reported to sometimes need two taps on a phone before the
 * ordinary `click` fires, even though the exact same tap always works first
 * try with a mouse. Reacting to `pointerup` directly, for touch/pen only,
 * sidesteps whatever iOS is doing when synthesizing `click` from a touch
 * sequence right after the canvas's own pointer handling. `click` is kept
 * underneath it, both for mouse (`pointerType === 'mouse'` is skipped here,
 * so desktop is unaffected) and as the only thing keyboard/assistive-tech
 * activation fires at all (no pointer events). `preventDefault` on the touch
 * pointerup suppresses the `click` that would otherwise follow it, so the
 * two paths don't both fire for the same tap.
 */
function bindTap(element, handler) {
  element.addEventListener('pointerup', (event) => {
    if (event.pointerType === 'mouse') return;
    event.preventDefault();
    handler(event);
  });
  element.addEventListener('click', (event) => handler(event));
}

/**
 * Wires a press-and-hold interaction on `button`: `onChange(true)` fires on
 * press, `onChange(false)` on release — including a pointer dragged off the
 * button (pointerleave) or an interrupted gesture (pointercancel), so a
 * peek button can never get stuck showing something it shouldn't.
 */
function bindHoldToPeek(button, onChange) {
  button.addEventListener('pointerdown', (event) => { event.preventDefault(); onChange(true); });
  button.addEventListener('pointerup', () => onChange(false));
  button.addEventListener('pointerleave', () => onChange(false));
  button.addEventListener('pointercancel', () => onChange(false));
}

/** "Show next stroke" reveals whichever stroke the attempt is currently
 * waiting on — moves on as strokes are accepted, so it's useful at any point
 * partway through, not just at the start. "Show full character" reveals
 * every stroke at Trace's faint baseline. Both are no-ops in Trace mode,
 * where the guide is already fully visible. */
function writingSetPeek(kind, on) {
  const session = state.session;
  if (!session || session.writingSubMode === 'trace' || !session.writingAttempt) return;
  if (kind === 'full') {
    setGuidePeekFull($('writing-guide'), on);
    return;
  }
  if (kind !== 'next') return;
  // Remembers which stroke was actually peeked at press-time and un-peeks
  // that SAME one on release, rather than recomputing "the next stroke" at
  // release-time — the two could differ if a stroke got accepted while the
  // button was held (a second finger drawing, on a touchscreen), which
  // would otherwise leave the originally-peeked stroke stuck showing.
  if (on) {
    const index = Math.min(session.writingAttempt.currentStrokeIndex(), (session.writingGuidePaths || []).length - 1);
    session.writingPeekedStrokeIndex = index;
    setStrokePeek(session.writingGuidePaths, index, true);
  } else if (session.writingPeekedStrokeIndex != null) {
    setStrokePeek(session.writingGuidePaths, session.writingPeekedStrokeIndex, false);
    session.writingPeekedStrokeIndex = null;
  }
}

function redrawWritingCanvas() {
  const session = state.session;
  if (!session || !session.writingCtx) return;
  const { width, height } = session.writingCanvasSize;
  const strokes = session.writingCurrentPoints
    ? [...session.writingStrokes, session.writingCurrentPoints]
    : session.writingStrokes;
  redrawInk(session.writingCtx, width, height, strokes);
}

function writingLocalPoint(canvas, event) {
  const rect = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : { left: 0, top: 0 };
  return [event.clientX - rect.left, event.clientY - rect.top];
}

function writingPointerDown(event) {
  const session = state.session;
  if (!session || !session.writingAttempt || session.writingAttempt.isComplete()) return;
  // Simple palm rejection: a second touch landing on the canvas while a
  // stroke is already in progress (a palm brushing the glass mid-stroke
  // with an Apple Pencil, most often reported) must not hijack it — only
  // the pointer that actually started the current stroke may continue it.
  // Without this, whichever pointer touches down LAST simply takes over
  // (writingPointerId below is otherwise unconditionally overwritten),
  // which can abandon an in-progress stroke partway through.
  if (session.writingCurrentPoints && event.pointerId !== session.writingPointerId) return;
  // touch-action: none on the canvas (see styles.css) already suppresses
  // scrolling/panning for touches that start here, but explicitly preventing
  // the default too heads off iOS's compatibility mouse-event/long-press
  // synthesis on top of that — belt and braces against the same class of
  // "next tap somewhere else on the page gets eaten" bug the pointer-capture
  // release below exists for.
  if (typeof event.preventDefault === 'function') event.preventDefault();
  const canvas = $('writing-canvas');
  session.writingPointerId = event.pointerId;
  session.writingCurrentPoints = [writingLocalPoint(canvas, event)];
  if (typeof canvas.setPointerCapture === 'function' && event.pointerId != null) {
    try { canvas.setPointerCapture(event.pointerId); } catch { /* not every environment supports this */ }
  }
}

function writingPointerMove(event) {
  const session = state.session;
  if (!session || !session.writingCurrentPoints || event.pointerId !== session.writingPointerId) return;
  if (typeof event.preventDefault === 'function') event.preventDefault();
  const canvas = $('writing-canvas');
  const events = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : [event];
  events.forEach((e) => session.writingCurrentPoints.push(writingLocalPoint(canvas, e)));
  redrawWritingCanvas();
}

/**
 * A completed pointer gesture is one stroke. Free mode just captures it,
 * unconditionally, and defers everything else to writingDone() below —
 * there's no live rejection or fixed stroke count to hit while the guide
 * is hidden. Trace/Guided grade it immediately: neither blocks progress on
 * a rejected stroke (unlimited retries), but a retry means the character
 * can no longer earn a correct record, only be finished (see
 * createWritingAttempt in writing.js).
 */
function writingPointerUp(event) {
  if (typeof event.preventDefault === 'function') event.preventDefault();
  // The pointer capture set in writingPointerDown is supposed to release
  // itself automatically on pointerup — this makes it explicit, on the
  // theory that the browser doing so unreliably is why the very next tap
  // elsewhere on the page (Next, most often — it's what's tapped right
  // after finishing a stroke) has been reported to sometimes need a second
  // press. Costs nothing if the browser already released it correctly.
  const canvas = $('writing-canvas');
  if (typeof canvas.releasePointerCapture === 'function' && event.pointerId != null) {
    try { canvas.releasePointerCapture(event.pointerId); } catch { /* already released, or unsupported */ }
  }

  const session = state.session;
  if (!session || !session.writingCurrentPoints || event.pointerId !== session.writingPointerId) return;
  const localPoints = session.writingCurrentPoints;
  session.writingCurrentPoints = null;
  session.writingPointerId = null;

  if (localPoints.length < 2) { redrawWritingCanvas(); return; } // a tap, not a stroke

  // A placement test only counts a character as "tried" once a real stroke
  // gesture happens on it — even one that gets rejected in Trace/Guided, but
  // not merely having the question displayed. See ensurePlacementEnrolled().
  ensurePlacementEnrolled(session.queue[session.position]);

  const { width, height } = session.writingCanvasSize;
  const modelPoints = localPoints.map((p) => toModelSpace(p, width, height));

  if (session.writingSubMode === 'free') {
    session.writingAttempt.submitStroke(modelPoints);
    session.writingStrokes.push(localPoints);
    updateWritingStrokeCounter();
    redrawWritingCanvas();
    $('writing-free-actions').hidden = false; // nothing to press Done/Undo for until there's a first stroke
    return;
  }

  const result = session.writingAttempt.submitStroke(modelPoints);

  if (result.verdict === 'ok') {
    session.writingStrokes.push(localPoints);
    markGuideStrokeDone(session.writingGuidePaths, result.strokeIndex);
    $('writing-feedback').textContent = '';
    updateWritingStrokeCounter();
  } else {
    $('writing-feedback').textContent = writingFeedbackMessage(result);
    $('writing-feedback').className = 'hint writing-feedback is-bad';
  }
  // Draw the just-accepted stroke BEFORE showing the result panel — the
  // completing stroke would otherwise never actually appear on screen.
  redrawWritingCanvas();
  if (result.verdict === 'ok' && result.complete) finishWritingCharacter();
}

/**
 * Free mode only: the learner has decided they're finished. Aligns whatever
 * was drawn against the model (see createFreeAttempt in writing.js — this
 * is also where a different stroke COUNT than the model gets handled) and
 * reveals the guide for the first time, coloured per stroke as a review.
 * The automatic verdict shown here is only ever a suggestion — it leads
 * into the self-grade step below, not straight into finishWritingCharacter.
 */
function writingDone() {
  const session = state.session;
  if (!session || !session.writingAttempt || session.writingSubMode !== 'free') return;
  const review = session.writingAttempt.finish();
  if (!review) return;

  review.perStroke.forEach((entry, index) => {
    if (entry.status !== 'extra') markGuideStrokeReview(session.writingGuidePaths, index, entry.status);
  });
  const extraCount = review.perStroke.filter((entry) => entry.status === 'extra').length;
  $('writing-feedback').textContent = extraCount > 0
    ? `${extraCount} extra stroke${extraCount === 1 ? '' : 's'} drawn — compare against the guide now shown.`
    : '';
  $('writing-feedback').className = 'hint writing-feedback';

  $('writing-self-grade-hint').textContent = review.suggestedCorrect
    ? 'That matches the stroke order and shape well.'
    : 'A few strokes look off against the guide now shown — have a look.';
  $('writing-free-actions').hidden = true;
  $('writing-self-grade').hidden = false;
}

/**
 * Free mode only: drops just the last drawn stroke, rather than the whole
 * character — the equivalent of Trace/Guided's live per-stroke rejection,
 * which Free deliberately has none of (see the module comment above
 * createWritingAttempt). Undoing the only stroke drawn hides Done/Undo
 * again, matching how that row stays hidden until the first stroke exists
 * in the first place.
 */
function writingUndo() {
  const session = state.session;
  if (!session || !session.writingAttempt || session.writingSubMode !== 'free') return;
  if (session.writingAttempt.drawnCount() === 0) return;
  session.writingAttempt.undo();
  session.writingStrokes.pop();
  redrawWritingCanvas();
  updateWritingStrokeCounter();
  $('writing-free-actions').hidden = session.writingAttempt.drawnCount() === 0;
}

/** Free mode only: the learner's own yes/no, from comparing their finished
 * drawing against the guide writingDone() just revealed — see the module
 * comment above for why this, not the automatic verdict, is what commits. */
function writingSelfGrade(correct) {
  if (!state.session) return;
  $('writing-self-grade').hidden = true;
  finishWritingCharacter(correct);
}

/**
 * Deliberately does not auto-advance: the learner reviews the finished
 * character (the guide is still visible underneath their ink) and chooses
 * what happens next. The SRS record is written the FIRST time a question is
 * completed — matching every other mode's "first attempt locks the record"
 * rule — not deferred until Next is pressed. "Try again" can complete
 * the same character a second time, purely for the look of it; that later
 * completion still updates the message and buttons below, it just can't
 * write a second, conflicting record on top of the first.
 *
 * `explicitCorrect` is how Free mode's self-grade (writingSelfGrade above)
 * provides the verdict — Trace/Guided always finish this via
 * attempt.isCorrect() instead, since there's no separate self-grade step.
 */
function finishWritingCharacter(explicitCorrect) {
  const session = state.session;
  const item = session.queue[session.position];
  const isAutomatic = explicitCorrect === undefined;
  const correct = isAutomatic ? session.writingAttempt.isCorrect() : explicitCorrect;
  session.writingLastCorrect = correct; // read by writingRetry() and the switch-mode button below

  const wasAlreadyRecorded = !!session.writingRecorded; // this finish is a redo, not the first pass
  if (!session.writingRecorded) {
    session.writingRecorded = true;
    recordResult(item, correct);
  }

  $('writing-feedback').textContent = '';
  // Hints only made sense while something was still hidden to peek at or a
  // level down was worth escaping to mid-attempt — once finished, neither
  // applies, and the space is worth reclaiming (see writing-mode-plan.md).
  $('writing-hints').hidden = true;

  // The message replaces the prompt/stroke-count in the SAME slot above the
  // canvas, rather than adding new space below it — see index.html. It's
  // about what the learner just watched happen, not about what got written
  // to spaced repetition — those are allowed to disagree. Finishing every
  // stroke reads as "I wrote it" even if a stroke needed a retry along the
  // way, so Trace/Guided always praise it here; only the record (correct,
  // above) carries the retry. Free mode's message DOES follow correct,
  // because there explicitCorrect is the learner's own yes/no self-grade,
  // not an automatic verdict being softened at them.
  $('writing-prompt').hidden = true;
  $('writing-stroke-counter').hidden = true;
  // A clean redo shows the "mark this as bad" button in this slot instead of
  // praise, since there's no more praise to give that isn't already on
  // record — see the module comment above and writingMarkBad below.
  const showMarkBad = wasAlreadyRecorded && (isAutomatic || correct);
  $('writing-result-message').hidden = showMarkBad;
  $('writing-mark-bad').hidden = !showMarkBad;
  $('writing-result-message').textContent = (isAutomatic || correct)
    ? 'Nicely done!'
    : 'Okay — marked for more practice.';

  // One button whose label/target adapts to the outcome, never both — see
  // the module comment above #writing-result in index.html.
  const target = correct ? nextHarderMode(session.writingSubMode) : nextEasierMode(session.writingSubMode);
  const switchButton = $('writing-switch-mode');
  switchButton.hidden = !target;
  switchButton.textContent = correct ? 'Try harder mode' : 'Switch to easier mode';

  $('writing-result').hidden = false;

  // Safe to show now, and safe to make tappable (clickQuizGlyph's writing
  // equivalent is wired directly to this button) — the outcome above has
  // already said whether it was right, so there is nothing left here for
  // the character itself to give away. See the section comment up top for
  // why it stays hidden right up until this point.
  const course = getAnyCourse(state.courseId);
  const glyph = $('writing-result-glyph');
  glyph.hidden = false;
  glyph.textContent = item;
  // The example word was masked (renderWritingKanjiInfo/maskKanjiWord) for
  // the same reason the glyph itself was hidden — same "answer's already in"
  // logic applies, so it's rebuilt here unmasked and drillable (buildWordRow),
  // same upgrade showKanjiInfo gives the quiz screens' own example word.
  if (course.kind === 'kanji') renderWritingResultWord(course, item);
}

function renderWritingResultWord(course, kanji) {
  const wordEl = $('writing-kanji-word');
  wordEl.innerHTML = '';
  const info = kanjiInfo(course, kanji);
  if (info.words[0]) {
    wordEl.appendChild(buildWordRow(info.words[0], openWritingCharacterDetail, () => renderWritingResultWord(course, kanji)));
  }
}

/** buildWordRow's/fillWordKanjiChips' `open` callback for Writing mode's own
 * post-answer example word, and what #writing-result-glyph itself opens too
 * (bound in wire()) — a 'writing' returnTo, added alongside 'quiz' in the
 * 'detail-back' case, so Back lands right back on this still-graded screen
 * instead of losing the result. */
function openWritingCharacterDetail(course, char) {
  openCharacterDetail(course, char, 'writing');
}

/**
 * "Try again" is a pure redo — it does not touch the record. Redoing
 * something already recorded correct used to also fold in a quiet "mark as
 * not known" override; that's now a separate, explicit choice (see
 * writingMarkBad below), because wanting a neater attempt isn't the same
 * thing as not trusting the grade, and folding them together meant every
 * redo silently cost the learner their box progress.
 */
function writingRetry() {
  const session = state.session;
  if (!session || !session.writingAttempt) return;
  const mode = session.writingSubMode || 'trace';
  const item = session.queue[session.position];

  session.writingAttempt.restart();
  session.writingStrokes = [];
  session.writingCurrentPoints = null;
  session.writingPeekedStrokeIndex = null;
  // Rebuilding the guide (rather than stripping classes off the old one)
  // resets it to fully blank/faint per the current mode in one call — see
  // renderGuide() in writing.js.
  session.writingGuidePaths = renderGuide($('writing-guide'), item, mode);
  redrawWritingCanvas();
  updateWritingStrokeCounter();

  $('writing-prompt').hidden = false;
  $('writing-stroke-counter').hidden = false;
  $('writing-result-message').hidden = true;
  $('writing-mark-bad').hidden = true;
  $('writing-hints').hidden = mode === 'trace';
  $('writing-result').hidden = true;
  $('writing-self-grade').hidden = true;
  $('writing-free-actions').hidden = true;
  $('writing-switch-mode').hidden = true;
  $('writing-feedback').textContent = '';
}

/**
 * The explicit override, shown only in place of "Nicely done!" after a redo
 * (see finishWritingCharacter above) — the learner is saying the ORIGINAL
 * pass shouldn't have counted as correct, not grading this redo. A schedule
 * correction, not a second grading event: seen/lapses/history stay exactly
 * as recordResult() already left them from the first pass; only the box and
 * due date move, so this can't be mistaken for a second real attempt if the
 * history is inspected later.
 */
function writingMarkBad() {
  const session = state.session;
  if (!session) return;
  const item = session.queue[session.position];
  const record = state.profile.progress[itemKey('writing', item)];
  if (record) {
    record.box = 0;
    record.due = Date.now();
    store.saveProfile(state.profile);
  }
  session.results.set(item, false);

  $('writing-mark-bad').hidden = true;
  $('writing-result-message').hidden = false;
  $('writing-result-message').textContent = 'Okay — marked for more practice.';
}

// --- Kanji: click a reading, it turns green or red immediately ---------
//
// Every reading is graded the instant it's clicked, individually — not the
// kanji as a whole. Whatever was clicked correctly *before the first wrong
// click* counts as correct in that reading's own pass/fail record; whatever
// was still unclicked at that moment counts as incorrect, permanently, even
// if the learner goes on to find it afterward while "learning". Finding
// everything (through discovery after a miss, or via Show answers) still
// unlocks Next — that gate is about the UI, not about rewriting the record.

function renderKanjiChoices(course, kanji) {
  const session = state.session;
  const { progress } = state.profile;
  const { options, correct } = buildKanjiOptions(course, kanji, state.mode, progress);

  session.kanjiCorrect = new Set(correct);
  session.kanjiShown = new Set(options);
  session.kanjiPendingRecord = new Set(correct); // not yet graded
  session.kanjiUndiscovered = new Set(correct); // not yet revealed green
  session.kanjiErrorMade = false;
  session.kanjiRoundRecorded = false;
  session.kanjiRoundOver = false;

  $('quiz-ok').hidden = true; // becomes "Next" once the round resolves
  $('quiz-kanji-actions').hidden = false;
  $('quiz-show-answers').hidden = false;
  $('quiz-show-answers').disabled = false;
  const info = kanjiInfo(course, kanji);
  $('quiz-advanced').hidden = info.quizReadings.length <= correct.size;
  $('quiz-advanced').disabled = false;

  const choices = $('quiz-choices');
  // Reset the layout class explicitly. #quiz-choices is a single element
  // reused by every session, and renderSingleChoice() below leaves
  // 'choice-grid-text' (a literal two-column CSS Grid, sized for English
  // definitions) on it. Without this, a Yomi session started after any
  // Definition session inherited that class and laid ten readings out as
  // two columns of five on a phone that had room for four across.
  choices.className = 'choice-grid';
  options.forEach((reading) => addKanjiChoiceButton(choices, info, reading));
}

function addKanjiChoiceButton(choices, info, reading) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'choice';
  button.textContent = formatReading(info, reading);
  button.dataset.reading = reading;
  button.addEventListener('click', () => clickKanjiReading(reading, button));
  choices.appendChild(button);
}

/**
 * Once the round is over, clicking a reading no longer grades anything — it
 * shows the example word anchored to that specific reading instead, which is
 * most useful for a rare reading (a kanji's "Shanghai" reading is easy to
 * forget without seeing it in the word that actually uses it).
 */
function clickKanjiReading(reading, button) {
  const session = state.session;
  if (!session || button.disabled) return;

  if (session.kanjiRoundOver) {
    showReadingExample(reading, button);
    return;
  }

  const kanji = session.queue[session.position];
  const course = getAnyCourse(state.courseId);
  const isCorrect = session.kanjiCorrect.has(reading);
  button.disabled = true;

  if (isCorrect) {
    button.classList.add('is-right');
    session.kanjiUndiscovered.delete(reading);
    if (!session.kanjiErrorMade) {
      recordYomiResult(course, kanji, reading, true);
      session.kanjiPendingRecord.delete(reading);
    }
    // A correct click after the error boundary is pure discovery: the
    // record was already sealed incorrect the moment the error happened.
  } else {
    button.classList.add('is-wrong');
    if (!session.kanjiErrorMade) markKanjiError(kanji, course);
  }

  store.saveProfile(state.profile);
  checkKanjiRoundComplete();
}

/** The first wrong click of a round: seals every still-pending reading's
 * record as a miss. See the matching note in chooseAnswer() — a miss no
 * longer reinserts the kanji for a fresh attempt later this session; the
 * summary offers to go practise it afterward instead. */
function markKanjiError(kanji, course) {
  const session = state.session;
  session.kanjiErrorMade = true;
  session.kanjiPendingRecord.forEach((reading) => recordYomiResult(course, kanji, reading, false));
  session.kanjiPendingRecord.clear();
  recordKanjiRoundOutcome(kanji, false);

  $('quiz-card').className = 'quiz-card is-wrong';
  $('quiz-feedback').className = 'feedback bad';
  $('quiz-feedback').textContent = 'Keep exploring, or tap Show answers';
}

/** "Show answers": reveals whatever is still undiscovered. If no error has
 * happened yet, this moment itself becomes the error boundary. */
function showKanjiAnswers() {
  const session = state.session;
  if (!session || session.kanjiUndiscovered.size === 0) return;
  const kanji = session.queue[session.position];
  const course = getAnyCourse(state.courseId);

  if (!session.kanjiErrorMade) markKanjiError(kanji, course);

  $('quiz-choices').querySelectorAll('.choice').forEach((button) => {
    if (session.kanjiUndiscovered.has(button.dataset.reading)) {
      button.classList.add('is-right');
      button.disabled = true;
    }
  });
  session.kanjiUndiscovered.clear();
  store.saveProfile(state.profile);
  checkKanjiRoundComplete();
}

/** "Advanced": grows the grid in place with the remaining readings from the
 * pool (up to 6) rather than rebuilding it, so existing taps are untouched. */
function expandKanjiAdvanced() {
  const session = state.session;
  if (!session || !session.kanjiShown) return;
  const kanji = session.queue[session.position];
  const course = getAnyCourse(state.courseId);
  const info = kanjiInfo(course, kanji);
  const { additions, newCorrect } = buildAdvancedAdditions(course, kanji, session.kanjiShown);

  const choices = $('quiz-choices');
  additions.forEach((reading) => {
    addKanjiChoiceButton(choices, info, reading);
    session.kanjiShown.add(reading);
  });

  newCorrect.forEach((reading) => {
    session.kanjiCorrect.add(reading);
    session.kanjiUndiscovered.add(reading);
    if (session.kanjiErrorMade) {
      // The error boundary already passed, so a reading that only just
      // appeared can never have been selected "before" it.
      recordYomiResult(course, kanji, reading, false);
    } else {
      session.kanjiPendingRecord.add(reading);
    }
  });

  $('quiz-advanced').hidden = true;
  store.saveProfile(state.profile);
}

/**
 * Placement tests ("Test unlearned") enroll one item at a time, the moment
 * the learner actually engages with it, rather than the whole batch upfront
 * — quitting after one kanji must not leave the rest of the unit marked
 * "waiting to learn" when nothing was ever attempted on them. Called from
 * wherever "actually tried" happens per mode: recordResult/recordYomiResult
 * (a choice was clicked — grading happens in the same breath there) and
 * writingPointerUp (a real stroke was drawn, whether or not it was accepted
 * or the character ever got finished). No-op outside a placement session,
 * for kana (no study list to enroll into), and for anything already
 * enrolled (a genuine re-attempt, or previously hand-added).
 */
function ensurePlacementEnrolled(item) {
  const session = state.session;
  if (!session || !session.placementTest) return;
  const course = getAnyCourse(state.courseId);
  if (!course || (course.kind !== 'kanji' && course.kind !== 'vocab')) return;
  if (isStudying(state.profile.study, item, state.mode)) return;
  setStudying(state.profile.study, state.profile.unstudy, item, state.mode, true);
  store.saveProfile(state.profile);
}

function recordYomiResult(course, kanji, reading, correct) {
  ensurePlacementEnrolled(kanji);
  const { progress } = state.profile;
  const key = yomiKey(state.mode, kanji, reading);
  const placement = !!(state.session && state.session.placementTest);
  progress[key] = gradeYomi(progress[key] || newYomiRecord(), correct, Date.now(), { placement });
  recomputeKanjiRollup(course, kanji, state.mode, progress);
}

/** The kanji-level (not reading-level) pass/fail for this round, recorded
 * exactly once — used for the session summary, same as kana's first-attempt
 * tracking. Kanji-level scheduling itself comes from recomputeKanjiRollup. */
function recordKanjiRoundOutcome(kanji, perfect) {
  const session = state.session;
  if (session.kanjiRoundRecorded) return;
  session.kanjiRoundRecorded = true;
  if (!session.results.has(kanji)) session.results.set(kanji, perfect);
}

function checkKanjiRoundComplete() {
  const session = state.session;
  if (session.kanjiUndiscovered.size > 0) return;
  const kanji = session.queue[session.position];
  if (!session.kanjiErrorMade) recordKanjiRoundOutcome(kanji, true);
  finalizeKanjiRound(kanji);
}

function finalizeKanjiRound(kanji) {
  const course = getAnyCourse(state.courseId);
  const session = state.session;
  session.kanjiRoundOver = true;

  // Correct readings stay clickable after the round — that's now how their
  // example word is shown. Distractors have nothing more to offer.
  $('quiz-choices').querySelectorAll('.choice').forEach((button) => {
    button.disabled = !session.kanjiCorrect.has(button.dataset.reading);
  });
  $('quiz-kanji-actions').hidden = true;
  $('quiz-show-answers').hidden = true;
  $('quiz-advanced').hidden = true;
  $('quiz-ok').hidden = false;
  $('quiz-ok').textContent = 'Next';
  $('quiz-kana').classList.add('quiz-glyph-tap');

  const perfect = !session.kanjiErrorMade;
  $('quiz-card').className = `quiz-card ${perfect ? 'is-correct' : 'is-wrong'}`;
  $('quiz-feedback').className = `feedback ${perfect ? 'ok' : 'bad'}`;
  $('quiz-feedback').textContent = perfect ? '' : 'Found them all';
  showKanjiInfo(course, kanji);
  store.saveProfile(state.profile);
}

/**
 * The info panel shown once a kanji question resolves. In Yomi mode the
 * useful extra context is what the kanji means; in Definition mode (where the
 * meaning *was* the answer) it's how the kanji is read instead.
 */
function showKanjiInfo(course, kanji) {
  const info = kanjiInfo(course, kanji);
  const isYomi = state.mode === 'recognition';
  $('quiz-meanings').textContent = isYomi
    ? info.meanings.join(', ')
    : info.quizReadings.map((r) => formatReading(info, r)).join(' · ');
  const wordEl = $('quiz-word');
  wordEl.innerHTML = '';
  // A drillable word row (buildWordRow), not the plain renderWord() this
  // used before — the question is over, so there's nothing left to protect
  // by keeping the example word inert. Tap it for its own kanji chips, a
  // way through to its full word page, and a one-tap Add if it isn't
  // studied yet — the same "click wherever possible" a kanji detail
  // screen's own Common words list already offers.
  if (info.words[0]) {
    wordEl.appendChild(buildWordRow(info.words[0], openQuizExampleDetail, () => showKanjiInfo(course, kanji)));
  }
  // "below", not "above": this panel now sits directly under the character
  // it describes, with the readings underneath it. See index.html.
  // Kept to one line: on a short phone this panel, the character above it
  // and every answer below it all have to fit between the header and the
  // Next bar, and a second line of hint is the least valuable of them.
  $('quiz-word-hint').textContent = isYomi && state.session.kanjiCorrect.size > 1
    ? 'Tap a green reading for its example word.'
    : '';
  $('quiz-info').hidden = false;
}

/** "Full details →" on the info panel: the whole detail screen (stroke
 * order, every reading, common words) for the character just answered,
 * without ending the session — see openCharacterDetail()'s 'quiz' returnTo
 * and the 'detail-back' case in wire(). Also what the tested glyph itself
 * opens once answered (clickQuizGlyph). */
function openQuizCharacterDetail() {
  const session = state.session;
  if (!session) return;
  openCharacterDetail(getAnyCourse(state.courseId), session.queue[session.position], 'quiz');
}

/** buildWordRow's/fillWordKanjiChips' `open` callback for the quiz
 * screen's own post-answer info panel — same 'quiz' returnTo as the tested
 * character's own "Full details", just for a kanji chip or vocab link
 * inside the EXAMPLE word instead (showKanjiInfo, showReadingExample). */
function openQuizExampleDetail(course, char) {
  openCharacterDetail(course, char, 'quiz');
}

/** The tested glyph/word itself (#quiz-kana), made tappable once a question
 * is answered — every mode's own post-answer function adds the
 * .quiz-glyph-tap class right where it reveals Next (chooseAnswer,
 * finalizeKanjiRound, finishVocabDefinitionStage, chooseVocabYomi,
 * finishVocabProdStage, chooseVocabSpell), and renderQuestion()'s own
 * unconditional className reset clears it again for the next question. A
 * no-op otherwise, so a mid-question tap can never leak or distract from an
 * answer still being worked out. */
function clickQuizGlyph() {
  if (!$('quiz-kana').classList.contains('quiz-glyph-tap')) return;
  openQuizCharacterDetail();
}

/** #quiz-back-previous (placement only, see renderQuestion()'s toggle) — a
 * look at the item just answered, not a rewind: session.position, .attempt
 * and .results are untouched, so this can never re-grade or re-order
 * anything already recorded. session.queue is a fixed-order array built
 * once at session start (never mutated), so the previous slot is always
 * exactly what was just asked. */
function openPreviousPlacementDetail() {
  const session = state.session;
  if (!session || session.position === 0) return;
  openCharacterDetail(getAnyCourse(state.courseId), session.queue[session.position - 1], 'quiz');
}

function renderWord(wordEl, word) {
  wordEl.innerHTML = '';
  if (!word) return;
  wordEl.innerHTML = '<span class="word-kanji"></span><span class="word-kana"></span><span class="word-en"></span>';
  wordEl.querySelector('.word-kanji').textContent = word.kanji;
  wordEl.querySelector('.word-kana').textContent = `(${word.kana})`;
  wordEl.querySelector('.word-en').textContent = word.en;
}

/** Post-round: show the word anchored to the clicked reading. Every quizzed
 * reading has one, since the build script drops readings that don't. */
function showReadingExample(reading, button) {
  const course = getAnyCourse(state.courseId);
  const kanji = state.session.queue[state.session.position];
  $('quiz-choices').querySelectorAll('.choice.is-active').forEach((el) => el.classList.remove('is-active'));
  button.classList.add('is-active');

  const example = readingExample(course, kanji, reading);
  const wordEl = $('quiz-word');
  wordEl.innerHTML = '';
  // Drillable (buildWordRow), same reasoning as showKanjiInfo above — the
  // round is over, so this example is free to be explored too.
  if (example) {
    wordEl.appendChild(buildWordRow(example, openQuizExampleDetail, () => showReadingExample(reading, button)));
  } else {
    wordEl.textContent = `No common example word found for ${reading}.`;
  }
}

/**
 * Whichever "carry on" button is on screen and actually pressable right now,
 * or null. Drives the Enter-key shortcut wired in wire(); each of these is
 * hidden by its own screen until it means something, so visibility is the
 * whole test. Ordered by screen, and at most one screen is ever visible.
 */
function primaryAdvanceButton() {
  const candidates = [
    // [screen, button, the wrapper that gates it (writing's Next is never
    // hidden itself — the whole result card it sits in is what appears)]
    ['screen-quiz', 'quiz-ok', null],                   // graded question -> Next
    ['screen-writing', 'writing-next', 'writing-result'], // finished character -> Next
    ['screen-lesson', 'lesson-next', null],             // taught character -> Next / Start quiz
  ];
  for (const [screenId, buttonId, wrapperId] of candidates) {
    if ($(screenId).hidden) continue;
    if (wrapperId && $(wrapperId).hidden) continue;
    const button = $(buttonId);
    if (!button.hidden && !button.disabled) return button;
  }
  return null;
}

function nextQuestion() {
  const session = state.session;
  if (!session) return;
  // Vocabulary's two-part questions (Meaning's definition -> reading,
  // Recall's word -> spelling) resolve one part at a time behind this SAME
  // "Next" button rather than the app's usual one-question-per-press: a
  // correct first part pauses here, still green, with `vocabNextStage` set
  // to whatever begins the second part instead of advancing to a new item.
  // See finishVocabDefinitionStage/finishVocabProdStage — without this
  // pause the two parts used to swap on the very same click that graded the
  // first one, changing the question out from under the click that had
  // just landed.
  if (session.vocabNextStage) {
    const beginNextStage = session.vocabNextStage;
    session.vocabNextStage = null;
    beginNextStage();
    return;
  }
  clearTimeout(session.pendingAdvance);
  session.pendingAdvance = null;
  session.position += 1;
  // Writing only: a NEW question hasn't been recorded yet. Deliberately not
  // reset in renderWritingQuestion() itself, which also runs for a redo or
  // a mode-toggle switch on the SAME question — those must not re-arm a
  // second recordResult() call for something already graded.
  session.writingRecorded = false;
  renderQuestion();
}

function recordResult(kana, correct) {
  ensurePlacementEnrolled(kana);
  const session = state.session;
  const { progress } = state.profile;
  const key = itemKey(state.mode, kana);
  progress[key] = grade(progress[key] || newRecord(), correct, Date.now(), { placement: session.placementTest });
  // The summary reflects the first attempt at each character.
  if (!session.results.has(kana)) session.results.set(kana, correct);
  store.saveProfile(state.profile);
}

function finishSession() {
  const session = state.session;
  const course = getAnyCourse(state.courseId);
  // "Practise N missed" (below) carries the PRIOR summary's full result set
  // forward as session.carriedResults, so a learner who got 9 of 10 right,
  // then went and practised the one they missed, sees all 10 here — not
  // just the one just-practised character — and can actually see the
  // percentage go up rather than a brand new "1 of 1" that throws away the
  // 9 they already had right. Map#set on an existing key updates the value
  // in place without moving it, so the just-practised character keeps its
  // original position in the chip grid; only its colour changes.
  const merged = session.carriedResults ? new Map(session.carriedResults) : new Map();
  session.results.forEach((ok, item) => merged.set(item, ok));
  const entries = [...merged.entries()];
  const right = entries.filter(([, ok]) => ok).length;

  // "First time" stops being accurate once results are carried forward —
  // some of these are second (or later) attempts by definition.
  $('summary-score').textContent = entries.length
    ? `${right} of ${entries.length} right${session.carriedResults ? '' : ' first time'}`
    : 'Nothing to review right now.';

  const list = $('summary-list');
  list.innerHTML = '';
  entries.forEach(([item, ok]) => {
    // A button, not a div — tapping opens the detail screen (stroke order,
    // readings, and now the study-list controls) for whatever just showed up
    // in the summary, right where seeing a miss makes you want to look closer
    // or seeing a pass makes you want to add writing practice for it.
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = `chip ${ok ? 'chip-ok' : 'chip-bad'}`;
    chip.innerHTML = `<span class="chip-kana"></span><span class="chip-romaji"></span>`;
    let label = romajiFor(item);
    // Vocab ids are the surface form (or surface|reading on a homograph
    // collision, vocab-plan.md §3.3) — .w and .en[0] are what a chip
    // actually shows. The word detail screen understands vocab entries as of
    // §7, so these link through exactly like the kanji/kana chips below
    // rather than being the one dead chip on the screen.
    if (course.kind === 'vocab') {
      const info = vocabInfo(course, item);
      chip.querySelector('.chip-kana').textContent = info.w;
      chip.querySelector('.chip-romaji').textContent = info.en[0];
      chip.addEventListener('click', () => openCharacterDetail(course, item, 'summary'));
      list.appendChild(chip);
      return;
    }
    chip.querySelector('.chip-kana').textContent = item;
    if (course.kind === 'kanji') {
      const info = kanjiInfo(course, item);
      label = state.mode === 'definition'
        ? meaningLabel(info)
        : (info.quizReadings[0] ? formatReading(info, info.quizReadings[0]) : '');
    }
    chip.querySelector('.chip-romaji').textContent = label;
    chip.addEventListener('click', () => openCharacterDetail(course, item, 'summary'));
    list.appendChild(chip);
  });

  // No session — placement or otherwise — re-teaches what it found missing
  // in the same breath: a miss no longer comes back later in the queue (see
  // chooseAnswer()/markKanjiError() above), so the summary is the one place
  // "now what" gets answered instead. `state.summaryMissed` is read by the
  // 'study-missed' action below, after `state.session` is cleared;
  // `state.summaryMissedIsPlacement` decides whether that action needs a
  // lesson step first — a placement miss was never taught at all (the
  // placement quiz has no lesson step of its own), everything else was.
  // `state.summaryAllResults` is `merged` itself, carried forward so that if
  // THIS summary's "practise missed" is used and something is missed again,
  // the summary after that also shows the whole picture, not just the
  // latest retry — the carry-forward chains for as many rounds as it takes.
  const missed = entries.filter(([, ok]) => !ok).map(([item]) => item);
  state.summaryMissed = missed;
  state.summaryAllResults = merged;
  state.summaryMissedIsPlacement = session.placementTest;
  const studyMissedButton = $('summary-study-missed');
  studyMissedButton.hidden = missed.length === 0;
  studyMissedButton.innerHTML = session.placementTest
    ? `Study <b>${missed.length}</b> missed`
    : `Practise <b>${missed.length}</b> missed`;

  // Offer the same two choices as the home screen, so carrying on with more
  // new characters does not mean navigating back out first.
  const stats = courseStats(course, state.mode, state.profile);
  const newCount = Math.min(stats.fresh, state.profile.settings.newPerSession);
  // The true waiting count, not newCount — see renderQuickActions()'s own
  // waitingCount for why these can't share one number.
  const waitingCount = Math.min(stats.pending, state.profile.settings.newPerSession);

  // Only one button reads as "the" primary action. Practise-missed outranks
  // both of the below whenever it's offered, since going over what was just
  // gotten wrong matters more than starting or continuing anything else.
  // Below that, review-due outranks learn-new — same "due outranks new"
  // precedence the home screen's quick actions and the course card already
  // use — so this no longer leaves a real due count sitting unhighlighted
  // next to a highlighted "Learn new" just because nothing was missed.
  const reviewButton = $('summary-review');
  reviewButton.hidden = stats.due === 0;
  reviewButton.classList.toggle('btn-primary', missed.length === 0 && stats.due > 0);
  reviewButton.innerHTML = `Review <b>${stats.due}</b> due`;

  const learnButton = $('summary-learn');
  learnButton.classList.toggle('btn-primary', missed.length === 0 && stats.due === 0);
  learnButton.hidden = newCount === 0;
  // "Waiting" for the same reason renderQuickActions()/renderCourse()'s own
  // Learn buttons say it — a manually-added character or word sitting
  // enrolled but never taught is a different thing from the next untouched
  // item in course order, and this screen is exactly where a learner who
  // just finished a "Learn N waiting" session would next see it mislabelled
  // "N new" if this weren't here too.
  learnButton.innerHTML = course.kind !== 'kana' && stats.pending > 0
    ? `Learn <b>${waitingCount}</b> waiting`
    : `Learn <b>${newCount}</b> new`;

  // Nothing else on offer — no miss to go fix, nothing new queued up, and
  // (this being the case that prompted the request) a review session that
  // just cleared the due queue to zero. "Practise again" is a plain .btn,
  // which reads as the de facto highlighted option next to the quieter
  // "Back to menu" below it even though neither is marked primary — so once
  // there is truly nothing left to do, promote leaving over restarting.
  const backButton = $('summary-back');
  const nothingLeft = missed.length === 0 && newCount === 0 && stats.due === 0;
  backButton.classList.toggle('btn-primary', nothingLeft);
  backButton.classList.toggle('btn-quiet', !nothingLeft);

  state.session = null;
  store.saveProfile(state.profile);
  show('screen-summary');
  // The natural boundary to send a session's work — state.session is
  // already null above, which is what lets autoSync run at all (§4.4).
  autoSync({ force: true });
}

// --- Settings, backup, transfer ------------------------------------------

function strictnessName(level) {
  const found = STRICTNESS_LEVELS.find((l) => l.id === level);
  return found ? found.name : 'Normal';
}

function renderSettings() {
  const hasProfile = !!state.profile;
  // Remember where settings was opened from, so Back returns there rather
  // than dumping the learner at the top level.
  const current = [...screens()].find((el) => !el.hidden);
  state.settingsReturn = current ? current.id : 'screen-home';
  document.querySelectorAll('.profile-only').forEach((el) => { el.hidden = !hasProfile; });
  if (hasProfile) {
    syncProfileEmojiSelection();
    syncColorPickerSelection();
    $('new-per-session').value = state.profile.settings.newPerSession;
    $('new-per-session-value').textContent = state.profile.settings.newPerSession;
    const strictness = state.profile.settings.strictness || DEFAULT_STRICTNESS;
    $('writing-strictness').value = strictness;
    $('writing-strictness-value').textContent = strictnessName(strictness);
  }
  $('app-version').textContent = APP_VERSION;
  $('transfer-status').textContent = '';
  renderChangelog();
  if (hasProfile) {
    // Reset synchronously, right now — not inside renderSyncCard() below,
    // which finishes whenever its IndexedDB read happens to resolve and
    // would otherwise race a tap on "Enter a code" that lands first.
    $('sync-code-entry').hidden = true;
    $('sync-code-input').value = '';
    // Not awaited: the read shouldn't delay the screen itself appearing,
    // only the rest of the sync card filling in a moment after it does.
    renderSyncCard();
  }
  show('screen-settings');
}

/** "What's new" (CHANGELOG[0], from the hand-maintained src/changelog.js)
 * is always shown; everything older is built into #changelog-history,
 * collapsed, behind the toggle. Rebuilt fresh (and re-collapsed) every time
 * Settings opens, rather than trying to remember whether it was left
 * expanded. */
function renderChangelog() {
  const [latest, ...previous] = CHANGELOG;

  $('changelog-current-date').textContent = latest.date;
  const currentList = $('changelog-current-list');
  currentList.innerHTML = '';
  latest.changes.forEach((change) => {
    const li = document.createElement('li');
    li.textContent = change;
    currentList.appendChild(li);
  });

  const history = $('changelog-history');
  history.innerHTML = '';
  previous.forEach((entry) => {
    const block = document.createElement('div');
    block.className = 'changelog-entry';
    const date = document.createElement('p');
    date.className = 'hint changelog-date';
    date.textContent = entry.date;
    block.appendChild(date);
    const list = document.createElement('ul');
    list.className = 'changelog-list';
    entry.changes.forEach((change) => {
      const li = document.createElement('li');
      li.textContent = change;
      list.appendChild(li);
    });
    block.appendChild(list);
    history.appendChild(block);
  });
  history.hidden = true;

  const toggle = $('changelog-toggle');
  toggle.hidden = previous.length === 0;
  toggle.textContent = 'Show previous updates';
}

function toggleChangelogHistory() {
  const history = $('changelog-history');
  history.hidden = !history.hidden;
  $('changelog-toggle').textContent = history.hidden ? 'Show previous updates' : 'Hide previous updates';
}

async function exportBackup() {
  const data = await store.exportAll();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `kana-quest-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  $('transfer-status').textContent = 'Backup saved. Keep it somewhere safe (email it to yourself, or drop it in cloud storage).';
}

async function importBackup(file) {
  try {
    const data = JSON.parse(await file.text());
    const { added, merged } = await store.importAll(data);
    $('transfer-status').textContent = `Loaded: ${added} new learner(s), ${merged} merged.`;
    // Reload whatever profile is open so the screen reflects the merge.
    if (state.profile) state.profile = await store.getProfile(state.profile.id);
  } catch (error) {
    $('transfer-status').textContent = error.message || 'Could not read that file.';
  }
}

// --- Sync across devices ----------------------------------------------------
// sync-plan.md §5. Phase 2: every action here is something a parent taps —
// there is no automatic pull-on-launch or push-on-save yet (phase 3), so
// there is also no risk yet of a pull landing mid-question (§4.4) — Settings
// is never reachable from inside a running session in the first place.

const SYNC_BUTTON_IDS = ['sync-turn-on', 'sync-show-code-entry', 'sync-pair-submit', 'sync-now', 'sync-turn-off', 'sync-copy-code', 'sync-share-code'];

function setSyncBusy(busy) {
  SYNC_BUTTON_IDS.forEach((id) => { $(id).disabled = busy; });
  $('sync-code-input').disabled = busy;
}

function formatRelativeTime(ms) {
  const diffSeconds = Math.round((Date.now() - ms) / 1000);
  if (diffSeconds < 45) return 'just now';
  const minutes = Math.round(diffSeconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

function syncStatusText(syncState) {
  const last = Math.max(syncState.lastPulledAt || 0, syncState.lastPushedAt || 0);
  return last ? `Last synced ${formatRelativeTime(last)}.` : 'Not synced yet.';
}

/** Renders the current pairing state into the two panels the markup already
 * has (§5's "not yet syncing" / "syncing" mockups) and, unless a caller
 * passes its own message (a result just worth saying plainly, e.g. "Merged
 * — brought in 3 updates"), falls back to the default last-synced text. */
async function renderSyncCard(statusOverride) {
  if (!state.profile) return;
  const syncState = await store.getSyncState(state.profile.id);
  $('sync-configured').hidden = !syncState;
  $('sync-not-configured').hidden = !!syncState;
  if (syncState) $('sync-code-value').textContent = syncState.code;
  // navigator.share has no reliable feature query beyond its own presence —
  // desktop browsers mostly lack it, so those learners fall back to Copy
  // code, which is always shown regardless.
  $('sync-share-code').hidden = typeof navigator.share !== 'function';
  // syncStatusText assumes a real pairing record; a profile that has never
  // synced has none, and every Settings open runs this path (renderSettings
  // calls renderSyncCard() unconditionally) — so this was throwing on every
  // never-paired profile. The panel toggles above already ran by then and
  // rendered correctly regardless, which is exactly why it went unnoticed.
  $('sync-status').textContent = statusOverride !== undefined
    ? statusOverride
    : (syncState ? syncStatusText(syncState) : '');
}

// Dismissing hides the home-screen nudge for the rest of THIS browser
// session only, per profile — same reasoning as INSTALL_DISMISSED_KEY: the
// underlying risk (this learner's progress living on one device only) is
// still there next time the app is opened, so it is not dismissed forever.
const SYNC_NUDGE_DISMISSED_KEY = 'kana-quest-sync-nudge-dismissed';

function syncNudgeDismissedProfileIds() {
  try {
    return new Set(JSON.parse(sessionStorage.getItem(SYNC_NUDGE_DISMISSED_KEY) || '[]'));
  } catch {
    return new Set(); // private browsing etc. — err toward still showing it
  }
}

function dismissSyncNudge(profileId) {
  const ids = syncNudgeDismissedProfileIds();
  ids.add(profileId);
  try {
    sessionStorage.setItem(SYNC_NUDGE_DISMISSED_KEY, JSON.stringify([...ids]));
  } catch { /* private browsing etc. */ }
}

/** Home screen only, unlike renderSyncCard (Settings) — a plain-language
 * nudge for the learner who has never turned sync on at all, rather than
 * status for one who already has. */
async function renderSyncNudge() {
  const profile = state.profile;
  const banner = $('sync-nudge');
  if (!profile) { banner.hidden = true; return; }
  const syncState = await store.getSyncState(profile.id);
  banner.hidden = !!syncState || syncNudgeDismissedProfileIds().has(profile.id);
}

function syncFailureMessage(outcome) {
  if (outcome === 'too-large') {
    return "This learner's progress has grown too large to sync — that shouldn't normally happen. Try again later.";
  }
  if (outcome === 'conflict') return 'Could not finish syncing right now — try again in a moment.';
  return 'Could not reach the sync server. Check the connection and try again.';
}

const SYNC_FAILURE_OUTCOMES = ['error', 'conflict', 'too-large'];

/** How many progress records actually changed, for the plain-language
 * "brought in N updates" message — a rough, honest count (sync-plan.md §5),
 * not an attempt to name every character by hand. */
function countProgressChanges(before, after) {
  let count = 0;
  Object.entries(after).forEach(([key, record]) => {
    const prior = before[key];
    if (!prior || (record.updatedAt || 0) !== (prior.updatedAt || 0)) count += 1;
  });
  return count;
}

/** Runs one sync action against `docId`/`aesKey`, persists the resulting
 * sync-pairing row, and reloads `state.profile` if the merge actually
 * changed it. Every one of the four UI actions below is this same call with
 * a different `knownVersion` and a different message for the happy path. */
/**
 * The one code path every sync goes through, manual or automatic. Returns
 * the raw result; callers decide what (if anything) to say about it.
 *
 * Order matters at the end: the merged profile is saved BEFORE the sync
 * state is written back, because store.saveProfile() marks the pairing
 * dirty — doing it the other way round would immediately re-dirty a pairing
 * that was just successfully pushed, and every later sync would send a
 * pointless write.
 */
async function runSync({
  code, docId, aesKey, knownVersion, localChanged, adoptIncomingIdentity = false,
}) {
  const profile = state.profile;
  const result = await syncProfile({
    transport,
    encrypt: (p) => encryptProfile(aesKey, p),
    decrypt: (c) => decryptProfile(aesKey, c),
    docId,
    knownVersion,
    localProfile: profile,
    localChanged,
    adoptIncomingIdentity,
  });
  if (SYNC_FAILURE_OUTCOMES.includes(result.outcome)) return { ...result, ok: false };

  if (result.profile !== profile) {
    state.profile = result.profile;
    await store.saveProfile(state.profile);
  }
  const now = Date.now();
  await store.saveSyncState({
    profileId: profile.id,
    code,
    docId,
    version: result.version,
    lastPulledAt: now,
    lastPushedAt: result.pushed ? now : undefined,
    // Anything this device still owes the remote was just sent, unless the
    // push was skipped precisely because there was nothing to send.
    dirty: result.pushed ? false : (localChanged && !result.pushed),
  });
  // Outlives the pairing row above — see store.js's REMEMBERED_CODE_STORE —
  // so a later syncTurnOn() for this profile resumes this code instead of
  // generating a new one.
  await store.rememberSyncCode(profile.id, code);
  return {
    ...result,
    ok: true,
    changeCount: countProgressChanges(profile.progress, result.profile.progress),
  };
}

/** runSync plus the Settings card's messaging — the manual actions only. */
async function performSync({ successMessage, ...options }) {
  const result = await runSync(options);
  if (!result.ok) {
    await renderSyncCard(syncFailureMessage(result.outcome));
    return false;
  }
  await renderSyncCard(successMessage(result.outcome, result.changeCount));
  return true;
}

// --- Automatic sync (sync-plan.md §4.3) -------------------------------------
// Deliberately at natural boundaries — opening a learner, finishing a
// session, leaving or returning to the app — never per answer. A session's
// worth of practice is one push, not thirty, and a launch that finds nothing
// new costs a single conditional request that comes back 304.

const SYNC_STALE_MS = 10 * 60 * 1000;
let autoSyncRunning = false;

/**
 * Sync in the background if this profile is paired and there's a reason to.
 * Silent by design: it must never interrupt a learner, so failures (offline,
 * server down) are swallowed — local IndexedDB is the source of truth and
 * the next trigger will try again.
 */
async function autoSync({ force = false } = {}) {
  const profile = state.profile;
  if (!profile || autoSyncRunning) return;
  // §4.4: a pull mid-question would swap the profile out from under the
  // answer being graded. Sessions are short; this waits for the end of one.
  if (state.session) return;

  const syncState = await store.getSyncState(profile.id);
  if (!syncState) return;

  const since = Date.now() - (syncState.lastPulledAt || 0);
  if (!force && !syncState.dirty && since < SYNC_STALE_MS) return;

  autoSyncRunning = true;
  try {
    const { docId, aesKey } = await deriveKeys(syncState.code);
    const result = await runSync({
      code: syncState.code,
      docId,
      aesKey,
      knownVersion: syncState.version,
      localChanged: !!syncState.dirty,
    });
    // A merge that brought in another device's work changes what every
    // screen should be showing — but only redraw a screen that's actually
    // idle, never one mid-anything.
    if (result.ok && result.changeCount > 0 && !state.session) {
      if (!$('screen-home').hidden) renderHome();
      else if (!$('screen-settings').hidden) await renderSyncCard();
    }
  } catch {
    // Offline, or the key derivation failed — nothing a learner can act on.
  } finally {
    autoSyncRunning = false;
  }
}

async function syncTurnOn() {
  setSyncBusy(true);
  $('sync-status').textContent = 'Turning on sync…';
  try {
    // Reuse the code from this profile's last sync, if it had one — turning
    // sync off and straight back on (a stray tap, a kid poking around
    // Settings) would otherwise mint a fresh code every time, each one
    // orphaning the previous document on the server (harmless — the 5-year
    // sweep cleans it up — but pointless, and the wrong default when
    // another device may still be paired on the old code).
    const rememberedCode = await store.getRememberedSyncCode(state.profile.id);
    const code = rememberedCode || generateCode();
    const { docId, aesKey } = await deriveKeys(code);
    await performSync({
      code,
      docId,
      aesKey,
      knownVersion: null,
      localChanged: true,
      // Same reasoning as "Enter a code": resuming a remembered code can
      // pull in changes another device made while this one had sync off,
      // and adopting its name/badge then is exactly the pairing behaviour
      // this device already agreed to the first time it used this code.
      // A no-op for a genuinely new code — nothing exists there to adopt.
      adoptIncomingIdentity: true,
      // This code is the only way to restore progress after losing this
      // device, so the moment it exists is the moment worth saying so —
      // waiting for the learner to notice the code sitting in the panel
      // isn't enough.
      // No "above"/"below" here — this message and the code/Share button
      // don't have a fixed relative position (this same status line is also
      // shared with the not-yet-synced and pairing states), so a directional
      // claim can end up pointing the wrong way.
      successMessage: () => {
        const action = typeof navigator.share === 'function' ? 'Tap Share code' : 'Copy the code';
        return rememberedCode
          ? `Sync back on, using the same code as before. ${action} and save it somewhere safe if you haven't already — you'll need it to restore progress if this device is ever lost.`
          : `Sync turned on. ${action} and save it somewhere safe — you'll need it to restore progress if this device is ever lost.`;
      },
    });
  } catch {
    await renderSyncCard(syncFailureMessage('error'));
  } finally {
    setSyncBusy(false);
  }
}

/**
 * The home-screen nudge's "Turn on sync" already states the intent plainly
 * — routing through Settings' own identical button first would just be a
 * second tap of the same label. So this jumps straight to Settings, scrolls
 * the sync card into view (a long page otherwise leaves the result of the
 * tap off the bottom of the screen), and turns sync on immediately.
 */
async function syncTurnOnFromNudge() {
  renderSettings();
  // Scrolled AFTER, not before: the not-yet-configured panel is much
  // shorter than the configured one it becomes, so scrolling first landed
  // the viewport against the panel's old, shorter height — leaving the code
  // and Copy code above the top edge once syncTurnOn() actually grew it.
  await syncTurnOn();
  $('sync-card').scrollIntoView({ block: 'start' });
}

async function syncEnterCode(event) {
  event.preventDefault();
  const code = formatCode(normalizeCode($('sync-code-input').value));
  if (!code) return;
  setSyncBusy(true);
  $('sync-status').textContent = 'Connecting…';
  try {
    const { docId, aesKey } = await deriveKeys(code);
    const ok = await performSync({
      code,
      docId,
      aesKey,
      knownVersion: null,
      localChanged: true,
      adoptIncomingIdentity: true,
      successMessage: (outcome, count) => {
        if (outcome === 'unchanged') return 'Connected. Nothing to bring over yet.';
        return count === 0
          ? 'Connected. Already up to date.'
          : `Connected. Brought in ${count} update${count === 1 ? '' : 's'} from the other device.`;
      },
    });
    if (ok) $('sync-code-input').value = '';
  } catch {
    await renderSyncCard(syncFailureMessage('error'));
  } finally {
    setSyncBusy(false);
  }
}

async function syncNow() {
  const syncState = await store.getSyncState(state.profile.id);
  if (!syncState) return;
  setSyncBusy(true);
  $('sync-status').textContent = 'Syncing…';
  try {
    const { docId, aesKey } = await deriveKeys(syncState.code);
    await performSync({
      code: syncState.code,
      docId,
      aesKey,
      knownVersion: syncState.version,
      // Tapping Sync now explicitly is a request to reconcile, so it pushes
      // whether or not anything changed here — unlike the automatic
      // triggers, which stay quiet when there's nothing to send.
      localChanged: true,
      successMessage: (outcome, count) => (
        count === 0 ? undefined : `Synced. Brought in ${count} update${count === 1 ? '' : 's'}.`
      ),
    });
  } catch {
    await renderSyncCard(syncFailureMessage('error'));
  } finally {
    setSyncBusy(false);
  }
}

/** Stops pushing and forgets the code on this device only — the remote
 * document is untouched (sync-plan.md §5), so turning sync back on with the
 * same code, here or elsewhere, picks up exactly where it left off. */
async function syncTurnOff() {
  await store.deleteSyncState(state.profile.id);
  await renderSyncCard();
}

/**
 * Confirmation happens ON THE BUTTON ITSELF — swapping its label to
 * "Copied!" for a beat — rather than only in the status line below, which
 * is easy to miss entirely for a tap that has nothing else to look at.
 * A real problem (clipboard write failed) still goes to the status line,
 * since that's worth a message that doesn't disappear on its own.
 */
async function syncCopyCode() {
  const syncState = await store.getSyncState(state.profile.id);
  if (!syncState || !navigator.clipboard) return;
  const button = $('sync-copy-code');
  try {
    await navigator.clipboard.writeText(syncState.code);
    button.textContent = 'Copied!';
    button.classList.add('copied');
    // Not button.disabled: a rapid second tap should just re-copy and reset
    // this timer, not be swallowed — and leaving it enabled means it can
    // never end up stuck disabled by racing setSyncBusy() from another
    // in-flight sync action.
    clearTimeout(button._copiedTimer);
    button._copiedTimer = setTimeout(() => {
      button.textContent = 'Copy code';
      button.classList.remove('copied');
    }, 1500);
  } catch {
    $('sync-status').textContent = 'Could not copy — select and copy the code by hand.';
  }
}

/**
 * Hands the code to the OS share sheet — Messages, Notes, email, AirDrop,
 * cloud storage, whatever the learner's family actually uses — so getting a
 * copy off this device never depends on navigating its file system. Only
 * wired up where navigator.share exists (see renderSyncCard); elsewhere
 * Copy code is the only route, which is always available.
 */
async function syncShareCode() {
  const syncState = await store.getSyncState(state.profile.id);
  if (!syncState || typeof navigator.share !== 'function') return;
  try {
    await navigator.share({
      title: 'Kana Quest sync code',
      text: `Kana Quest sync code for ${state.profile.name}: ${syncState.code}\n\n`
        + "Enter this in Settings on another device to keep them in step, or to restore this learner's progress if this device is ever lost.",
    });
  } catch {
    // Cancelled the share sheet, or the share failed — the code is still
    // sitting right there in the panel either way, nothing to report.
  }
}

// --- Stories: graded reading (stories-plan.md) ----------------------------
//
// Not a course: no modes, no SRS, no due dates, nothing scored. A learner
// opens a story and reads it; the only thing this whole section records is
// which words got tapped for a definition (§8.5's end card, opt-in) and the
// exposure counter reading already shares with the vocab quiz (§6).
//
// MVP note: tools/build_story_data.py (with a real tokenizer and the level/
// grammar gates from §4.6) doesn't exist yet — no fugashi/UniDic in this
// environment. The two stories shipped here were tokenised by hand instead;
// the data SHAPE is exactly what that future build script would emit, so
// nothing downstream of src/data/story-*.js needs to change once it exists.

const READING_LEVELS = [
  { id: 'L1', name: 'First steps' },
  { id: 'L2', name: 'Getting going' },
  { id: 'L3', name: 'Everyday' },
  { id: 'L4', name: 'Wider world' },
  { id: 'L5', name: 'Confident' },
  { id: 'L6', name: 'Unabridged' },
];
function readingLevelName(id) {
  return (READING_LEVELS.find((l) => l.id === id) || {}).name || id;
}

const loadedStories = new Map();
const loadingStories = new Map();
/** Mirrors ensureVocabUnitLoaded/ensureKanjiUnitLoaded exactly — memoized,
 * lazy, one file per story (stories-plan.md §3.4). */
async function ensureStoryLoaded(id) {
  if (loadedStories.has(id)) return loadedStories.get(id);
  if (!loadingStories.has(id)) {
    loadingStories.set(id, import(`./data/story-${id}.js`).then((mod) => {
      loadedStories.set(id, mod.STORY);
      return mod.STORY;
    }));
  }
  return loadingStories.get(id);
}

/** stories-plan.md §5.1 — 'hira' until katakana has been started, 'kana'
 * until any kanji has, 'kanji' from there on. Uses studyModes (already
 * imported from srs.js) over the three real kanji modes, the same
 * KANJI_STUDY_MODES set isKanjiKnown checks below — never a bare "any study
 * key at all" test, which the vmeaning/vrecall-key-collision bug phase 3b
 * of vocab-plan.md found would misread a studied single-kanji WORD (船, 水)
 * as a studied KANJI. */
function anyKanjiStarted(profile) {
  return [...KANJI_STUDY_MODES].some((mode) => studiedKanji(profile.study, mode).length > 0);
}
function readerScriptStage(profile) {
  if (anyKanjiStarted(profile)) return 'kanji';
  const kata = courseStats(getAnyCourse('katakana'), 'recognition', profile);
  return kata.started > 0 ? 'kana' : 'hira';
}

/** The furthest-along kanji unit with anything introduced in any of the
 * three kanji modes, in teaching order — stories-plan.md §5.1's "frontier
 * unit". Null if no kanji has been introduced at all (stage isn't 'kanji'
 * yet, so callers only reach this once it's non-null in practice). */
function frontierKanjiUnit(profile) {
  let frontier = null;
  KANJI_UNIT_IDS.forEach((unit) => {
    const course = getAnyCourse(`kanji-grade-${unit}`);
    // Enrolled OR introduced — matches anyKanjiStarted's own criterion for
    // 'kanji' stage above. Enrollment happens before the first progress
    // record does (see "Learn N next"), so checking progress alone would
    // leave frontier null right after enrolling, which windowActive then
    // misreads as "frontier grade 4+, show every kanji" instead of
    // restricting to the window — the opposite of what was just started.
    const started = course.chunks.some((chunk) => chunk.items.some((char) => (
      ['definition', 'recognition', 'writing'].some((mode) => (
        isStudying(profile.study, char, mode) || !!profile.progress[itemKey(mode, char)]
      ))
    )));
    if (started) frontier = unit;
  });
  return frontier;
}

/** Builds the `view` object src/reader.js's pure renderer takes — everything
 * about the current profile that decides how one story renders, computed
 * fresh (never cached: study state can change mid-story via a detail-screen
 * chip, see openReaderDetail). */
function buildReaderView() {
  const profile = state.profile;
  const stage = readerScriptStage(profile);
  let windowActive = false;
  let windowUnits = null;
  if (stage === 'kanji') {
    const frontier = frontierKanjiUnit(profile);
    // Grades 1-3 only (stories-plan.md §5.4) — from grade 4 on, every kanji
    // is shown (§5.5). '8-x'/'9-x' (secondary/names) sort after '6' in
    // KANJI_UNIT_IDS, so they never match here either.
    if (frontier && ['1', '2', '3'].includes(frontier)) {
      windowActive = true;
      const idx = KANJI_UNIT_IDS.indexOf(frontier);
      windowUnits = new Set([frontier, KANJI_UNIT_IDS[idx + 1]].filter(Boolean));
    }
  }
  return {
    stage,
    windowActive,
    inWindow: (ch) => !!windowUnits && windowUnits.has(kanjiUnitFor(ch)),
    isKanjiKnown,
    exposure: profile.exposure,
    muted: profile.muted,
  };
}

/** stories-plan.md §2.4's first-time suggestion — never asked as a
 * question, just a pre-selected starting point the learner can move off of
 * freely. Coarse on purpose: it only has to be roughly right. */
function suggestedReadingLevel(profile) {
  const stage = readerScriptStage(profile);
  if (stage === 'hira') return 'L1';
  if (stage === 'kana') return 'L2';
  const frontier = frontierKanjiUnit(profile);
  const idx = frontier ? KANJI_UNIT_IDS.indexOf(frontier) : -1;
  if (idx < 0 || idx <= 1) return 'L3';
  if (idx <= 3) return 'L4';
  return 'L5';
}

/** The story a learner is mid-way through, most-recently-touched first, or
 * null if nothing is in progress — shared by the home screen's Read card
 * and the library's own "Continue reading" card. */
function continueReadingInfo(profile) {
  const pos = (profile.stories && profile.stories.pos) || {};
  const ids = Object.keys(pos).sort((a, b) => (pos[b].at || 0) - (pos[a].at || 0));
  for (const id of ids) {
    const entry = STORIES[id];
    if (entry) return { id, entry, pos: pos[id] };
  }
  return null;
}

function renderReadCard() {
  const info = continueReadingInfo(state.profile);
  $('read-card-sub').textContent = info
    ? `${info.entry.title.ja} — pick up where you left off`
    : 'Something new to read';
}

function openStoriesLibrary() {
  state.readerBrowseLevel = state.profile.settings.readingLevel || suggestedReadingLevel(state.profile);
  renderStoriesLibrary();
  show('screen-stories');
}

function renderStoriesLibrary() {
  const profile = state.profile;
  const ownLevel = profile.settings.readingLevel;
  const browse = state.readerBrowseLevel;

  const strip = $('story-level-strip');
  strip.innerHTML = '';
  READING_LEVELS.forEach((lvl) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `segment${browse === lvl.id ? ' active' : ''}`;
    btn.textContent = lvl.id;
    btn.addEventListener('click', () => { state.readerBrowseLevel = lvl.id; renderStoriesLibrary(); });
    strip.appendChild(btn);
  });
  $('story-level-name').textContent = readingLevelName(browse);
  // Browsing and committing are different actions (§2.4) — only offered
  // while looking at a level that isn't already the learner's own.
  $('story-make-level').hidden = !!ownLevel && ownLevel === browse;

  const continueInfo = continueReadingInfo(profile);
  const continueEl = $('story-continue');
  if (continueInfo) {
    continueEl.hidden = false;
    continueEl.innerHTML = '';
    const label = document.createElement('span');
    label.className = 'hint';
    label.textContent = 'Continue reading';
    const title = document.createElement('div');
    title.className = 'story-card-title';
    title.textContent = `${continueInfo.entry.title.ja} `;
    const sub = document.createElement('span');
    sub.className = 'hint';
    sub.textContent = continueInfo.entry.title.en;
    title.appendChild(sub);
    continueEl.appendChild(label);
    continueEl.appendChild(title);
    continueEl.onclick = () => openStory(continueInfo.id);
  } else {
    continueEl.hidden = true;
    continueEl.onclick = null;
  }

  const list = $('story-list');
  list.innerHTML = '';
  const entries = Object.entries(STORIES).filter(([, s]) => s.level === browse);
  if (entries.length === 0) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = 'Nothing at this level yet — more stories are on the way.';
    list.appendChild(p);
  }
  entries.forEach(([id, s]) => {
    const read = profile.stories && profile.stories.read && profile.stories.read[id];
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'card story-card';
    const title = document.createElement('div');
    title.className = 'story-card-title';
    title.textContent = `${s.title.ja} `;
    const titleEn = document.createElement('span');
    titleEn.className = 'hint';
    titleEn.textContent = s.title.en;
    title.appendChild(titleEn);
    const blurb = document.createElement('p');
    blurb.className = 'hint';
    blurb.textContent = s.blurb;
    const meta = document.createElement('p');
    meta.className = 'hint';
    const minutes = Math.max(1, Math.ceil(s.length / 60));
    meta.textContent = `${minutes} min${read && read.done ? ' · read' : ''}`;
    card.appendChild(title);
    card.appendChild(blurb);
    card.appendChild(meta);
    card.addEventListener('click', () => openStory(id));
    list.appendChild(card);
  });
}

// --- The reader -------------------------------------------------------

function tokenStateKey(p, s, i) { return `${p}:${s}:${i}`; }

/**
 * Marks the token the learner last tapped, as a place-keeper. Two jobs: it
 * says which word the definition card is talking about (the card is a bottom
 * sheet, well away from the word itself), and it is still there when they
 * come back from a kanji detail screen, so finding their place is looking
 * rather than re-reading.
 *
 * Persists until a different token is tapped — deliberately not cleared when
 * the card closes, since "where was I?" outlives "what does this mean?".
 */
/**
 * Tapping away: dismisses the definition card and lets go of the
 * place-keeper, together. They are put up by the same gesture and a learner
 * thinks of them as one thing, so one tap on empty space clears both rather
 * than leaving a word marked with no panel to explain it.
 *
 * A no-op when there is nothing to clear, so an idle tap on the page costs
 * nothing and cannot disturb the reveal levels.
 */
function clearReaderFocus() {
  if (!state.readerCardKey && !state.readerActiveKey) return;
  closeReaderCard();
  setReaderActiveToken(null);
}

function setReaderActiveToken(key) {
  state.readerActiveKey = key;
  const body = $('reader-body');
  body.querySelectorAll('.reader-token-active').forEach((el) => el.classList.remove('reader-token-active'));
  if (!key) return;
  const [p, s, i] = key.split(':');
  const el = body.querySelector(`.reader-token[data-p="${p}"][data-s="${s}"][data-i="${i}"]`);
  if (el) el.classList.add('reader-token-active');
}

/** Applies the reader-settings furigana override (§8.4) on top of what
 * src/reader.js's own rules decided — a per-device "right now" preference,
 * not part of the pure hiding rule itself, so it stays out of reader.js. */
function applyFuriganaOverride(rendered) {
  const mode = state.readerFuriganaMode;
  if (rendered.form !== 'kanji' || !mode || mode === 'smart') return rendered;
  if (mode === 'always') return { ...rendered, hidden: false, maxLevel: 1 };
  return { ...rendered, hidden: true, maxLevel: rendered.ruby ? 2 : 1 };
}

/**
 * Reader settings' "Show romaji" toggle (§8.4), off by default — a learner
 * reading kanji stories has mostly outgrown the training-wheel romaji a
 * beginner still wants, and every word's ladder offering it as a matter of
 * course said otherwise. Strips romaji's step off the END of the ladder
 * (wherever the maxLevel above landed it) rather than just suppressing its
 * display once revealed — the latter would leave one tap on the way to
 * "hidden" that visibly does nothing, which reads as broken rather than off.
 * Every token's own ladder always ends in a romaji step (renderToken/
 * applyFuriganaOverride), so trimming exactly one level off the top is
 * correct regardless of which of those set it.
 */
function applyRomajiOverride(rendered) {
  if (state.readerShowRomaji) return rendered;
  if (rendered.form === 'kana') return { ...rendered, maxLevel: 0 };
  return { ...rendered, maxLevel: Math.max(0, rendered.maxLevel - 1) };
}

/**
 * The in-story repetition rule (stories-plan.md §6.3): once a word has
 * already been printed with its furigana EXPOSURE_THRESHOLD times in this
 * story, later printings of it stop showing it by default. The learner has
 * the reading three times over just above, on the page in front of them;
 * a fourth is not teaching anything, and a tap still brings it back.
 *
 * Deliberately positional rather than tied to what has been scrolled past:
 * "the fourth time this word appears" is a rule a reader can actually feel,
 * and it means hiding begins on the fourth occurrence at the latest however
 * they move through the text. It ORs with the profile-wide rules in
 * reader.js — a word already earned, studied or muted is hidden from its
 * very first appearance, and this only ever adds hiding, never removes it.
 */
function applyInStoryRepetition(rendered, p, s) {
  if (rendered.form !== 'kanji' || rendered.hidden) return rendered;
  const n = state.storyOccurrence.get(`${p}:${s}:${rendered.i}`);
  if (n === undefined || n < EXPOSURE_THRESHOLD - 1) return rendered;
  return { ...rendered, hidden: true, maxLevel: 2 };
}

function getRenderedSentence(p, s) {
  const sentence = state.readerStory.body[p][s];
  return renderSentence(sentence.t, state.readerView)
    // Repetition first, then the reader's own explicit setting — an
    // "Always show furigana" choice should beat an automatic rule, not the
    // other way round.
    .map((rendered) => applyInStoryRepetition(rendered, p, s))
    .map(applyFuriganaOverride)
    // Last: it only ever trims the ladder's own final step, whatever the
    // rules above decided the rest of it should be.
    .map(applyRomajiOverride);
}

function paintTokenElement(el, token, rendered, level) {
  const at = tokenAtLevel(rendered, level);
  el.innerHTML = '';
  if (rendered.form === 'kanji' && rendered.ruby) {
    const rubyByPos = new Map(rendered.ruby.map((r) => [r[0], r[1]]));
    [...rendered.text].forEach((ch, idx) => {
      const reading = rubyByPos.get(idx);
      if (reading && at.showRuby) {
        const ruby = document.createElement('ruby');
        ruby.appendChild(document.createTextNode(ch));
        const rt = document.createElement('rt');
        rt.textContent = reading;
        ruby.appendChild(rt);
        el.appendChild(ruby);
      } else {
        el.appendChild(document.createTextNode(ch));
      }
    });
  } else {
    el.appendChild(document.createTextNode(at.text));
  }
  if (at.showRomaji) {
    const romaji = document.createElement('span');
    romaji.className = 'reader-romaji-pop';
    romaji.textContent = toRomaji(token.k);
    el.appendChild(romaji);
  }
}

function buildTokenElement(token, rendered, p, s) {
  const el = document.createElement('span');
  el.dataset.p = p;
  el.dataset.s = s;
  el.dataset.i = rendered.i;
  if (rendered.tappable) {
    el.className = 'reader-token reader-tap';
  } else {
    el.className = 'reader-token';
  }
  paintTokenElement(el, token, rendered, 0);
  return el;
}

/**
 * 禁則処理 (kinsoku shori) — the Japanese line-breaking prohibitions.
 *
 * Browsers apply these to ordinary Japanese text on their own, but they
 * cannot here: every token is its own `display: inline-block`, which the
 * layout engine treats as an atomic box with a break opportunity on either
 * side, so a 。 in its own box happily lands at the start of the next line.
 * The prohibitions therefore have to be reimposed by grouping tokens into
 * `white-space: nowrap` runs that a break cannot fall inside.
 *
 * 行頭禁則 — must never START a line: sentence-ending and separating
 * punctuation, every closing bracket, the sound marks and iteration marks
 * that belong to the character before them.
 */
const NO_LINE_START = /^[。、，．,.・：；:;？！?!）｝】〕〉》」』〙〗\]｣»…‥ーゝゞ々〻ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ]/;
/** 行末禁則 — must never END a line: every opening bracket. */
const NO_LINE_END = /^[（｛［〔〈《「『〖〘\[｢«]/;

function renderReaderParagraph(para, pIndex) {
  const p = document.createElement('p');
  p.className = 'reader-para';
  p.dataset.p = pIndex;
  para.forEach((sentence, sIndex) => {
    const rendered = getRenderedSentence(pIndex, sIndex);
    const sSpan = document.createElement('span');
    sSpan.className = 'reader-sentence';
    sSpan.dataset.s = sIndex;
    // The current unbreakable run. A token joins it when a line break must
    // not fall before this token (行頭禁則) or after the previous one
    // (行末禁則); otherwise it starts a fresh run, which is where the line
    // is then free to break.
    let run = null;
    let heldOpen = false;
    rendered.forEach((r, idx) => {
      const token = sentence.t[idx];
      const joinPrevious = run && (NO_LINE_START.test(token.s) || heldOpen);
      if (!joinPrevious) {
        run = document.createElement('span');
        run.className = 'reader-run';
        sSpan.appendChild(run);
      }
      if (r.spaceBefore) run.appendChild(document.createTextNode(' '));
      const el = buildTokenElement(token, r, pIndex, sIndex);
      // The sentence's own final punctuation doubles as a translate tap
      // target (§7.3's second bullet) — no individual word needs picking
      // first to translate a sentence understood not one word of.
      if (idx === rendered.length - 1 && token.pos === 'punct') {
        el.classList.add('reader-translate-tap');
      }
      run.appendChild(el);
      heldOpen = NO_LINE_END.test(token.s);
    });
    p.appendChild(sSpan);
    const tDiv = document.createElement('div');
    // reader-translate-tap so tapping the English itself, once it's showing,
    // hides it again — the same class the sentence's own closing punctuation
    // carries to show it in the first place, so one gesture both opens and
    // closes it rather than requiring a hunt back to the punctuation mark.
    tDiv.className = 'reader-translation reader-translate-tap';
    tDiv.dataset.p = pIndex;
    tDiv.dataset.s = sIndex;
    tDiv.textContent = sentence.en;
    tDiv.hidden = !state.readerShowAllTranslations;
    p.appendChild(tDiv);
  });
  return p;
}

function renderReaderBody() {
  const container = $('reader-body');
  container.innerHTML = '';
  state.readerStory.body.forEach((para, pIndex) => {
    container.appendChild(renderReaderParagraph(para, pIndex));
  });
  // The DOM was just thrown away and rebuilt — put the place-keeper back.
  setReaderActiveToken(state.readerActiveKey);
  observeReaderParagraphs();
}

// --- Exposure (stories-plan.md §6) -----------------------------------

/** Every (kanji, reading) plus the word's own key a shown/revealed token
 * should accrue against — src/reader.js's exposureTargetsForToken, just
 * re-exported at the call site for readability. */
function recordReaderExposure(token, source, hiddenOnScreen) {
  if (!token.ruby) return;
  const wordKey = exposureWordKey(token.s);
  // What the learner was ACTUALLY shown, which is not always what the
  // profile-wide rules alone would say: the in-story repetition rule
  // (applyInStoryRepetition) hides a word's fourth-and-later printings too,
  // and a printing that showed nothing must not be recorded as if it had.
  // Callers that know the token's position pass it in; the rest fall back
  // to the profile-wide answer.
  const hiddenByDefault = hiddenOnScreen !== undefined
    ? hiddenOnScreen
    : isTokenFuriganaHidden(token, state.readerView);
  if (source === 'show') {
    if (hiddenByDefault) return; // nothing was actually shown
  } else {
    if (!hiddenByDefault) return; // nothing was hidden to reveal
    if (isExposurePromoted(state.profile.exposure, wordKey)) {
      // One unambiguous reveal of an exposure-promoted word — a story
      // decision is always per-WORD (§5.4/§6.1), so unlike the vocab quiz's
      // per-kanji case this is never ambiguous about which reading failed.
      recordDemotionStrike(state.profile.exposure, wordKey, Date.now());
      store.saveProfile(state.profile);
      return;
    }
  }
  let changed = false;
  exposureTargetsForToken(token).forEach((key) => {
    if (isExposurePromoted(state.profile.exposure, key)) return;
    if (state.storyCounted.has(key)) return; // at most one per episode (§6.3)
    state.storyCounted.add(key);
    addExposure(state.profile.exposure, key, Date.now());
    changed = true;
  });
  if (changed) store.saveProfile(state.profile);
}

/** A learner tapping a word whose furigana is already showing BY DEFAULT
 * (not yet earned or muted) to hide it — the same permanent opt-out the
 * vocab quiz's own "Hide furigana in future" offers (clickHideFuriganaButton),
 * just reached from a story instead. Mutes every key this token's furigana
 * would otherwise be judged by (isTokenFuriganaHidden in reader.js), so it
 * renders hidden here for the rest of this story and every one after, not
 * just this one printing. */
function muteReaderToken(token) {
  const { muted } = state.profile;
  const now = Date.now();
  exposureTargetsForToken(token).forEach((key) => muteFuriganaKey(muted, key, now));
  store.saveProfile(state.profile);
}

/** After muteReaderToken, every OTHER occurrence of the same word already
 * sitting in the DOM (the whole story is rendered upfront, not paginated —
 * see renderReaderBody) is still painted from before the mute took effect.
 * isTokenFuriganaHidden only ever tests the whole-word key (reader.js), so
 * an exact surface match is enough to find every one of them; each is reset
 * to reveal-level 0 and repainted so the word reads as hidden everywhere in
 * this story from this point on, not just where it was tapped. */
function refreshMutedWordOccurrences(surface) {
  state.readerStory.body.forEach((para, p) => {
    para.forEach((sentence, s) => {
      sentence.t.forEach((tok, i) => {
        if (tok.s !== surface) return;
        const key = tokenStateKey(p, s, i);
        state.storyRevealLevels.set(key, 0);
        const el = $('reader-body').querySelector(`.reader-token[data-p="${p}"][data-s="${s}"][data-i="${i}"]`);
        if (el) paintTokenElement(el, tok, getRenderedSentence(p, s)[i], 0);
      });
    });
  });
}

// --- Reader settings (stories-plan.md §8.4) ------------------------------
//
// Per DEVICE, not per profile, and never synced: text size and the furigana
// override are "how I want to read on this screen right now", like a font
// size in a browser, not a fact about the learner worth carrying to their
// other devices. localStorage rather than the profile for exactly that
// reason — and because a shared tablet's two learners should not fight over
// one text size.
//
// They do have to outlive one story, though: a learner who needs 32px needs
// it in the next story too, and being made to set it again every time is the
// bug this exists to prevent.

const READER_SETTINGS_KEY = 'kana-quest-reader-settings';
// Step 3 matches .reader-body's own CSS default of 18px, so an untouched
// slider tells the truth without having to set anything. The top end goes
// well past a normal reading size on purpose — large-print territory, not
// just "a bit bigger".
const READER_TEXT_SIZES = ['14px', '16px', '18px', '24px', '32px'];

function loadReaderSettings() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(READER_SETTINGS_KEY) || '{}') || {};
  } catch {
    saved = {}; // private browsing, cleared storage — fall back to defaults
  }
  const size = Number(saved.textSize);
  if (size >= 1 && size <= READER_TEXT_SIZES.length) state.readerTextSize = size;
  if (['smart', 'always', 'never'].includes(saved.furiganaMode)) {
    state.readerFuriganaMode = saved.furiganaMode;
  }
  // Undefined (never saved before) also falls to the off-by-default above,
  // same as every other boolean here — only an explicit `true` turns it on.
  state.readerShowRomaji = !!saved.showRomaji;
  state.readerShowAllTranslations = !!saved.showTranslations;
}

function saveReaderSettings() {
  try {
    localStorage.setItem(READER_SETTINGS_KEY, JSON.stringify({
      textSize: state.readerTextSize,
      furiganaMode: state.readerFuriganaMode,
      showRomaji: state.readerShowRomaji,
      showTranslations: state.readerShowAllTranslations,
    }));
  } catch {
    // Storage unavailable — the setting still applies for this session.
  }
}

/**
 * Puts the learner back where they were in the story after a trip to a
 * detail screen. show() scrolls every screen it reveals to the top, which
 * is right for one you are arriving at and wrong for one you are returning
 * to part-way through.
 *
 * The reflow is load-bearing, not superstition: the reader was display:none
 * a moment ago, so the document still has no scroll height, and a scrollTo
 * issued before layout runs is silently clamped to 0. Reading scrollHeight
 * forces layout first. The rAF is a backstop for the case where the reader's
 * own paragraphs are still settling (web fonts, ruby metrics).
 */
function restoreReaderScroll() {
  const y = state.readerScrollY;
  if (!y) return;
  void document.documentElement.scrollHeight;
  window.scrollTo(0, y);
  requestAnimationFrame(() => window.scrollTo(0, y));
}

/** Pushes the current settings onto both the controls and the text, so the
 * sheet and the story can never disagree about what is set. */
function applyReaderSettings() {
  $('reader-body').style.fontSize = READER_TEXT_SIZES[state.readerTextSize - 1];
  $('reader-text-size').value = String(state.readerTextSize);
  $('reader-furigana-mode').value = state.readerFuriganaMode;
  $('reader-show-romaji').checked = state.readerShowRomaji;
  $('reader-show-translations').checked = state.readerShowAllTranslations;
}

let readerObserver = null;

/**
 * Two questions about a reader's position, deliberately answered by
 * different machinery because they are held to different standards
 * (stories-plan.md §6.3 / §9):
 *
 * - **"Where am I?"** — the progress line and the resume cursor. Cheap to
 *   get wrong, so it is just scroll position (readerScrollSync below).
 * - **"Did they actually read this?"** — the exposure counter that decides
 *   whether furigana stops being handed over. Evidence, so the bar is much
 *   higher, and that is this observer's only job: a paragraph counts ONLY
 *   once it has been on screen AND then scrolled off the TOP of it, i.e.
 *   the learner has genuinely moved past it. The last screenful, which by
 *   definition can never scroll off the top, is counted by the learner
 *   tapping "Finished reading!" instead.
 *
 * An earlier version counted a paragraph after two seconds at half-visible.
 * That was wrong in the direction that matters: text scrolled past on the
 * way to somewhere else, or sitting on screen while the phone was put down,
 * counted as read, and furigana would quietly disappear from words nobody
 * had looked at. Exposure hides help from a learner, so its evidence should
 * be the honest kind — "I read past this", "I say I finished" — not a proxy.
 *
 * `data-seen` is what stops a jump from counting: a paragraph the learner
 * flicked past on the way to the bottom, or one ABOVE where a resumed story
 * reopens, is off the top of the screen without ever having been on it, and
 * must not count. Only a paragraph actually displayed and then left behind
 * qualifies.
 *
 * Guarded for environments with no IntersectionObserver (the headless test
 * harness) — those simply never accrue reading exposure, which is fine
 * since nothing there opens a story.
 */
function observeReaderParagraphs() {
  if (typeof IntersectionObserver !== 'function') return;
  if (readerObserver) readerObserver.disconnect();
  readerObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      const el = entry.target;
      if (entry.isIntersecting) { el.dataset.seen = '1'; return; }
      // Left the viewport — but only off the TOP counts as "read past".
      // rootBounds is null in a few cross-document cases; the viewport's
      // own top is 0, which is the right fallback here.
      const top = entry.rootBounds ? entry.rootBounds.top : 0;
      if (el.dataset.seen === '1' && entry.boundingClientRect.bottom <= top) {
        markParagraphExposed(el);
      }
    });
  }, { threshold: [0, 1] });
  $('reader-body').querySelectorAll('.reader-para').forEach((el) => readerObserver.observe(el));
}

/** How far down the story the learner has scrolled, 0-1. Scroll position
 * rather than "furthest paragraph with a pixel on screen" — the latter
 * reads 100% the moment the last paragraph's first line peeks into view,
 * which on a short story is most of the way through the first screenful. */
function updateReaderProgress(fraction) {
  const pct = Math.round(Math.max(0, Math.min(1, fraction)) * 100);
  $('reader-progress-fill').style.width = `${pct}%`;
}

function saveReaderPosition(pIndex, sIndex) {
  if (!state.profile.stories) state.profile.stories = { read: {}, pos: {} };
  state.profile.stories.pos[state.readerStoryId] = {
    p: pIndex, s: sIndex, h: state.readerStory.hash, at: Date.now(),
  };
  store.saveProfile(state.profile);
}

/**
 * The cursor half of §6.3's split: the progress line, and the paragraph a
 * reopened story comes back to. Both answer "where am I right now", so both
 * follow scroll position directly — the topmost paragraph still on screen
 * is the one being read, and scrolling back to re-read something genuinely
 * does move where you are, unlike exposure, which only ever accumulates.
 *
 * Saving to IndexedDB is throttled to actual paragraph changes, not every
 * scroll frame.
 */
let readerScrollFrame = null;
function readerScrollSync() {
  if (readerScrollFrame) return;
  readerScrollFrame = requestAnimationFrame(() => {
    readerScrollFrame = null;
    if (currentScreenId !== 'screen-reader' || !state.readerStory) return;
    const scrollable = document.documentElement.scrollHeight - window.innerHeight;
    updateReaderProgress(scrollable > 0 ? window.scrollY / scrollable : 1);

    const paras = [...$('reader-body').querySelectorAll('.reader-para')];
    // Topmost paragraph not yet fully above the viewport — what's being read.
    const current = paras.find((el) => el.getBoundingClientRect().bottom > 0) || paras[paras.length - 1];
    if (!current) return;
    const pIndex = Number(current.dataset.p);
    if (pIndex === state.readerCursor) return;
    state.readerCursor = pIndex;
    saveReaderPosition(pIndex, 0);
  });
}

function markParagraphExposed(pEl) {
  if (pEl.dataset.exposed === '1') return;
  pEl.dataset.exposed = '1';
  const pIndex = Number(pEl.dataset.p);
  const para = state.readerStory.body[pIndex];
  para.forEach((sentence, sIndex) => {
    const rendered = getRenderedSentence(pIndex, sIndex);
    sentence.t.forEach((token, i) => recordReaderExposure(token, 'show', rendered[i].hidden));
  });
}

/**
 * "Finished reading!" — the other half of the rule above, and the only way
 * the last screenful of a story ever counts, since nothing at the bottom of
 * a document can scroll off the top of the screen.
 *
 * Counts every paragraph the learner actually had on screen (`data-seen`)
 * and no others: tapping this after flicking straight to the bottom credits
 * only what genuinely went past, not the whole story. Deliberately the
 * learner's own declaration rather than something inferred from scroll
 * position — exposure takes help away, so it should be something they said,
 * not something the app guessed.
 */
function finishReading() {
  if (state.readerFinished) return;
  state.readerFinished = true;
  $('reader-body').querySelectorAll('.reader-para').forEach((el) => {
    if (el.dataset.seen === '1') markParagraphExposed(el);
  });
  const lastIndex = state.readerStory.body.length - 1;
  updateReaderProgress(1);
  saveReaderPosition(lastIndex, 0);
  markStoryFinished(state.readerStoryId);
  $('reader-finished').hidden = true;
  showReaderEndCard();
}

// --- profile.stories bookkeeping (stories-plan.md §9) ------------------

function ensureStoryReadEntry(id) {
  if (!state.profile.stories) state.profile.stories = { read: {}, pos: {} };
  if (!state.profile.stories.read[id]) {
    state.profile.stories.read[id] = { first: Date.now(), last: Date.now(), done: null, passes: 0 };
  }
  return state.profile.stories.read[id];
}
function touchStoryOpened(id) {
  const entry = ensureStoryReadEntry(id);
  entry.last = Date.now();
  store.saveProfile(state.profile);
}
function markStoryFinished(id) {
  const entry = ensureStoryReadEntry(id);
  entry.done = Date.now();
  entry.last = entry.done;
  entry.passes = (entry.passes || 0) + 1;
  store.saveProfile(state.profile);
}

// --- Tapping (stories-plan.md §7) ---------------------------------------

/**
 * A plain tap always shows or hides — cycling forward through the reveal
 * ladder (furigana, then romaji) and wrapping back to fully hidden once it
 * runs out, so there is always a next tap that gets a learner back to where
 * they started rather than getting "stuck" with romaji left showing.
 * The same tap also opens the bottom info panel for that word (§7.2) —
 * there is no separate small button to hunt for. The panel itself starts
 * closed to the definition (openReaderCard) and only shows it on request,
 * so a tap here never blurts out the meaning a learner didn't ask for yet.
 *
 * A word whose furigana is showing BY DEFAULT is the one case the ladder
 * above has nothing useful to do with: rendered.hidden is already false, so
 * the "reveal" step it would normally take is a no-op, and all a first tap
 * could otherwise offer is romaji stacked on a reading already on the page.
 * A learner who already knows a word wants the opposite — to stop being
 * shown it — so this tap hides it and remembers that choice for good
 * (muteReaderToken), same as everywhere else in the app a "hide furigana"
 * choice is offered.
 */
function handleReaderTokenTap(tokenEl) {
  const p = Number(tokenEl.dataset.p);
  const s = Number(tokenEl.dataset.s);
  const i = Number(tokenEl.dataset.i);
  const key = tokenStateKey(p, s, i);
  const sentence = state.readerStory.body[p][s];
  const token = sentence.t[i];
  const rendered = getRenderedSentence(p, s)[i];
  const level = state.storyRevealLevels.get(key) || 0;
  if (rendered.form === 'kanji' && !rendered.hidden && level === 0) {
    muteReaderToken(token);
    refreshMutedWordOccurrences(token.s); // every printing of this word, not just the one tapped
    setReaderActiveToken(key);
    openReaderCard(p, s, i, token);
    return;
  }
  const willReveal = rendered.form === 'kanji' && rendered.hidden && level === 0;
  const nextLevel = level >= rendered.maxLevel ? 0 : level + 1;
  state.storyRevealLevels.set(key, nextLevel);
  paintTokenElement(tokenEl, token, rendered, nextLevel);
  setReaderActiveToken(key);
  if (rendered.maxLevel === 0) {
    // A kana word with romaji turned off (§8.4) has nothing left for the
    // ladder to cycle at all — the tap's only job left is the info panel.
    openReaderCard(p, s, i, token);
  } else if (nextLevel === 0) {
    if (state.readerCardKey === key) closeReaderCard();
  } else {
    openReaderCard(p, s, i, token);
  }
  if (willReveal) recordReaderExposure(token, 'reveal', rendered.hidden);
}

function toggleSentenceTranslation(p, s) {
  const pEl = $('reader-body').querySelector(`.reader-para[data-p="${p}"]`);
  if (!pEl) return;
  const tDiv = pEl.querySelector(`.reader-translation[data-s="${s}"]`);
  if (tDiv) tDiv.hidden = !tDiv.hidden;
}

function closeReaderCard() {
  state.readerCardKey = null;
  state.readerCardRevealed = false;
  $('reader-card').hidden = true;
  $('reader-card-body').innerHTML = '';
}

function kanaCourseForChar(ch) {
  if (ch >= 'ぁ' && ch <= 'ゟ') return getAnyCourse('hiragana');
  if (ch >= '゠' && ch <= 'ヿ') return getAnyCourse('katakana');
  return null;
}

/**
 * Leaving the reader for a kanji/kana/word detail screen. Remembers where
 * in the story we were: show() scrolls every screen it reveals back to the
 * top, which is right for a screen you are arriving at and wrong for one you
 * are returning to part-way through a story. See the 'reader' branch of
 * detail-back, which restores this.
 */
function openReaderDetail(course, char) {
  state.readerScrollY = window.scrollY;
  closeReaderCard();
  openCharacterDetail(course, char, 'reader');
}

/** The bottom info panel's head — the word itself, large, plus its reading.
 * Shared by the peek state (openReaderCard) and the fully revealed one
 * (revealReaderCardDefinition) so it never has to be rebuilt or flash
 * between the two. */
function renderReaderCardHead(token) {
  const head = document.createElement('div');
  head.className = 'reader-card-head';
  const glyph = document.createElement('span');
  glyph.className = 'glyph reader-card-glyph';
  glyph.textContent = token.s;
  head.appendChild(glyph);
  const readingLine = document.createElement('div');
  readingLine.className = 'reader-card-reading';
  const romaji = toRomaji(token.k);
  readingLine.textContent = token.k === token.s ? romaji : `${token.k}  ${romaji}`;
  head.appendChild(readingLine);
  return head;
}

/**
 * stories-plan.md §7.2's info panel, opened by a plain tap on any word
 * (handleReaderTokenTap) rather than a separate button — there is nothing
 * small to aim for. It starts on just the word itself; the definition below
 * stays hidden until asked for (the "Show definition" button, wired to
 * revealReaderCardDefinition), so tapping a word to place-mark it or check
 * the furigana never also blurts out what it means.
 */
function openReaderCard(p, s, i, token) {
  const key = tokenStateKey(p, s, i);
  if (state.readerCardKey === key) return; // already open for this word
  state.readerCardKey = key;
  state.readerCardRevealed = false;
  const body = $('reader-card-body');
  body.innerHTML = '';
  body.appendChild(renderReaderCardHead(token));
  $('reader-card').hidden = false;
  const revealBtn = document.createElement('button');
  revealBtn.type = 'button';
  revealBtn.className = 'btn btn-quiet';
  revealBtn.textContent = 'Show definition';
  // Stopped here, not left to bubble: revealReaderCardDefinition's first
  // move is to clear reader-card-body's innerHTML, which detaches this very
  // button from the document. The delegated listener on `document` (below)
  // would then find event.target unreachable from `.reader-card` — a
  // detached node has no path up to it — and read the click as tapping
  // away, closing the panel it was just asked to fill in.
  revealBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    revealReaderCardDefinition(p, s, i, token);
  });
  body.appendChild(revealBtn);
}

/** `token.d`, when present, is already the vocab curriculum's own item id
 * (its dictionary-form surface — vocab-plan.md §3.3), so this needs no
 * lookup step beyond loading that word's own unit. */
async function revealReaderCardDefinition(p, s, i, token) {
  const key = tokenStateKey(p, s, i);
  state.readerCardRevealed = true;
  state.readerLookedUp.set(token.s, token);
  const body = $('reader-card-body');
  body.innerHTML = '';
  body.appendChild(renderReaderCardHead(token));
  const loading = document.createElement('p');
  loading.className = 'hint';
  loading.textContent = 'Loading…';
  body.appendChild(loading);

  let vocabCourseObj = null;
  let entry = null;
  if (token.d) {
    vocabCourseObj = vocabCourseForId(token.d);
    if (vocabCourseObj) {
      await ensureVocabUnitLoaded(vocabCourseObj.unit);
      if (state.readerCardKey !== key) return; // navigated away mid-load
      entry = vocabInfo(vocabCourseObj, token.d);
    }
  }

  body.innerHTML = '';
  body.appendChild(renderReaderCardHead(token));

  // The headline is what this word means HERE, in the form it is actually
  // written in — "went", not "to go" (story-writing-guide.md §4). A story
  // token always carries one; the curriculum's own gloss is the fallback for
  // any that doesn't, and the last resort is saying so plainly.
  const gloss = document.createElement('p');
  gloss.className = 'reader-card-gloss';
  gloss.textContent = token.g
    || (entry ? wordGlossSummary(entry) : 'not one of the words this app teaches');
  body.appendChild(gloss);

  // Then what that form IS, and what it comes from: "polite past of 行く —
  // to go". The dictionary word's own meaning is appended when this app
  // teaches it, so the learner sees the connection rather than two
  // unrelated English phrases.
  if (token.cf && token.df) {
    const form = document.createElement('p');
    form.className = 'hint';
    form.textContent = entry
      ? `${token.cf} of ${token.df} (${wordMeaningLabel(entry)})`
      : `${token.cf} of ${token.df}`;
    body.appendChild(form);
  } else if (entry && token.g) {
    // Not inflected, but taught here — show the curriculum's fuller sense
    // list under the contextual gloss, but only when it genuinely adds
    // something. A summary that merely restates the contextual gloss and
    // then trails off into senses this passage doesn't use ("washing,
    // laundry · relaxation, rejuvenation…") reads as repetition; the full
    // entry is one tap away behind "Word details" for anyone who wants it.
    const full = wordGlossSummary(entry);
    if (full !== token.g && !full.startsWith(token.g)) {
      const more = document.createElement('p');
      more.className = 'hint';
      more.textContent = full;
      body.appendChild(more);
    }
  }

  const translateBtn = document.createElement('button');
  translateBtn.type = 'button';
  translateBtn.className = 'btn btn-quiet';
  translateBtn.textContent = 'Translate this sentence';
  translateBtn.addEventListener('click', () => { toggleSentenceTranslation(p, s); closeReaderCard(); });
  body.appendChild(translateBtn);

  const chips = document.createElement('div');
  chips.className = 'row reader-card-chips';
  if (entry && vocabCourseObj) {
    const wordChip = document.createElement('button');
    wordChip.type = 'button';
    wordChip.className = 'btn btn-quiet';
    wordChip.textContent = 'Word details ›';
    wordChip.addEventListener('click', () => openReaderDetail(vocabCourseObj, token.d));
    chips.appendChild(wordChip);
  }
  body.appendChild(chips);

  if (tokenHasKanji(token)) {
    const kanjiChips = document.createElement('div');
    kanjiChips.className = 'row reader-card-chips';
    fillWordKanjiChips(kanjiChips, token.s, openReaderDetail);
    body.appendChild(kanjiChips);
  } else if (token.pos !== 'punct') {
    const kanaChips = document.createElement('div');
    kanaChips.className = 'row reader-card-chips';
    const chars = [...new Set([...token.k])].filter((ch) => kanaCourseForChar(ch));
    chars.forEach((ch) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'reading-chip';
      chip.textContent = ch;
      chip.addEventListener('click', () => openReaderDetail(kanaCourseForChar(ch), ch));
      kanaChips.appendChild(chip);
    });
    kanaChips.hidden = chars.length === 0;
    body.appendChild(kanaChips);
  }
}

// --- The end card (stories-plan.md §8.5) --------------------------------

function showReaderEndCard() {
  const story = state.readerStory;
  $('reader-end-title').textContent = `You finished ${story.title.ja}`;
  const wordsEl = $('reader-end-words');
  wordsEl.innerHTML = '';
  const looked = [...state.readerLookedUp.values()];
  if (looked.length === 0) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = 'Nothing looked up this time.';
    wordsEl.appendChild(p);
  }
  looked.forEach((token) => {
    const row = document.createElement('div');
    row.className = 'reader-end-word';
    const label = document.createElement('span');
    const vocabCourseObj = token.d ? vocabCourseForId(token.d) : null;
    const entry = vocabCourseObj ? vocabInfo(vocabCourseObj, token.d) : null;
    // The story's own contextual gloss first — it is the meaning the learner
    // actually met, and unlike the curriculum's it exists for every word.
    const meaning = token.g || (entry ? wordMeaningLabel(entry) : null);
    label.textContent = meaning ? `${token.s} — ${meaning}` : token.s;
    row.appendChild(label);
    if (entry && vocabCourseObj) {
      const modes = applicableStudyModes(vocabCourseObj, token.d);
      const already = modes.length > 0 && modes.every((mode) => isStudying(state.profile.study, token.d, mode));
      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'btn btn-quiet';
      addBtn.textContent = already ? 'Studying' : '+ Add';
      addBtn.disabled = already;
      addBtn.addEventListener('click', () => {
        const { study, unstudy } = state.profile;
        modes.forEach((mode) => setStudying(study, unstudy, token.d, mode, true));
        store.saveProfile(state.profile);
        addBtn.textContent = 'Studying';
        addBtn.disabled = true;
      });
      row.appendChild(addBtn);
    }
    wordsEl.appendChild(row);
  });
  $('reader-end-next').hidden = true; // no series wired up yet — see stories-plan.md §12 phase 9
  $('reader-end').hidden = false;
}

/**
 * `source.credit` ("Written by"/"Retold by"/"Adapted by"/"Translated by",
 * see validateStory in tools/build_story_data.mjs) says WHO did what to this
 * story, which `source.by` alone does not — "Claude Opus 5.0" gives no hint
 * whether that's the original author or someone retelling a public-domain
 * tale, and readers were asking exactly that question with no way to answer
 * it from this screen. Led with credit + by, ahead of the older `text`/
 * `licence` sourcing detail, since who wrote it is the more load-bearing
 * fact for a reader deciding how much to trust the Japanese on screen.
 */
function renderReaderSource(story) {
  const el = $('reader-source');
  const { source } = story;
  el.hidden = false;
  // `credit` always accompanies `by` for anything built by
  // tools/build_story_data.mjs (validateStory requires both together) — the
  // plain "— by" form only covers a story from elsewhere that set `by`
  // without it.
  const byline = source.by
    ? (source.credit ? `${source.credit} ${source.by}. ` : `${source.by}. `)
    : '';
  el.textContent = `${byline}${source.text}. ${source.licence}`;
}

function scrollToResumePosition(story, id) {
  const saved = state.profile.stories && state.profile.stories.pos && state.profile.stories.pos[id];
  if (!saved) return;
  // A hash mismatch means the story was edited since this position was
  // saved — clamp to the paragraph rather than trust a sentence index that
  // may no longer line up (stories-plan.md §3.5).
  const pIndex = Math.min(saved.h === story.hash ? saved.p : 0, story.body.length - 1);
  const target = $('reader-body').querySelector(`.reader-para[data-p="${pIndex}"]`);
  if (target) requestAnimationFrame(() => target.scrollIntoView({ block: 'start' }));
}

async function openStory(id) {
  const manifestEntry = STORIES[id];
  if (!manifestEntry) return;
  const requestNav = navSeq;
  const story = await withLoading(ensureStoryLoaded(id));
  if (navSeq !== requestNav) return;

  state.readerStoryId = id;
  state.readerStory = story;
  state.readerView = buildReaderView();
  state.storyRevealLevels = new Map();
  state.storyOccurrence = storyOccurrenceIndex(story.body);
  state.storyCounted = new Set(); // cleared per story open — stories-plan.md §6.3
  state.readerLookedUp = new Map();
  state.readerCardKey = null;
  state.readerCardRevealed = false;
  state.readerActiveKey = null;
  state.readerFinished = false;
  state.readerCursor = -1;

  touchStoryOpened(id);
  $('reader-title').textContent = story.title.ja;
  $('reader-end').hidden = true;
  $('reader-finished').hidden = false;
  closeReaderCard();
  renderReaderBody();
  renderReaderSource(story);
  updateReaderProgress(0);
  // AFTER show(): scrollIntoView on a paragraph inside a still-[hidden]
  // (display:none) screen is a no-op, since a non-rendered element has no
  // scroll position to scroll to.
  show('screen-reader');
  scrollToResumePosition(story, id);
}

// --- Wiring ---------------------------------------------------------------

function wire() {
  renderEmojiPicker();
  renderProfileEmojiPicker();
  renderColorPicker();

  $('new-profile-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = $('new-profile-name').value;
    const profile = await store.createProfile(name, selectedEmoji());
    $('new-profile-name').value = '';
    openProfile(profile);
  });

  $('add-profile').addEventListener('click', () => {
    $('new-profile-form').hidden = false;
    $('new-profile-name').focus();
  });

  $('lesson-next').addEventListener('click', advanceLesson);
  // Vocabulary's reveal ladder (vocab-plan.md §5.2) — a no-op outside a
  // vocab Meaning question's definition stage, see clickVocabWord().
  $('quiz-kana').addEventListener('click', clickVocabWord);
  // Post-answer "click wherever possible" (clickQuizGlyph) — a no-op until
  // the question is over, so it coexists with clickVocabWord's own reveal
  // ladder above rather than competing with it for the same tap.
  $('quiz-kana').addEventListener('click', clickQuizGlyph);
  // "Hide furigana in future" (vocab-plan.md §5.3) — see
  // clickHideFuriganaButton(). Toggled per-question in
  // updateVocabWordDisplay().
  $('quiz-hide-furigana').addEventListener('click', clickHideFuriganaButton);

  // Stories (stories-plan.md §7/§8) — one delegated listener handles every
  // tap inside the reader: the reveal ladder, the definition card, and the
  // sentence-translate target (a word's own tap ladder, or the sentence's
  // final punctuation) all live under #reader-body, and closing the card on
  // an outside tap has to run AFTER those checks, in the same listener,
  // rather than in a second one that would race it.
  // One delegated listener for the WHOLE reader screen, not just the text:
  // the reveal ladder, the definition card, the sentence-translate target —
  // and, crucially, tapping away. "Away" has to include the margins and the
  // empty space below the last paragraph, which is exactly where a thumb
  // lands when someone means "never mind"; a listener scoped to #reader-body
  // alone would never hear those.
  //
  // READER_OWNS_ITS_TAPS are the regions that handle their own clicks and
  // must not be read as tapping away: the definition card and settings sheet
  // (tapping inside a panel must not dismiss it), the top bar, the end card,
  // and the Finished button.
  const READER_OWNS_ITS_TAPS = '.reader-card, .topbar, .reader-end, #reader-finished';
  // On `document`, not on #screen-reader: the screen section sits inside
  // #app's own side padding, so a thumb landing in the outer margin — a
  // natural place to tap for "never mind" — hits <main> and would never
  // reach a listener bound to the section itself. Guarded by the current
  // screen so it is inert everywhere else.
  document.addEventListener('click', (event) => {
    if (currentScreenId !== 'screen-reader' || !state.readerStory) return;
    if (event.target.closest(READER_OWNS_ITS_TAPS)) return;
    const translateEl = event.target.closest('.reader-translate-tap');
    if (translateEl) {
      toggleSentenceTranslation(translateEl.dataset.p, translateEl.dataset.s);
      return;
    }
    const tapEl = event.target.closest('.reader-tap');
    if (tapEl) { handleReaderTokenTap(tapEl); return; }
    clearReaderFocus();
  });
  $('story-make-level').addEventListener('click', () => {
    state.profile.settings.readingLevel = state.readerBrowseLevel;
    stampSetting(state.profile, 'readingLevel');
    store.saveProfile(state.profile);
    renderStoriesLibrary();
  });
  $('reader-finished').addEventListener('click', finishReading);
  // Bound once, for the life of the app, and a no-op off the reader screen
  // (readerScrollSync checks) — cheaper and less error-prone than binding
  // and unbinding per story open. Guarded the same way the install-prompt
  // and lifecycle listeners below are: the stub DOM in test/wiring.js has no
  // window.addEventListener.
  if (typeof window.addEventListener === 'function') {
    window.addEventListener('scroll', readerScrollSync, { passive: true });
  }
  $('reader-end-library').addEventListener('click', openStoriesLibrary);
  loadReaderSettings();
  applyReaderSettings();
  $('reader-text-size').addEventListener('input', (event) => {
    state.readerTextSize = Number(event.target.value);
    saveReaderSettings();
    applyReaderSettings();
  });
  $('reader-furigana-mode').addEventListener('change', (event) => {
    state.readerFuriganaMode = event.target.value;
    saveReaderSettings();
    state.storyRevealLevels = new Map(); // starting states just changed under every token
    closeReaderCard();
    renderReaderBody();
  });
  $('reader-show-romaji').addEventListener('change', (event) => {
    state.readerShowRomaji = event.target.checked;
    saveReaderSettings();
    state.storyRevealLevels = new Map(); // every ladder just gained or lost its last step
    closeReaderCard();
    renderReaderBody();
  });
  $('reader-show-translations').addEventListener('change', (event) => {
    state.readerShowAllTranslations = event.target.checked;
    saveReaderSettings();
    $('reader-body').querySelectorAll('.reader-translation').forEach((el) => {
      el.hidden = !state.readerShowAllTranslations;
    });
  });

  $('detail-study-toggle').addEventListener('click', toggleDetailStudy);
  STUDY_MODE_IDS.forEach((mode) => {
    $(`detail-mode-${mode}`).addEventListener('click', () => toggleDetailStudyMode(mode));
  });
  $('detail-study-now').addEventListener('click', studyDetailCharNow);

  $('quick-review-due').addEventListener('click', quickReviewDue);
  $('quick-learn-next').addEventListener('click', quickLearnNext);

  // Live filtering as you type — cheap enough over ~1,000 kanji that a
  // debounce would only add perceived latency for no real benefit.
  $('kanji-search').addEventListener('input', renderCourse);

  $('kanji-search-clear').addEventListener('click', () => {
    $('kanji-search').value = '';
    renderCourse();
    $('kanji-search').focus();
  });

  // Hidden until a question resolves (kana: correct or second miss; kanji:
  // every reading found or "Show answers" pressed) — always just "Next".
  $('quiz-ok').addEventListener('click', () => { if (state.session) nextQuestion(); });

  // Kanji only.
  $('quiz-info-more').addEventListener('click', openQuizCharacterDetail);
  $('quiz-back-previous').addEventListener('click', openPreviousPlacementDetail);
  $('quiz-show-answers').addEventListener('click', showKanjiAnswers);
  $('quiz-advanced').addEventListener('click', expandKanjiAdvanced);

  // Writing: one canvas, wired once here rather than per-question — the
  // handlers read state.session fresh on every pointer event instead of
  // closing over a particular question, the same way every other listener
  // in this function is wired once and driven by live state.
  const writingCanvas = $('writing-canvas');
  writingCanvas.addEventListener('pointerdown', writingPointerDown);
  writingCanvas.addEventListener('pointermove', writingPointerMove);
  writingCanvas.addEventListener('pointerup', writingPointerUp);
  writingCanvas.addEventListener('pointercancel', writingPointerUp);
  bindTap($('writing-next'), () => { if (state.session) nextQuestion(); });
  // Post-answer "click wherever possible" — see the comment on
  // #writing-result-glyph in index.html and finishWritingCharacter() above,
  // which is what reveals and populates it; inert (hidden) until then.
  bindTap($('writing-result-glyph'), () => {
    const session = state.session;
    if (!session) return;
    openWritingCharacterDetail(getAnyCourse(state.courseId), session.queue[session.position]);
  });
  bindTap($('writing-retry'), writingRetry);
  bindTap($('writing-mark-bad'), writingMarkBad);
  WRITING_SUB_MODES.forEach((mode) => {
    $(`writing-mode-${mode}`).addEventListener('click', () => writingSetSubMode(mode));
  });
  bindTap($('writing-done'), writingDone);
  bindTap($('writing-undo'), writingUndo);
  bindTap($('writing-self-grade-yes'), () => writingSelfGrade(true));
  bindTap($('writing-self-grade-no'), () => writingSelfGrade(false));
  // One button, direction depends on how the just-finished attempt went —
  // see finishWritingCharacter(), which sets session.writingLastCorrect.
  bindTap($('writing-switch-mode'), () => {
    const session = state.session;
    if (!session) return;
    const target = session.writingLastCorrect
      ? nextHarderMode(session.writingSubMode)
      : nextEasierMode(session.writingSubMode);
    if (target) writingSetSubMode(target);
  });
  // Hold to peek: shown only while pressed, hidden the instant it's
  // released — pointerleave/pointercancel too, so dragging off the button
  // (or an interrupted gesture) can't leave it stuck showing.
  bindHoldToPeek($('writing-peek-next'), (on) => writingSetPeek('next', on));
  bindHoldToPeek($('writing-peek-full'), (on) => writingSetPeek('full', on));

  $('new-per-session').addEventListener('input', (event) => {
    const value = Number(event.target.value);
    $('new-per-session-value').textContent = value;
    state.profile.settings.newPerSession = value;
    stampSetting(state.profile, 'newPerSession');
    store.saveProfile(state.profile);
  });

  $('writing-strictness').addEventListener('input', (event) => {
    const value = Number(event.target.value);
    $('writing-strictness-value').textContent = strictnessName(value);
    state.profile.settings.strictness = value;
    stampSetting(state.profile, 'strictness');
    store.saveProfile(state.profile);
  });

  $('import-file').addEventListener('change', (event) => {
    const file = event.target.files && event.target.files[0];
    if (file) importBackup(file);
    event.target.value = '';
  });

  $('sync-code-entry').addEventListener('submit', syncEnterCode);

  $('install-banner-dismiss').addEventListener('click', () => {
    $('install-banner').hidden = true;
    try { sessionStorage.setItem(INSTALL_DISMISSED_KEY, '1'); } catch { /* private browsing etc. */ }
  });

  $('sync-nudge-dismiss').addEventListener('click', () => {
    $('sync-nudge').hidden = true;
    if (state.profile) dismissSyncNudge(state.profile.id);
  });
  $('install-banner-action').addEventListener('click', async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice; // resolves either way; appinstalled only fires on "accepted"
    deferredInstallPrompt = null;
    $('install-banner').hidden = true;
  });

  // --- Enter = the primary "carry on" button, on a real keyboard ---------
  //
  // For working through a session with a mouse in one hand and a keyboard
  // in the other: Enter presses whichever forward button the screen is
  // currently offering. Only ONE is live at a time, because only one of
  // these three screens is ever visible, and on the quiz/writing screens
  // the button itself is hidden until the question actually resolves — so
  // Enter can never answer a question, only move past one already answered.
  //
  // Two deliberate exclusions: typing (the kanji search box, the new-profile
  // name field), where Enter belongs to the field; and a focused button or
  // link, where the browser already fires a click of its own and acting
  // here too would advance twice. event.repeat keeps a held-down Enter from
  // running through several questions at once.
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.repeat) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target;
    if (target && typeof target.closest === 'function'
      && target.closest('input, textarea, select, button, a')) return;

    const button = primaryAdvanceButton();
    if (!button) return;
    event.preventDefault();
    button.click();
  });

  document.addEventListener('click', async (event) => {
    const trigger = event.target.closest('[data-action]');
    if (!trigger) return;
    switch (trigger.dataset.action) {
      case 'cancel-new-profile': $('new-profile-form').hidden = true; break;
      case 'switch-profile': state.profile = null; renderProfiles(); break;
      case 'open-settings': renderSettings(); break;
      case 'open-transfer': renderSettings(); break;
      // Back out one level: the course screen returns to the script picker.
      // But if a kanji search is active, back out of search first — otherwise
      // this button would strand the learner on the script picker with no
      // visible way back to the grade/mode UI the search had hidden (see
      // renderCourse()), since the search box's own value is easy to miss.
      case 'go-home':
        if (!$('kanji-search-wrap').hidden && $('kanji-search').value.trim()) {
          $('kanji-search').value = '';
          renderCourse();
        } else if (state.profile) renderHome(); else renderProfiles();
        break;
      // Return to the course screen — from a finished session, or from
      // settings opened while on it.
      case 'go-course':
        if (state.profile) renderCourse(); else renderProfiles();
        break;
      // Returns wherever the detail screen was opened from — the set
      // overview (scrolled back to whichever character was being looked at,
      // not the top of a list that can run to 200 characters) normally, or
      // the session summary if that is where its now-tappable chips sent us.
      case 'detail-back':
        // Deliberately show() and not renderQuestion() — the quiz screen is
        // still sitting there fully graded, and re-rendering it would reset
        // the very answer panel this screen was opened from.
        if (state.detailReturn === 'quiz' && state.session) show('screen-quiz');
        else if (state.detailReturn === 'writing' && state.session) show('screen-writing');
        else if (state.detailReturn === 'summary') show('screen-summary');
        else if (state.detailReturn === 'course') renderCourse(); // opened from a search result
        else if (state.detailReturn === 'lesson' && state.session) show('screen-lesson');
        else if (state.detailReturn === 'stack' && state.detailStack.length) {
          // One level back up a drill-in chain (drillIntoDetail): return to
          // the detail screen this one was opened FROM, restoring that
          // screen's own return so the next press keeps unwinding.
          const { courseId, char, returnTo } = state.detailStack.pop();
          openCharacterDetail(getAnyCourse(courseId), char, returnTo);
        } else if (state.detailReturn === 'reader' && state.readerStory) {
          show('screen-reader');
          restoreReaderScroll();
        }
        else renderOverview(state.detailChar);
        break;
      // Opened only from the detail screen, which is still sitting there
      // untouched underneath — no need to re-render it, just show it again.
      case 'open-study-history': openStudyHistory(); break;
      // stories-plan.md §8 — the Read card, the library, and the reader's
      // own back/settings controls.
      case 'open-stories': openStoriesLibrary(); break;
      case 'reader-back':
        if (readerObserver) readerObserver.disconnect();
        closeReaderCard();
        openStoriesLibrary();
        break;
      case 'reader-settings': $('reader-settings-sheet').hidden = false; break;
      case 'reader-settings-close': $('reader-settings-sheet').hidden = true; break;
      case 'study-history-back': show('screen-character-detail'); break;
      case 'close-settings':
        if (!state.profile) renderProfiles();
        else if (state.settingsReturn === 'screen-course') renderCourse();
        else renderHome();
        break;
      case 'quit-session':
        stopLessonStrokeLoop(); // in case quit happened mid-lesson, not from the quiz
        if (state.session) clearTimeout(state.session.pendingAdvance);
        state.session = null;
        renderCourse();
        // Whatever was answered before quitting is already graded and
        // saved locally — finishSession() pushes that; quitting early must
        // too, or it just sits on this device until some later trigger
        // happens to fire. state.session is already null above, which is
        // what lets autoSync run at all (§4.4).
        autoSync({ force: true });
        break;
      // Quiz screen only (#quiz-exit-save) — everything quit-session already
      // does (progress was saved as each question was graded; nothing here
      // is "at risk"), but routed through finishSession() instead of
      // straight back to the course card, so leaving mid-session shows the
      // same tappable summary a completed session would — the whole point
      // being to make "yes, it's saved, here's what you did" visible rather
      // than trusting a bare ✕ to imply it.
      case 'exit-and-save':
        if (state.session) {
          clearTimeout(state.session.pendingAdvance);
          finishSession();
        }
        break;
      case 'again': startSession(state.courseId, 'practice'); break;
      case 'learn-more': startSession(state.courseId, 'new'); break;
      case 'review-more': startSession(state.courseId, 'review'); break;
      // A placement miss ('new', not 'placement': having just been tested on
      // these, the point now is to actually learn them — ordinary lesson
      // cards and normal box-by-box grading, not another blind quiz) still
      // needs the lesson step it never got; every item here was already
      // enrolled the moment it was attempted during the test (see
      // ensurePlacementEnrolled), so passing `items` straight through is
      // exactly "Study it now" (kanji-expansion-plan.md §2.6) over the
      // missed set. Any other session's misses skip straight to a quiz —
      // 'practice' matches what they already are, characters already taught
      // that just need another pass.
      case 'study-missed':
        startSession(
          state.courseId,
          state.summaryMissedIsPlacement ? 'new' : 'practice',
          state.summaryMissed,
          { skipLesson: !state.summaryMissedIsPlacement, carriedResults: state.summaryAllResults },
        );
        break;
      case 'sync-turn-on': syncTurnOn(); break;
      case 'sync-nudge-turn-on': syncTurnOnFromNudge(); break;
      case 'sync-show-code-entry':
        $('sync-code-entry').hidden = false;
        $('sync-code-input').focus();
        break;
      case 'sync-now': syncNow(); break;
      case 'sync-turn-off': syncTurnOff(); break;
      case 'sync-copy-code': syncCopyCode(); break;
      case 'sync-share-code': syncShareCode(); break;
      case 'export': exportBackup(); break;
      case 'import': $('import-file').click(); break;
      case 'force-refresh': forceRefresh(); break;
      case 'toggle-changelog': toggleChangelogHistory(); break;
      case 'delete-profile':
        if (confirm(`Delete ${state.profile.name} and all their progress?`)) {
          await store.deleteProfile(state.profile.id);
          state.profile = null;
          renderProfiles();
        }
        break;
      default: break;
    }
  });
}

// --- Install banner ---------------------------------------------------------
//
// Safari (and mobile browsers generally) evict an ordinary tab's storage far
// more readily than an installed home-screen app's — this is the real,
// observed cause behind "my progress didn't save" reports, not a bug in the
// storage code (see README "Progress and backups"). A new user has no reason
// to know Add to Home Screen matters at all, let alone do it unprompted, so
// this nudges them on a phone browser that isn't already running installed.
//
// Chromium (Android Chrome, Edge, Samsung Internet) exposes a real,
// button-triggerable install flow via `beforeinstallprompt` — captured here
// and reused later from the banner's own button. iOS has no equivalent API
// at all; Add to Home Screen there is always a manual Share-sheet action, so
// its banner is purely instructional. The listener is registered at module
// scope, not inside boot(), so an event firing before boot() runs is never
// missed.

let deferredInstallPrompt = null;
// Guarded rather than called unconditionally: test/wiring.js stubs `window`
// deliberately minimally (no addEventListener/matchMedia at all, since it
// is not a real browser), and app.js runs its top-level boot() as a side
// effect of being imported there.
if (typeof window.addEventListener === 'function') {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault(); // suppress the browser's own mini-infobar — this banner replaces it
    deferredInstallPrompt = event;
    renderInstallBanner();
  });
  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    $('install-banner').hidden = true;
  });
}

function isStandaloneApp() {
  return (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches)
    || navigator.standalone === true; // legacy iOS Safari flag, still the only signal there
}

function isIOSDevice() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
    // iPadOS 13+ reports a desktop-Safari UA string with no "iPad" in it —
    // touch support is what actually distinguishes it from a real Mac.
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isMobileDevice() {
  return isIOSDevice() || /android/i.test(navigator.userAgent);
}

// Dismissing hides the banner for the rest of THIS browser session only,
// not forever — the underlying storage-eviction risk is exactly as real the
// next time an ordinary tab is opened, so re-nagging on a fresh visit is the
// right amount of persistent, short of showing it on every single render.
const INSTALL_DISMISSED_KEY = 'kana-quest-install-dismissed';

function installBannerDismissedThisSession() {
  try {
    return sessionStorage.getItem(INSTALL_DISMISSED_KEY) === '1';
  } catch {
    return false; // private browsing etc. — err toward showing it
  }
}

// Whether the banner has anything to say at all — platform, dismissal, a
// captured install prompt. Kept separate from whether it is actually shown:
// screen-scoped hiding (see updateInstallBannerVisibility() near show()) can
// leave the banner hidden while this is true, because the current screen
// has a fixed bar of its own at the bottom that it would sit on top of.
let installBannerEligible = false;

// Exported so test/wiring.js can exercise the device/standalone/dismissed
// logic directly — the beforeinstallprompt capture itself isn't testable in
// a stubbed (non-browser) DOM by design, see the guard above.
//
// Always explicitly sets installBannerEligible on every path, rather than
// leaving it at whatever it was before: this can run more than once as
// conditions change (a captured install prompt arriving after the first
// render, a dismissal), so "only ever turn it on" would leave the banner
// eligible forever once some earlier call had decided it was.
export function renderInstallBanner() {
  if (isStandaloneApp() || !isMobileDevice() || installBannerDismissedThisSession()) {
    installBannerEligible = false;
    updateInstallBannerVisibility();
    return;
  }

  const action = $('install-banner-action');
  if (isIOSDevice()) {
    // No programmatic install API exists on iOS at all — this is the only
    // way to install there, spelled out since it is genuinely not obvious.
    // Deliberately no claim about WHERE the Share button is (Safari puts it
    // in the bottom toolbar, Chrome on iOS puts it at the top) or what it
    // LOOKS like — no single emoji actually matches every browser's share
    // icon (reported: 📤 doesn't match Chrome's), and showing the wrong one
    // reads as more careless than showing none. Plain text only.
    $('install-banner-text').textContent =
      'Progress may not be saved reliably in a browser tab. Tap Share, then "Add to Home Screen", to keep it safe.';
    action.hidden = true;
  } else if (deferredInstallPrompt) {
    $('install-banner-text').textContent =
      'Install this app so your progress is saved reliably, instead of in a browser tab.';
    action.hidden = false;
  } else {
    installBannerEligible = false; // Chromium but no captured prompt yet — nothing actionable to show
    updateInstallBannerVisibility();
    return;
  }
  installBannerEligible = true;
  updateInstallBannerVisibility();
}

// --- Staying up to date ---------------------------------------------------
//
// An iOS home-screen app is stubborn about picking up new code: swiping it
// away doesn't reliably tear down the service worker, and Safari may serve
// the worker script itself from its own HTTP cache. So: register with
// updateViaCache 'none' (never cache the worker script), actively check for
// an update on launch and whenever the app is brought back to the front, and
// reload once a new worker takes control. See sw.js for the other half.

let reloadingForUpdate = false;

function watchForUpdates() {
  if (!('serviceWorker' in navigator)) return;

  // clients.claim() in sw.js's activate handler makes a brand-new worker
  // take control immediately — including on this page's very first-ever
  // visit (or the first load after Force refresh, which unregisters the
  // worker), when there is no earlier version for it to be "new" relative
  // to. Reloading in that case throws away real in-progress state — a
  // profile mid-creation, a session mid-question — for no reason: there is
  // no newer code to pick up, since this is the only code that has ever run
  // on this page load. Only a controllerchange that supersedes an
  // ALREADY-controlling worker is a genuine update worth reloading for.
  const hadController = !!navigator.serviceWorker.controller;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return; // first-ever activation, not an update
    // A new worker took over: the page is running old code, so reload once.
    if (reloadingForUpdate) return;
    reloadingForUpdate = true;
    window.location.reload();
  });

  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
    .then((registration) => {
      registration.update().catch(() => {});
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) registration.update().catch(() => {});
      });
    })
    .catch(() => { /* offline support is optional */ });
}

/**
 * The escape hatch: drop Kana Quest's caches, unregister this app's worker,
 * and reload from the network. Sibling PWAs on the same origin are left
 * alone. Nothing here touches IndexedDB, so learner progress survives.
 */
export async function forceRefresh() {
  $('transfer-status').textContent = 'Refreshing…';
  try {
    if ('serviceWorker' in navigator) {
      // `./` resolves to this deployed app directory and getRegistration()
      // returns only the registration whose scope contains that URL.
      const registration = await navigator.serviceWorker.getRegistration('./');
      if (registration) await registration.unregister();
    }
    if (window.caches) {
      const keys = await caches.keys();
      await Promise.all(keys
        .filter((key) => key.startsWith(CACHE_PREFIX))
        .map((key) => caches.delete(key)));
    }
  } catch {
    // Even if clearing fails, the reload below is still worth doing.
  }
  reloadingForUpdate = true;
  // Cache-busting query so the navigation itself cannot come from a cache.
  window.location.replace(`${window.location.pathname}?fresh=${Date.now()}`);
}

/** The splash is plain HTML shown before boot() runs at all (see index.html)
 * — this is what takes it back down once there's a real screen underneath. */
function hideSplash() {
  const splash = $('splash');
  if (splash) splash.hidden = true;
}

/**
 * The app-lifecycle half of automatic sync (§4.3). Leaving the app is the
 * one moment worth pushing outside a session boundary — a phone put down
 * mid-course is the common way practice would otherwise sit unsent until
 * next launch. Coming back pulls only if it's been a while (SYNC_STALE_MS),
 * so flicking between apps doesn't cost a request each time.
 */
function watchLifecycleForSync() {
  // Both directions call the same guarded autoSync: leaving is a no-op when
  // nothing changed, returning is a no-op when it synced recently.
  document.addEventListener('visibilitychange', () => autoSync());
  // Guarded the same way as the install-prompt listeners above — the stub
  // DOM in test/wiring.js has no window.addEventListener.
  if (typeof window.addEventListener === 'function') {
    window.addEventListener('online', () => autoSync({ force: true }));
  }
}

async function boot() {
  wire();
  store.requestPersistence();
  await renderProfiles();
  hideSplash();
  watchForUpdates();
  watchLifecycleForSync();
  renderInstallBanner(); // iOS has no beforeinstallprompt event, so this is the only call that ever renders it there
}

boot();
