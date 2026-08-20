// Screen routing, session flow and event wiring.

import { COURSES, romajiFor, buildChoices } from './kana.js';
import {
  KANJI_COURSES, kanjiInfo, readingExample, meaningLabel,
  buildKanjiOptions, buildAdvancedAdditions, buildDefinitionChoices, recomputeKanjiRollup,
} from './kanji.js';
import {
  MODES, modesForKind, modeName, modeHint, defaultModeForKind, isModeComingSoon,
  itemKey, yomiKey, grade, gradeYomi, buildSession, courseStats,
  currentSetIndex, readyForMore, newRecord, newYomiRecord, masteryTier, autoWritingMode,
  deriveStudyList, enrollNext, newItems, introducedItems, isStudying, setStudying,
} from './srs.js';
import { buildStrokeSVG, animateStrokes } from './strokes.js';
import {
  createWritingAttempt, createFreeAttempt, setupCanvas, clearCanvas, redrawInk, toModelSpace,
  renderGuide, markGuideStrokeDone, markGuideStrokeReview, setGuidePeekFull, setStrokePeek,
} from './writing.js';
import { STRICTNESS_LEVELS, DEFAULT_STRICTNESS } from './stroke-grader.js';
import * as store from './store.js';

export const APP_VERSION = '2026-08-19g'; // keep in step with VERSION in sw.js

const ALL_COURSES = [...COURSES, ...KANJI_COURSES];
function getAnyCourse(courseId) {
  return ALL_COURSES.find((c) => c.id === courseId);
}

// The three things a learner picks between on the front page. Kanji fans out
// into one course per school grade; each kana script is a single course.
const SCRIPTS = [
  { id: 'hiragana', kind: 'kana', name: 'Hiragana', native: 'ひらがな', sample: 'あ' },
  { id: 'katakana', kind: 'kana', name: 'Katakana', native: 'カタカナ', sample: 'ア' },
  { id: 'kanji', kind: 'kanji', name: 'Kanji', native: '漢字', sample: '学' },
];

const KANJI_GRADES = KANJI_COURSES
  .map((c) => Number(c.id.replace('kanji-grade-', '')))
  .sort((a, b) => a - b);

const EMOJI_CHOICES = ['🌱', '🦊', '🐧', '🐙', '🦉', '🐳', '🍡', '🌸', '⚡️', '🚀', '🐢', '🍄'];

const MASTERY_LABELS = ['Not started', 'Just started', 'Learning', 'Doing well', 'Well known'];

const state = {
  profile: null,
  scriptId: 'hiragana',
  grade: KANJI_GRADES[0],
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
  return currentScript().kind === 'kanji'
    ? getAnyCourse(`kanji-grade-${state.grade}`)
    : getAnyCourse(state.scriptId);
}

/** Every course a script covers — one for kana, one per grade for kanji. */
function coursesForScript(script) {
  return script.kind === 'kanji'
    ? KANJI_COURSES
    : [getAnyCourse(script.id)];
}

const $ = (id) => document.getElementById(id);
const screens = () => document.querySelectorAll('.screen');

function show(screenId) {
  screens().forEach((el) => { el.hidden = el.id !== screenId; });
  window.scrollTo(0, 0);
}

// --- Profiles -------------------------------------------------------------

