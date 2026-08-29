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
  VOCAB_COURSES, vocabInfo, wordHasKanji, unitLabel as vocabUnitLabel, unitGroupLabel as vocabUnitGroupLabel,
  ensureVocabUnitLoaded, vocabUnitFor, vocabIdForWord, buildMeaningChoices, buildYomiChoices,
  partialFuriganaIsAskable, pronunciationFor,
  buildRecallChoices, recallHasSpellingStage, buildSpellingChoices,
} from './vocab.js';
import {
  MODES, modesForKind, modeName, modeHint, defaultModeForKind, isModeComingSoon,
  itemKey, yomiKey, grade, gradeYomi, buildSession, courseStats,
  currentSetIndex, readyForMore, newRecord, newYomiRecord, masteryTier, autoWritingMode,
  deriveStudyList, isLegacyStudyShape, migrateStudyShape, enrollNext, newItems, introducedItems,
  isStudying, setStudying, studiedKanji, neverSeenItems, studyModes, isKanjiChar,
  recomputeVocabRollup,
  exposureKanjiKey, exposureWordKey, exposureCount, isExposurePromoted,
  addExposure, recordDemotionStrike, recomputeYomiRollupFromProgress,
} from './srs.js';
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

export const APP_VERSION = '2026-08-29e'; // keep in step with VERSION in sw.js
const CACHE_PREFIX = 'kana-quest-';

const ALL_COURSES = [...COURSES, ...KANJI_COURSES, ...VOCAB_COURSES];

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