async function renderProfiles() {
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
 * One-time study-list migration, then open the profile. A profile saved
 * before the study list existed has no `study` field at all, and its
 * enrollment is implied by which progress records exist — deriveStudyList()
 * reads exactly that back out. See kanji-expansion-plan.md §1.3.
 *
 * `undefined` is the trigger, deliberately, not falsiness: `{}` is a
 * legitimate state (everything removed) and must not re-populate itself from
 * history on the next load. Persisted immediately so the derivation happens
 * once rather than on every open.
 */
function openProfile(profile) {
  state.profile = profile;
  if (profile.study === undefined) {
    profile.study = deriveStudyList(profile.progress);
    store.saveProfile(profile);
  }
  renderHome();
}

// --- Home: pick a script --------------------------------------------------

function renderHome() {
  const profile = state.profile;
  $('home-avatar').textContent = profile.emoji;
  $('home-greeting').textContent = profile.name;

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

function renderGradePicker(script) {
  const picker = $('grade-picker');
  picker.innerHTML = '';
  if (script.kind !== 'kanji') {
    picker.hidden = true;
    return;
  }
  picker.hidden = false;
  KANJI_GRADES.forEach((gradeNumber) => {
    const course = getAnyCourse(`kanji-grade-${gradeNumber}`);
    const stats = courseStats(course, state.mode, state.profile);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `grade${state.grade === gradeNumber ? ' active' : ''}`;
    button.dataset.grade = String(gradeNumber);
    button.innerHTML = '<span class="grade-number"></span><span class="grade-dot"></span>';
    button.querySelector('.grade-number').textContent = String(gradeNumber);
    // A dot marks a grade with reviews waiting, so the right one to open is
    // visible without tapping through all six.
    button.querySelector('.grade-dot').textContent = stats.due > 0 ? '•' : '';
    button.setAttribute('aria-label', `Grade ${gradeNumber}, ${stats.started} of ${stats.total} started`);
    button.addEventListener('click', () => { state.grade = gradeNumber; renderCourse(); });
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
 */
function remainingSetsLabel(course, mode, profile, setIndex, fresh) {
  if (fresh === 0) return '';
  const introduced = new Set(introducedItems(course, mode, profile));
  const sequential = course.chunks
    .slice(setIndex + 1)
    .every((chunk) => chunk.items.every((item) => !introduced.has(item)));
  if (!sequential) return '';
  const remaining = course.chunks.length - setIndex;
  return ` · ${remaining} set${remaining === 1 ? '' : 's'} left`;
}

function renderCourse() {
  const profile = state.profile;
  const script = currentScript();
  $('course-title').textContent = script.name;
  renderModePicker(script.kind);
  renderGradePicker(script);
  renderWritingModePicker();

  const course = currentCourse();
  const list = $('course-list');
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
  viewSet.className = 'btn wide overview-button';
  viewSet.innerHTML = '📋 View set overview';
  viewSet.addEventListener('click', () => openOverview(course, currentChunk.items[0]));
  card.appendChild(viewSet);

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
    learn.innerHTML = `Add <b>${newCount}</b> more`;
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

function openOverview(course, scrollToChar) {
  state.overviewCourseId = course.id;
  renderOverview(scrollToChar);
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
  const progress = state.profile.progress;
  const allItems = course.chunks.flatMap((c) => c.items);

  $('overview-title').textContent = course.name;
  $('overview-counter').textContent = `${allItems.length} characters`;

  const grid = $('overview-grid');
  grid.innerHTML = '';
  let scrollTarget = null;
  allItems.forEach((item) => {
    const tier = masteryTier(progress[itemKey(state.mode, item)]);
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = `overview-tile tier-${tier}`;
    tile.textContent = item;
    tile.setAttribute('aria-label', `${item}: ${MASTERY_LABELS[tier]}`);
    tile.addEventListener('click', () => openCharacterDetail(course, item));
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
 * returns to — 'overview' (the set overview, tapping a tile) or 'summary'
 * (the end-of-session summary, tapping a chip — see finishSession()). Kept
 * on state rather than derived from "whichever screen was visible before",
 * since detail can itself be re-entered from detail-adjacent actions with no
 * other screen in between.
 */
function openCharacterDetail(course, char, returnTo = 'overview') {
  state.detailCourseId = course.id;
  state.detailChar = char;
  state.detailReturn = returnTo;
  renderCharacterDetail();
}

// The three modes a kanji can be enrolled in, in the order they read best on
// the detail screen — same order the course mode picker uses.
const STUDY_MODE_IDS = ['definition', 'recognition', 'writing'];

/** Which of the three modes actually apply to this kanji — a handful (媛/栃/
 * 茨 and friends) have no reading any common word uses, so Yomi has nothing
 * to ask about them; see excludeForMode in kanji.js. */
function applicableStudyModes(course, char) {
  return STUDY_MODE_IDS.filter((mode) => {
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

/**
 * Kanji only. The headline button is a bulk convenience — enrolling turns on
 * every applicable mode, un-enrolling turns all of them off — sitting above
 * three independent per-mode toggles for fine control (I want to write 龍 but
 * don't care about its readings). Both act on the same underlying list, so
 * neither can leave the other looking wrong: toggling one mode by hand always
 * updates what the headline button says next.
 */
function renderDetailStudy(course, char) {
  $('detail-study').hidden = course.kind !== 'kanji';
  if (course.kind !== 'kanji') return;

  const { study, progress } = state.profile;
  const modes = applicableStudyModes(course, char);
  const status = studyStatus(study, progress, char, modes);

  const toggle = $('detail-study-toggle');
  toggle.className = `btn wide${status === 'not-studying' ? ' btn-primary' : ''}`;
  toggle.textContent = {
    'not-studying': 'Not studying — tap to start',
    waiting: 'Waiting to learn — tap to stop',
    learning: 'Learning — tap to stop',
  }[status];

  STUDY_MODE_IDS.forEach((mode) => {
    const button = $(`detail-mode-${mode}`);
    button.hidden = !modes.includes(mode);
    button.textContent = modeName(mode, 'kanji');
    button.className = `segment${isStudying(study, char, mode) ? ' active' : ''}`;
  });
}

function toggleDetailStudy() {
  const course = getAnyCourse(state.detailCourseId);
  const char = state.detailChar;
  const { study, progress } = state.profile;
  const modes = applicableStudyModes(course, char);
  const turnOn = studyStatus(study, progress, char, modes) === 'not-studying';
  modes.forEach((mode) => setStudying(study, char, mode, turnOn));
  store.saveProfile(state.profile);
  renderDetailStudy(course, char);
}

function toggleDetailStudyMode(mode) {
  const course = getAnyCourse(state.detailCourseId);
  const char = state.detailChar;
  const { study } = state.profile;
  setStudying(study, char, mode, !isStudying(study, char, mode));
  store.saveProfile(state.profile);
  renderDetailStudy(course, char);
}

function renderCharacterDetail() {
  const course = getAnyCourse(state.detailCourseId);
  const char = state.detailChar;
  const progress = state.profile.progress;

  $('detail-glyph').textContent = char;

  const strokeContainer = $('detail-stroke');
  strokeContainer.innerHTML = '';
  const { svg, paths } = buildStrokeSVG(char);
  strokeContainer.appendChild(svg);
  const playButton = $('detail-play-strokes');
  playButton.hidden = paths.length === 0;
  playButton.onclick = () => animateStrokes(paths);

  const tier = masteryTier(progress[itemKey(state.mode, char)]);
  $('detail-mastery').textContent = MASTERY_LABELS[tier];
  $('detail-mastery').className = `mastery-label tier-${tier}`;

  renderDetailStudy(course, char);

  if (course.kind === 'kanji') {
    const info = kanjiInfo(course, char);
    $('detail-romaji').hidden = true;
    $('detail-readings').hidden = false;
    renderReadingChips($('detail-readings'), $('detail-word'), course, char, info);
    $('detail-meanings').hidden = false;
    $('detail-meanings').textContent = info.meanings.join(', ');
    $('detail-word').hidden = true;
    $('detail-word').innerHTML = '';
    renderGeneralWords(info.words);
  } else {
    $('detail-romaji').hidden = false;
    $('detail-romaji').textContent = romajiFor(char);
    $('detail-readings').hidden = true;
    $('detail-readings').innerHTML = '';
    $('detail-meanings').hidden = true;
    $('detail-word').hidden = true;
    $('detail-general-words').hidden = true;
  }

  show('screen-character-detail');
}

function renderGeneralWords(words) {
  const section = $('detail-general-words');
  const list = $('detail-general-words-list');
  list.innerHTML = '';
  if (!words.length) {
    section.hidden = true;
    return;
  }
  words.forEach((word) => {
    const row = document.createElement('div');
    row.className = 'kanji-word';
    renderWord(row, word);
    list.appendChild(row);
  });
  section.hidden = false;
}

// --- Session --------------------------------------------------------------

function startSession(courseId, kind) {
  state.courseId = courseId;
  state.kind = kind;
  const course = getAnyCourse(courseId);
  const profile = state.profile;
  const { settings } = profile;

  // "Add more" is now two steps: enroll the next few kanji in the study list,
  // then teach whatever is waiting. Anything added by hand from the detail
  // screen is already waiting, so it gets taught first and this tops up from
  // course order only if there is room left. Kana have no study list, so
  // enrollNext is a no-op there and `new` keeps meaning "next never-seen".
  if (kind === 'new') {
    const waiting = newItems(course, state.mode, profile, settings.newPerSession).length;
    if (waiting < settings.newPerSession) {
      enrollNext(course, state.mode, profile, settings.newPerSession - waiting);
      store.saveProfile(profile);
    }
  }

  const built = buildSession(course, state.mode, profile, kind, {
    newPerSession: settings.newPerSession,
    maxReviews: settings.maxReviews,
  });

  if (built.lesson.length === 0 && built.quiz.length === 0) {
    renderCourse();
    return;
  }

  const writingModePref = settings.writingModePreference;

  state.session = {
    lesson: built.lesson,
    lessonIndex: 0,
    queue: built.quiz,
    position: 0,
    answered: 0,
    total: built.quiz.length,
    results: new Map(), // kana -> true/false (first attempt)
    awaitingAcknowledge: false,
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
    writingModeOverride: writingModePref && writingModePref !== 'dynamic' ? writingModePref : null,
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

  if (course.kind === 'kanji') {
    const info = kanjiInfo(course, item);
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
  } else {
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
  info.quizReadings.forEach((reading) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'reading-chip';
    chip.textContent = reading;
    chip.dataset.reading = reading;
    chip.addEventListener('click', () => showChipReadingExample(containerEl, wordEl, course, kanji, reading, chip));
    containerEl.appendChild(chip);
  });
}

function showChipReadingExample(containerEl, wordEl, course, kanji, reading, chip) {
  containerEl.querySelectorAll('.reading-chip').forEach((el) => el.classList.remove('is-active'));
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

  $('quiz-kana').textContent = item;
  $('quiz-feedback').textContent = '';
  $('quiz-feedback').className = 'feedback';
  $('quiz-card').className = 'quiz-card';
  $('quiz-info').hidden = true;
  session.awaitingAcknowledge = false;
  session.locked = false;

  const choices = $('quiz-choices');
  choices.innerHTML = '';

  // Yomi on a kanji is the only multi-answer quiz; kana reading and kanji
  // definition are both "one right option out of ten".
  if (course.kind === 'kanji' && state.mode === 'recognition') renderKanjiChoices(course, item);
  else renderSingleChoice(course, item);

  const done = session.answered;
  $('quiz-counter').textContent = `${Math.min(done + 1, session.total)}/${session.total}`;
  $('quiz-progress').style.width = `${(done / Math.max(session.total, 1)) * 100}%`;
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
 */
function chooseAnswer(value, button) {
  const session = state.session;
  // Taps during the pause after a resolved question are handled by acknowledge().
  if (!session || session.locked || session.awaitingAcknowledge || button.disabled) return;

  const item = session.queue[session.position];
  const answer = session.singleAnswer;
  const correct = value === answer;
  session.attempt += 1;

  if (session.attempt === 1) {
    session.answered += 1;
    recordResult(item, correct);
  }

  if (correct) {
    button.classList.add('is-right');
    $('quiz-card').className = 'quiz-card is-correct';
    $('quiz-feedback').className = 'feedback ok';
    $('quiz-feedback').textContent = '✓';
    session.locked = true;
    if (state.mode === 'definition') showKanjiInfo(getAnyCourse(state.courseId), item);
    session.pendingAdvance = setTimeout(nextQuestion, 550);
    return;
  }

  button.classList.add('is-wrong');
  button.disabled = true;

  if (session.attempt === 1) {
    // Missed characters come back later in the same session regardless of
    // what happens on the second try.
    const reinsertAt = Math.min(session.position + 4, session.queue.length);
    session.queue.splice(reinsertAt, 0, item);
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
  $('quiz-feedback').textContent = state.mode === 'definition' ? '✗' : answer;
  session.locked = true;
  if (state.mode === 'definition') showKanjiInfo(getAnyCourse(state.courseId), item);
  session.awaitingAcknowledge = true; // wait for a tap, but don't stall forever
  session.pendingAdvance = setTimeout(nextQuestion, 2600);
}

function revealSingleAnswer(answer) {
  $('quiz-choices').querySelectorAll('.choice').forEach((el) => {
    if (el.dataset.value === answer) el.classList.add('is-right');
  });
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
  $('writing-romaji').textContent = isKanji ? '' : romajiFor(item);
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
  $('writing-done').hidden = true;
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

  const done = session.answered;
  $('writing-counter').textContent = `${Math.min(done + 1, session.total)}/${session.total}`;
  $('writing-progress').style.width = `${(done / Math.max(session.total, 1)) * 100}%`;
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
  const kun = info.quizKun.join('・');
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

  const { width, height } = session.writingCanvasSize;
  const modelPoints = localPoints.map((p) => toModelSpace(p, width, height));

  if (session.writingSubMode === 'free') {
    session.writingAttempt.submitStroke(modelPoints);
    session.writingStrokes.push(localPoints);
    updateWritingStrokeCounter();
    redrawWritingCanvas();
    $('writing-done').hidden = false; // nothing to press Done for until there's a first stroke
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
  $('writing-done').hidden = true;
  $('writing-self-grade').hidden = false;
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
    session.answered += 1;
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
  $('writing-done').hidden = true;
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
  options.forEach((reading) => addKanjiChoiceButton(choices, reading));
}

function addKanjiChoiceButton(choices, reading) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'choice';
  button.textContent = reading;
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
 * record as a miss, and reinserts the kanji for a fresh attempt later. */
function markKanjiError(kanji, course) {
  const session = state.session;
  session.kanjiErrorMade = true;
  session.kanjiPendingRecord.forEach((reading) => recordYomiResult(course, kanji, reading, false));
  session.kanjiPendingRecord.clear();
  recordKanjiRoundOutcome(kanji, false);

  $('quiz-card').className = 'quiz-card is-wrong';
  $('quiz-feedback').className = 'feedback bad';
  $('quiz-feedback').textContent = 'Keep exploring, or tap Show answers';
  const reinsertAt = Math.min(session.position + 4, session.queue.length);
  session.queue.splice(reinsertAt, 0, kanji);
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
  const { additions, newCorrect } = buildAdvancedAdditions(course, kanji, session.kanjiShown);

  const choices = $('quiz-choices');
  additions.forEach((reading) => {
    addKanjiChoiceButton(choices, reading);
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

function recordYomiResult(course, kanji, reading, correct) {
  const { progress } = state.profile;
  const key = yomiKey(state.mode, kanji, reading);
  progress[key] = gradeYomi(progress[key] || newYomiRecord(), correct);
  recomputeKanjiRollup(course, kanji, state.mode, progress);
}

/** The kanji-level (not reading-level) pass/fail for this round, recorded
 * exactly once — used for the session summary, same as kana's first-attempt
 * tracking. Kanji-level scheduling itself comes from recomputeKanjiRollup. */
function recordKanjiRoundOutcome(kanji, perfect) {
  const session = state.session;
  if (session.kanjiRoundRecorded) return;
  session.kanjiRoundRecorded = true;
  session.answered += 1;
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
  $('quiz-feedback').textContent = perfect ? '✓' : 'Found them all';
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
    : info.quizReadings.join(' · ');
  renderWord($('quiz-word'), info.words[0]);
  $('quiz-word-hint').textContent = isYomi && state.session.kanjiCorrect.size > 1
    ? 'Tap a green reading above to see a word that uses it.'
    : '';
  $('quiz-info').hidden = false;
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

/** A tap anywhere on the quiz screen moves past a revealed kana miss. */
function acknowledge() {
  const session = state.session;
  if (!session || !session.awaitingAcknowledge) return;
  nextQuestion();
}

function nextQuestion() {
  const session = state.session;
  if (!session) return;
  clearTimeout(session.pendingAdvance);
  session.pendingAdvance = null;
  session.awaitingAcknowledge = false;
  session.position += 1;
  // Writing only: a NEW question hasn't been recorded yet. Deliberately not
  // reset in renderWritingQuestion() itself, which also runs for a redo or
  // a mode-toggle switch on the SAME question — those must not re-arm a
  // second recordResult() call for something already graded.
  session.writingRecorded = false;
  renderQuestion();
}

function recordResult(kana, correct) {
  const session = state.session;
  const { progress } = state.profile;
  const key = itemKey(state.mode, kana);
  progress[key] = grade(progress[key] || newRecord(), correct);
  // The summary reflects the first attempt at each character.
  if (!session.results.has(kana)) session.results.set(kana, correct);
  store.saveProfile(state.profile);
}

function finishSession() {
  const session = state.session;
  const course = getAnyCourse(state.courseId);
  const entries = [...session.results.entries()];
  const right = entries.filter(([, ok]) => ok).length;

  $('summary-score').textContent = entries.length
    ? `${right} of ${entries.length} right first time`
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
    chip.querySelector('.chip-kana').textContent = item;
    let label = romajiFor(item);
    if (course.kind === 'kanji') {
      const info = kanjiInfo(course, item);
      label = state.mode === 'definition'
        ? meaningLabel(info)
        : (info.quizReadings[0] || '');
    }
    chip.querySelector('.chip-romaji').textContent = label;
    chip.addEventListener('click', () => openCharacterDetail(course, item, 'summary'));
    list.appendChild(chip);
  });

  // Offer the same two choices as the home screen, so carrying on with more
  // new characters does not mean navigating back out first.
  const stats = courseStats(course, state.mode, state.profile);
  const newCount = Math.min(stats.fresh, state.profile.settings.newPerSession);

  const learnButton = $('summary-learn');
  learnButton.hidden = newCount === 0;
  learnButton.innerHTML = `Add <b>${newCount}</b> more`;

  const reviewButton = $('summary-review');
  reviewButton.hidden = stats.due === 0;
  reviewButton.innerHTML = `Review <b>${stats.due}</b> due`;

  state.session = null;
  store.saveProfile(state.profile);
  show('screen-summary');
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
    $('new-per-session').value = state.profile.settings.newPerSession;
    $('new-per-session-value').textContent = state.profile.settings.newPerSession;
    const strictness = state.profile.settings.strictness || DEFAULT_STRICTNESS;
    $('writing-strictness').value = strictness;
    $('writing-strictness-value').textContent = strictnessName(strictness);
  }
  $('app-version').textContent = APP_VERSION;
  $('transfer-status').textContent = '';
  show('screen-settings');
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

// --- Wiring ---------------------------------------------------------------

function wire() {
  renderEmojiPicker();

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

  $('detail-study-toggle').addEventListener('click', toggleDetailStudy);
  STUDY_MODE_IDS.forEach((mode) => {
    $(`detail-mode-${mode}`).addEventListener('click', () => toggleDetailStudyMode(mode));
  });

  // Taps on choice buttons bubble up to here; chooseAnswer ignores them while
  // an answer is revealed, so the two handlers never both act on one tap.
  $('screen-quiz').addEventListener('click', acknowledge);

  // Hidden until a question resolves (kana: correct or second miss; kanji:
  // every reading found or "Show answers" pressed) — always just "Next".
  $('quiz-ok').addEventListener('click', () => { if (state.session) nextQuestion(); });

  // Kanji only.
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
    store.saveProfile(state.profile);
  });

  $('writing-strictness').addEventListener('input', (event) => {
    const value = Number(event.target.value);
    $('writing-strictness-value').textContent = strictnessName(value);
    state.profile.settings.strictness = value;
    store.saveProfile(state.profile);
  });

  $('import-file').addEventListener('change', (event) => {
    const file = event.target.files && event.target.files[0];
    if (file) importBackup(file);
    event.target.value = '';
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
      case 'go-home':
        if (state.profile) renderHome(); else renderProfiles();
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
        if (state.detailReturn === 'summary') show('screen-summary');
        else renderOverview(state.detailChar);
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
        break;
      case 'again': startSession(state.courseId, 'practice'); break;
      case 'learn-more': startSession(state.courseId, 'new'); break;
      case 'review-more': startSession(state.courseId, 'review'); break;
      case 'export': exportBackup(); break;
      case 'import': $('import-file').click(); break;
      case 'force-refresh': forceRefresh(); break;
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

  navigator.serviceWorker.addEventListener('controllerchange', () => {
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
 * The escape hatch: drop every cache, unregister the worker and reload from
 * the network. Nothing here touches IndexedDB, so learner progress survives.
 */
async function forceRefresh() {
  $('transfer-status').textContent = 'Refreshing…';
  try {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((r) => r.unregister()));
    }
    if (window.caches) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch {
    // Even if clearing fails, the reload below is still worth doing.
  }
  reloadingForUpdate = true;
  // Cache-busting query so the navigation itself cannot come from a cache.
  window.location.replace(`${window.location.pathname}?fresh=${Date.now()}`);
}

async function boot() {
  wire();
  store.requestPersistence();
  await renderProfiles();
  watchForUpdates();
}

boot();