function getAnyCourse(courseId) {
  if (courseId === STUDY_LIST_POOL_ID) return studyListPool(state.mode);
  if (courseId === ALL_KANJI_POOL_ID) return allKanjiPool();
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

const EMOJI_CHOICES = ['🌱', '🦊', '🐧', '🐙', '🦉', '🐳', '🍡', '🌸', '⚡️', '🚀', '🐢', '🍄'];

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
  mode: 'recognition',
  session: null,
  // Set overview / character detail — independent of the session state
  // above, since they're read-only browsing, reachable with or without one.
  overviewCourseId: null,
  detailCourseId: null,
  detailChar: null,
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
  if (script.kind === 'vocab') return VOCAB_COURSES;
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

/** vocab-plan.md §2.3: Core spine first, then the five GCSE-style theme
 * groups — VOCAB_COURSES (vocab.js) is already sorted that way, so this just
 * needs to notice when the group changes, same shape as the kanji picker
 * above but with the label coming from unitGroupLabel() instead of a fixed
 * per-unit test table (vocab groups are baked into the unit id itself). */
function renderVocabUnitPicker() {
  const picker = $('grade-picker');
  picker.hidden = false;
  let lastGroup = null;
  VOCAB_COURSES.forEach((course) => {
    const { unit } = course;
    const group = vocabUnitGroupLabel(unit);
    if (group !== lastGroup) {
      const heading = document.createElement('div');
      heading.className = 'grade-group-label';
      heading.textContent = group;
      picker.appendChild(heading);
      lastGroup = group;
    }
    const stats = courseStats(course, state.mode, state.profile);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `grade${state.vocabUnit === unit ? ' active' : ''}`;
    button.dataset.grade = unit;
    button.innerHTML = '<span class="grade-number"></span><span class="grade-dot"></span>';
    button.querySelector('.grade-number').textContent = unit;
    button.querySelector('.grade-dot').textContent = stats.due > 0 ? '•' : '';
    button.setAttribute('aria-label', `${vocabUnitLabel(unit)}, ${stats.started} of ${stats.total} started`);
    button.addEventListener('click', () => { state.vocabUnit = unit; renderCourse(); });
    picker.appendChild(button);
  });
}

function renderGradePicker(script) {
  const picker = $('grade-picker');
  picker.innerHTML = '';
  if (script.kind === 'vocab') {
    renderVocabUnitPicker();
    return;
  }
  if (script.kind !== 'kanji') {
    picker.hidden = true;
    return;
  }
  picker.hidden = false;
  let lastGroup = null;
  KANJI_UNIT_IDS.forEach((unit) => {
    const group = kanjiUnitGroup(unit);
    if (group !== lastGroup) {
      const heading = document.createElement('div');
      heading.className = 'grade-group-label';
      heading.textContent = group.label;
      picker.appendChild(heading);
      lastGroup = group;
    }
    const course = getAnyCourse(`kanji-grade-${unit}`);
    const stats = courseStats(course, state.mode, state.profile);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `grade${state.kanjiUnit === unit ? ' active' : ''}`;
    button.dataset.grade = unit;
    button.innerHTML = '<span class="grade-number"></span><span class="grade-dot"></span>';
    button.querySelector('.grade-number').textContent = unitBadge(unit);
    // A dot marks a grade with reviews waiting, so the right one to open is
    // visible without tapping through all of them.
    button.querySelector('.grade-dot').textContent = stats.due > 0 ? '•' : '';
    button.setAttribute('aria-label', `${course.name}, ${stats.started} of ${stats.total} started`);
    button.addEventListener('click', () => { state.kanjiUnit = unit; renderCourse(); });
    picker.appendChild(button);
  });
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

/**
 * Kanji only — kana has no study list to span. The two things a learner
 * actually does every day, ahead of all the grade-by-grade browsing below:
 * review whatever's due, across every grade being studied at once (the
 * synthetic pool from studyListPool() above), or learn the next batch of new
 * characters in overall curriculum order (allKanjiPool() above) — both are
 * deliberately agnostic to whichever grade-picker tile happens to be
 * selected below, which only controls what the browsing card underneath
 * shows. Supersedes the old "This set"/"Everything I'm studying" review-
 * scope toggle: there is no longer a reason to review (or learn) just one
 * grade at a time, so that choice is gone rather than hidden somewhere else.
 */
function renderQuickActions(script) {
  const wrap = $('quick-actions');
  if (script.kind !== 'kanji') {
    wrap.hidden = true;
    return;
  }
  wrap.hidden = false;

  const poolStats = courseStats(getAnyCourse(STUDY_LIST_POOL_ID), state.mode, state.profile);
  const reviewButton = $('quick-review-due');
  if (poolStats.due > 0) {
    reviewButton.disabled = false;
    reviewButton.innerHTML = `Review <b>${poolStats.due}</b> due`;
  } else {
    reviewButton.disabled = true;
    reviewButton.textContent = 'Nothing due';
  }

  const stats = courseStats(getAnyCourse(ALL_KANJI_POOL_ID), state.mode, state.profile);
  const newCount = Math.min(stats.fresh, state.profile.settings.newPerSession);
  const learnButton = $('quick-learn-next');
  if (newCount > 0) {
    learnButton.disabled = false;
    learnButton.innerHTML = `Learn <b>${newCount}</b> next`;
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
  const pool = getAnyCourse(STUDY_LIST_POOL_ID);
  if (courseStats(pool, state.mode, state.profile).due === 0) return;
  startSession(pool.id, 'review');
}

function quickLearnNext() {
  const pool = getAnyCourse(ALL_KANJI_POOL_ID);
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
  renderGradePicker(script);
  renderQuickActions(script);
  renderWritingModePicker();

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
  const settled = readyForMore(course, state.mode, profile);
  const setsLeft = remainingSetsLabel(course, state.mode, profile, setIndex, stats.fresh);

  const card = document.createElement('div');
  card.className = 'card course-card';
  card.innerHTML = `
    <div class="course-head">
      <div>
        <h3>${course.name}</h3>
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
    // sitting enrolled, rather than "new" — it was chosen from the detail
    // screen (§1.6), not freshly reached in course order. Kana has no
    // enrollment step at all, so stats.pending there just means "never seen
    // yet" and must not trigger this wording — every kana would otherwise
    // show as "waiting" until the whole course is memorised.
    learn.innerHTML = course.kind === 'kanji' && stats.pending > 0
      ? `Learn <b>${newCount}</b> waiting`
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
  tile.className = `overview-tile tier-${tier}${pending ? ' is-pending' : ''}`;
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
    // Belt and braces: every current path here (an overview tile, a summary
    // chip) already guarantees the unit is loaded before this can be
    // reached, but a load already done resolves on the same tick anyway —
    // cheap insurance against a future caller that doesn't.
    const requestNav = navSeq;
    await withLoading(ensureVocabUnitLoaded(course.unit));
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
  // than trusting `course` itself, since a detail screen opened from the
  // "everything I'm studying" review pool (a synthetic multi-grade course,
  // see studyListPool()) would otherwise show that pool's own name instead
  // of the kanji's real grade. Vocab courses map 1:1 to a unit already, so
  // `course` itself is fine there.
  $('detail-unit').hidden = course.kind === 'kana';
  if (course.kind === 'kanji') {
    const unit = kanjiUnitFor(char);
    $('detail-unit').textContent = unit ? unitLabel(unit) : '';
  } else if (course.kind === 'vocab') {
    $('detail-unit').textContent = `${vocabUnitGroupLabel(course.unit)} · ${vocabUnitLabel(course.unit)}`;
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
    $('detail-readings').hidden = false;
    renderReadingChips($('detail-readings'), $('detail-word'), course, char, info);
    renderExposureSummary(char, info);
    $('detail-meanings').hidden = false;
    $('detail-meanings').textContent = info.meanings.join(', ');
    $('detail-word').hidden = true;
    $('detail-word').innerHTML = '';
    $('detail-word-kanji').hidden = true;
    renderGeneralWords(info.words);
  } else if (course.kind === 'vocab') {
    const info = vocabInfo(course, char);
    renderVocabWordGlyph($('detail-glyph'), info);
    $('detail-romaji').hidden = true;
    $('detail-readings').hidden = true;
    $('detail-readings').innerHTML = '';
    $('detail-exposure').hidden = true;
    $('detail-meanings').hidden = false;
    $('detail-meanings').textContent = info.en.join(', ');
    $('detail-word').hidden = true;
    $('detail-word').innerHTML = '';
    renderWordKanjiChips(info);
    $('detail-general-words').hidden = true;
  } else {
    $('detail-word-kanji').hidden = true;
    $('detail-romaji').hidden = false;
    $('detail-romaji').textContent = romajiFor(char);
    $('detail-readings').hidden = true;
    $('detail-readings').innerHTML = '';
    $('detail-exposure').hidden = true;
    $('detail-meanings').hidden = true;
    $('detail-word').hidden = true;
    $('detail-general-words').hidden = true;
  }

  show('screen-character-detail');
}

/**
 * A word's own kanji, as tappable chips into the EXISTING kanji detail
 * screen (vocab-plan.md §7 — "the piece that makes the two halves of the
 * app one app rather than two"). One chip per unique kanji in the surface
 * form, in the order they appear; a kana-only word (uk, or plain hiragana/
 * katakana) has none, and the section hides.
 */
function renderWordKanjiChips(info) {
  const containerEl = $('detail-word-kanji');
  containerEl.innerHTML = '';
  const chars = [...new Set([...info.w].filter(isKanjiChar))];
  chars.forEach((kanji) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'reading-chip';
    chip.textContent = kanji;
    chip.addEventListener('click', () => openKanjiFromWord(kanji));
    containerEl.appendChild(chip);
  });
  containerEl.hidden = chars.length === 0;
}

/**
 * Opens one of a vocab word's own kanji through to ITS detail screen,
 * remembering the word so the back button returns here rather than to
 * wherever the WORD's own screen was opened from — a single level of
 * "back to the word", not a full navigation stack, which is all this needs.
 * See the 'word' case in detail-back (wire()).
 */
function openKanjiFromWord(kanji) {
  const unit = kanjiUnitFor(kanji);
  if (!unit) return; // shouldn't happen — every ruby kanji is a taught kanji
  state.detailWordBack = {
    courseId: state.detailCourseId, char: state.detailChar, returnTo: state.detailReturn,
  };
  const kanjiCourse = KANJI_COURSES.find((c) => c.unit === unit);
  openCharacterDetail(kanjiCourse, kanji, 'word');
}

/** The vocab course a word id belongs to, or null — vocabUnitFor() only
 * gives the unit string, same two-step lookup kanji.js's own
 * kanjiUnitFor -> KANJI_COURSES.find() pairing already uses. */
function vocabCourseForId(id) {
  const unit = vocabUnitFor(id);
  return unit ? VOCAB_COURSES.find((c) => c.unit === unit) : null;
}

/**
 * Kanji detail's own "Common words" list — every word JMdict associates with
 * this kanji, from kanji.js's own list (built independently of vocab.js's
 * separate, smaller frequency-based curriculum — see vocab-plan.md §3.5).
 * A word that also happens to be taught there gets an "Add" button, one tap
 * enrolling it the same way the headline study toggle on that word's own
 * detail screen would (every applicable mode at once) — this is a shortcut
 * into that same study list, not a separate one, so it needs no state of its
 * own beyond study/unstudy. A word with no match in the vocab curriculum (or
 * already added) stays a plain, non-interactive row.
 */
function renderGeneralWords(words) {
  const section = $('detail-general-words');
  const list = $('detail-general-words-list');
  list.innerHTML = '';
  if (!words.length) {
    section.hidden = true;
    return;
  }
  const { study, unstudy } = state.profile;
  words.forEach((word) => {
    const id = vocabIdForWord(word.kanji, word.kana);
    const course = id ? vocabCourseForId(id) : null;
    const modes = course ? applicableStudyModes(course, id) : [];
    const added = modes.length > 0 && modes.every((mode) => isStudying(study, id, mode));
    const addable = modes.length > 0 && !added;

    const row = document.createElement(addable ? 'button' : 'div');
    if (addable) row.type = 'button';
    row.className = `kanji-word${added ? ' is-added' : ''}`;
    renderWord(row, word);
    if (modes.length > 0) {
      const badge = document.createElement('span');
      badge.className = 'word-add-badge';
      badge.textContent = added ? 'Studying' : 'Add';
      row.appendChild(badge);
    }
    if (addable) {
      row.addEventListener('click', () => {
        modes.forEach((mode) => setStudying(study, unstudy, id, mode, true));
        store.saveProfile(state.profile);
        renderGeneralWords(words); // re-render so this row flips to "Studying"
      });
    }
    list.appendChild(row);
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
    renderReadingChips($('lesson-readings'), $('lesson-word'), course, item, info);
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
    $('lesson-readings').hidden = true;
    $('lesson-readings').innerHTML = '';
    $('lesson-meanings').hidden = false;
    $('lesson-meanings').textContent = info.en.join(', ');
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
function renderReadingChips(containerEl, wordEl, course, kanji, info) {
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
    chip.addEventListener('click', () => showChipReadingExample(containerEl, wordEl, course, kanji, reading, chip));
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

function showChipReadingExample(containerEl, wordEl, course, kanji, reading, chip) {
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
    renderWord(wordEl, example);
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
  $('quiz-feedback').textContent = '';
  $('quiz-feedback').className = 'feedback';
  $('quiz-card').className = 'quiz-card';
  $('quiz-info').hidden = true;
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
    return;
  }

  button.classList.add('is-wrong');
  button.disabled = true;

  if (session.attempt === 1) {
    // A miss no longer comes back later in the same session — it used to
    // get silently reinserted a few questions ahead, which meant "how many
    // are left" kept moving in ways nothing on screen explained. The
    // session now runs through its queue exactly once regardless of misses;
    // the summary offers to go practise whatever came back wrong afterward
    // instead (state.summaryMissed, see finishSession() below).
    $('quiz-card').className = 'quiz-card is-wrong';
    $('quiz-feedback').className = 'feedback bad';
    $('quiz-feedback').textContent = 'Try once more';
    return; // still their turn — no lock, no reveal yet
  }

  // Second miss: out of chances, reveal the answer and move on. An English
  // definition is far too long for the big feedback line, and the option
  // itself is already highlighted green, so it just shows a cross there.
  revealSingleAnswer(answer);
  $('quiz-card').className = 'quiz-card is-wrong';
  $('quiz-feedback').className = 'feedback bad';
  // Kana: the romaji that was being asked for is worth spelling out. A
  // definition is far too long for this line, and the right option is
  // already highlighted green among the choices, so that mode says nothing
  // here and lets the red card carry it.
  $('quiz-feedback').textContent = state.mode === 'definition' ? '' : answer;
  session.locked = true;
  disableRemainingChoices();
  if (state.mode === 'definition') showKanjiInfo(getAnyCourse(state.courseId), item);
  $('quiz-ok').hidden = false;
  $('quiz-ok').textContent = 'Next';
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
 * How this word's furigana should default (vocab-plan.md §5.2), computed
 * once per question:
 * - `none` — no kanji at all, nothing to hide; the ladder skips straight to
 *   romaji.
 * - `katakana` — a katakana word; the ladder is katakana -> hiragana ->
 *   romaji, same length as the kanji ladder but with no "known" gate.
 * - `whole` — a jukujikun word (build_vocab_data.py couldn't align it to
 *   per-kanji readings, e.g. 大人) — all-or-nothing: hidden only if EVERY
 *   kanji in it is known OR the word itself has earned the hidden default by
 *   exposure (vocab-plan.md §5.3 — jukujikun words accrue against the whole
 *   word, having no per-kanji reading to key on).
 * - `perchar` — the normal case: each kanji position hides independently,
 *   enrolled in any mode OR its specific (kanji, reading) pair promoted by
 *   exposure — the two rules are an OR, per §5.3.
 */
function vocabHiddenState(info) {
  if (!wordHasKanji(info.w)) {
    const isKatakana = [...info.w].some((ch) => ch >= 'ァ' && ch <= 'ヶ');
    return { mode: isKatakana ? 'katakana' : 'none' };
  }
  const { exposure } = state.profile;
  if (!info.ruby) {
    const chars = [...info.w].filter(isKanjiChar);
    const known = chars.length > 0 && chars.every(isKanjiKnown);
    const promoted = isExposurePromoted(exposure, exposureWordKey(info.w));
    return { mode: 'whole', hidden: known || promoted };
  }
  const hidden = new Set();
  info.ruby.forEach((entry) => {
    const pos = entry[0];
    const known = isKanjiKnown(info.w[pos]);
    const promoted = isExposurePromoted(exposure, exposureKanjiKey(info.w[pos], vocabExposureReading(entry)));
    if (known || promoted) hidden.add(pos);
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
  choices.className = 'choice-grid choice-grid-text';
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
    $('quiz-feedback').textContent = '';
    disableRemainingChoices();
    proceedAfterVocabDefinition(course, item, true);
    return;
  }

  button.classList.add('is-wrong');
  button.disabled = true;

  if (session.attempt === 1) {
    $('quiz-card').className = 'quiz-card is-wrong';
    $('quiz-feedback').className = 'feedback bad';
    $('quiz-feedback').textContent = 'Try once more';
    return;
  }

  revealSingleAnswer(session.vocabAnswer);
  $('quiz-card').className = 'quiz-card is-wrong';
  $('quiz-feedback').className = 'feedback bad';
  disableRemainingChoices();
  proceedAfterVocabDefinition(course, item, false);
}

/** After the definition stage resolves: on to the yomi follow-up (§5.4) if
 * it was answered right, something was genuinely hidden, and the learner
 * never revealed it — otherwise the question is simply done.
 *
 * The options are constrained by whatever furigana stayed on screen (§5.4);
 * vocabHiddenState already guaranteed back at question-build time that the
 * display it chose leaves enough of them. */
function proceedAfterVocabDefinition(course, item, correct) {
  const session = state.session;
  const qualifies = correct && !session.vocabRevealed && vocabHasHiddenReading(session.vocabHidden);
  if (qualifies) {
    const hiddenInfo = session.vocabHidden;
    session.vocabStage = 'yomi';
    renderVocabYomiStage(buildYomiChoices(
      course,
      item,
      hiddenInfo.mode === 'perchar' ? hiddenInfo.hidden : null,
    ));
    return;
  }
  session.vocabStage = 'done';
  session.locked = true;
  $('quiz-ok').hidden = false;
  $('quiz-ok').textContent = 'Next';
}

function renderVocabYomiStage({ options, answer }) {
  state.session.vocabYomiAnswer = answer;

  $('quiz-feedback').textContent = '';
  $('quiz-feedback').className = 'feedback';
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
  if (!correct) revealSingleAnswer(session.vocabYomiAnswer);
  $('quiz-card').className = `quiz-card ${correct ? 'is-correct' : 'is-wrong'}`;

  session.vocabStage = 'done';
  session.locked = true;
  $('quiz-ok').hidden = false;
  $('quiz-ok').textContent = 'Next';
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
  $('quiz-kana').textContent = info.en[0];
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
    $('quiz-feedback').textContent = '';
    disableRemainingChoices();
    proceedAfterVocabProd(course, item, true);
    return;
  }

  button.classList.add('is-wrong');
  button.disabled = true;

  if (session.attempt === 1) {
    $('quiz-card').className = 'quiz-card is-wrong';
    $('quiz-feedback').className = 'feedback bad';
    $('quiz-feedback').textContent = 'Try once more';
    return;
  }

  revealSingleAnswer(session.vocabAnswer);
  $('quiz-card').className = 'quiz-card is-wrong';
  $('quiz-feedback').className = 'feedback bad';
  disableRemainingChoices();
  proceedAfterVocabProd(course, item, false);
}

/** After stage 1 resolves: on to the spelling stage (§6.2) only when it was
 * answered right, the word has kanji worth asking about, and at least one
 * of them is under study — otherwise the question is simply done. */
function proceedAfterVocabProd(course, item, correct) {
  const session = state.session;
  const info = vocabInfo(course, item);
  const eligible = correct
    && recallHasSpellingStage(info)
    && [...info.w].some((ch) => isKanjiChar(ch) && isKanjiKnown(ch));

  if (eligible) {
    const masteryOf = (kanji) => masteryTier(state.profile.progress[itemKey('definition', kanji)]);
    const built = buildSpellingChoices(course, item, masteryOf);
    if (built) {
      session.vocabRecallStage = 'spell';
      renderVocabSpellStage(info, built);
      return;
    }
    // Fewer than MIN_SPELLING_OPTIONS survived the mastered-kanji exclusion
    // even after the fallback ladder (§6.4) — skip the stage and grade
    // nothing, rather than serve a question that gives itself away.
  }
  session.vocabRecallStage = 'done';
  session.locked = true;
  $('quiz-ok').hidden = false;
  $('quiz-ok').textContent = 'Next';
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
  $('quiz-prompt-pronunciation').textContent = `"${info.en[0]}"`;

  $('quiz-feedback').textContent = '';
  $('quiz-feedback').className = 'feedback';
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
  if (!correct) revealSingleAnswer(session.vocabSpellAnswer);
  $('quiz-card').className = `quiz-card ${correct ? 'is-correct' : 'is-wrong'}`;

  session.vocabRecallStage = 'done';
  session.locked = true;
  $('quiz-ok').hidden = false;
  $('quiz-ok').textContent = 'Next';
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
  renderWord($('quiz-word'), info.words[0]);
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
 * and the 'detail-back' case in wire(). */
function openQuizCharacterDetail() {
  const session = state.session;
  if (!session) return;
  openCharacterDetail(getAnyCourse(state.courseId), session.queue[session.position], 'quiz');
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
  if (example) {
    renderWord($('quiz-word'), example);
  } else {
    $('quiz-word').innerHTML = '';
    $('quiz-word').textContent = `No common example word found for ${reading}.`;
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
    // actually shows; the word/character detail screen doesn't understand
    // vocab entries yet (§7, a later phase), so the chip isn't a link there.
    if (course.kind === 'vocab') {
      const info = vocabInfo(course, item);
      chip.querySelector('.chip-kana').textContent = info.w;
      chip.querySelector('.chip-romaji').textContent = info.en[0];
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
  learnButton.innerHTML = `Learn <b>${newCount}</b> new`;

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
        else if (state.detailReturn === 'summary') show('screen-summary');
        else if (state.detailReturn === 'course') renderCourse(); // opened from a search result
        else if (state.detailReturn === 'word') {
          // Back from one of a vocab word's own kanji chips (§7) — return to
          // that word's own detail screen, not to wherever IT was opened
          // from, which openCharacterDetail below restores from detailReturn.
          const { courseId, char, returnTo } = state.detailWordBack;
          openCharacterDetail(getAnyCourse(courseId), char, returnTo);
        } else renderOverview(state.detailChar);
        break;
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
