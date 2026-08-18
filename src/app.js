// Screen routing, session flow and event wiring.

import { COURSES, getCourse, romajiFor, checkRomaji } from './kana.js';
import {
  MODES, itemKey, grade, buildSession, courseStats,
  unlockedChunkCount, newRecord,
} from './srs.js';
import * as store from './store.js';

const EMOJI_CHOICES = ['🌱', '🦊', '🐧', '🐙', '🦉', '🐳', '🍡', '🌸', '⚡️', '🚀', '🐢', '🍄'];

const state = {
  profile: null,
  courseId: 'hiragana',
  mode: 'recognition',
  session: null,
};

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

function openProfile(profile) {
  state.profile = profile;
  renderHome();
}

// --- Home -----------------------------------------------------------------

function renderModePicker() {
  const picker = $('mode-picker');
  picker.innerHTML = '';
  Object.values(MODES).forEach((mode) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `segment${state.mode === mode.id ? ' active' : ''}`;
    button.textContent = mode.name;
    // Writing mode is the next thing to build; it is shown but inert so the
    // shape of the app is visible rather than implied.
    if (mode.id === 'writing') {
      button.disabled = true;
      button.classList.add('segment-soon');
      button.innerHTML = `${mode.name} <small>soon</small>`;
    } else {
      button.addEventListener('click', () => { state.mode = mode.id; renderHome(); });
    }
    picker.appendChild(button);
  });
  $('mode-hint').textContent = MODES[state.mode].hint;
}

function renderHome() {
  const profile = state.profile;
  $('home-avatar').textContent = profile.emoji;
  $('home-greeting').textContent = profile.name;
  renderModePicker();

  const list = $('course-list');
  list.innerHTML = '';
  COURSES.forEach((course) => {
    const stats = courseStats(course, state.mode, profile.progress);
    const openCount = unlockedChunkCount(course, state.mode, profile.progress);
    const currentChunk = course.chunks[Math.min(openCount - 1, course.chunks.length - 1)];
    const pct = Math.round((stats.started / stats.total) * 100);

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
      <div class="badges">
        <span class="badge badge-due">${stats.due} to review</span>
        <span class="badge badge-new">${stats.fresh ? `${Math.min(stats.fresh, profile.settings.newPerSession)} new` : 'no new'}</span>
        <span class="badge">★ ${stats.mastered}</span>
      </div>
      <div class="hint">Now learning: <b>${currentChunk.label}</b> · set ${openCount} of ${course.chunks.length}</div>
    `;
    const start = document.createElement('button');
    start.type = 'button';
    start.className = 'btn btn-primary wide';
    const nothingToDo = stats.due === 0 && stats.fresh === 0;
    start.textContent = nothingToDo ? 'All caught up — practise anyway' : 'Start';
    start.addEventListener('click', () => startSession(course.id, nothingToDo));
    card.appendChild(start);
    list.appendChild(card);
  });

  show('screen-home');
}

// --- Session --------------------------------------------------------------

function startSession(courseId, practiceAnyway = false) {
  state.courseId = courseId;
  const course = getCourse(courseId);
  const { progress, settings } = state.profile;
  const built = buildSession(course, state.mode, progress, {
    newPerSession: settings.newPerSession,
    maxReviews: settings.maxReviews,
  });

  // "Practise anyway" ignores the schedule and drills whatever is unlocked.
  if (practiceAnyway && built.quiz.length === 0) {
    const open = course.chunks
      .slice(0, unlockedChunkCount(course, state.mode, progress))
      .flatMap((c) => c.items);
    built.quiz = open.sort(() => Math.random() - 0.5).slice(0, 20);
  }

  if (built.lesson.length === 0 && built.quiz.length === 0) {
    renderHome();
    return;
  }

  state.session = {
    lesson: built.lesson,
    lessonIndex: 0,
    queue: built.quiz,
    position: 0,
    answered: 0,
    total: built.quiz.length,
    results: new Map(), // kana -> true/false (first attempt)
    awaitingAcknowledge: false,
  };

  if (built.lesson.length) renderLesson();
  else startQuiz();
}

function renderLesson() {
  const session = state.session;
  const kana = session.lesson[session.lessonIndex];
  $('lesson-kana').textContent = kana;
  $('lesson-romaji').textContent = romajiFor(kana);
  $('lesson-counter').textContent = `${session.lessonIndex + 1}/${session.lesson.length}`;
  $('lesson-next').textContent = session.lessonIndex === session.lesson.length - 1 ? 'Start quiz' : 'Next';
  show('screen-lesson');
}

function advanceLesson() {
  const session = state.session;
  session.lessonIndex += 1;
  if (session.lessonIndex >= session.lesson.length) startQuiz();
  else renderLesson();
}

function startQuiz() {
  show('screen-quiz');
  renderQuestion();
  // Focusing inside the tap that got us here keeps the on-screen keyboard up.
  $('quiz-answer').focus();
}

function renderQuestion() {
  const session = state.session;
  if (session.position >= session.queue.length) {
    finishSession();
    return;
  }
  const kana = session.queue[session.position];
  $('quiz-kana').textContent = kana;
  $('quiz-feedback').textContent = '';
  $('quiz-feedback').className = 'feedback';
  $('quiz-card').className = 'quiz-card';
  $('quiz-answer').value = '';
  $('quiz-answer').disabled = false;
  $('quiz-submit').textContent = 'Check';
  $('quiz-dontknow').hidden = false;
  session.awaitingAcknowledge = false;

  const done = session.answered;
  $('quiz-counter').textContent = `${Math.min(done + 1, session.total)}/${session.total}`;
  $('quiz-progress').style.width = `${(done / Math.max(session.total, 1)) * 100}%`;
}

function submitAnswer() {
  const session = state.session;
  if (!session) return;

  // Second press of the button/Enter after a miss just moves on.
  if (session.awaitingAcknowledge) {
    nextQuestion();
    return;
  }

  const kana = session.queue[session.position];
  const typed = $('quiz-answer').value;
  if (!typed.trim()) return;

  const correct = checkRomaji(typed, kana);
  recordResult(kana, correct);

  if (correct) {
    $('quiz-card').className = 'quiz-card is-correct';
    $('quiz-feedback').className = 'feedback ok';
    $('quiz-feedback').textContent = `✓ ${romajiFor(kana)}`;
    $('quiz-answer').value = '';
    session.answered += 1;
    setTimeout(() => { session.position += 1; renderQuestion(); }, 500);
  } else {
    showMiss(kana);
  }
}

function showMiss(kana) {
  const session = state.session;
  $('quiz-card').className = 'quiz-card is-wrong';
  $('quiz-feedback').className = 'feedback bad';
  $('quiz-feedback').textContent = `${romajiFor(kana)}`;
  $('quiz-answer').value = '';
  $('quiz-submit').textContent = 'Got it';
  $('quiz-dontknow').hidden = true;
  session.answered += 1;
  session.awaitingAcknowledge = true;
  // Missed characters come back later in the same session.
  const reinsertAt = Math.min(session.position + 4, session.queue.length);
  session.queue.splice(reinsertAt, 0, kana);
}

function nextQuestion() {
  state.session.position += 1;
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
  const entries = [...session.results.entries()];
  const right = entries.filter(([, ok]) => ok).length;

  $('summary-score').textContent = entries.length
    ? `${right} of ${entries.length} right first time`
    : 'Nothing to review right now.';

  const list = $('summary-list');
  list.innerHTML = '';
  entries.forEach(([kana, ok]) => {
    const chip = document.createElement('div');
    chip.className = `chip ${ok ? 'chip-ok' : 'chip-bad'}`;
    chip.innerHTML = `<span class="chip-kana"></span><span class="chip-romaji"></span>`;
    chip.querySelector('.chip-kana').textContent = kana;
    chip.querySelector('.chip-romaji').textContent = romajiFor(kana);
    list.appendChild(chip);
  });

  state.session = null;
  store.saveProfile(state.profile);
  show('screen-summary');
}

// --- Settings, backup, transfer ------------------------------------------

function renderSettings() {
  const hasProfile = !!state.profile;
  document.querySelectorAll('.profile-only').forEach((el) => { el.hidden = !hasProfile; });
  if (hasProfile) {
    $('new-per-session').value = state.profile.settings.newPerSession;
    $('new-per-session-value').textContent = state.profile.settings.newPerSession;
  }
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

  $('quiz-form').addEventListener('submit', (event) => {
    event.preventDefault();
    submitAnswer();
  });

  $('quiz-dontknow').addEventListener('click', () => {
    const kana = state.session.queue[state.session.position];
    recordResult(kana, false);
    showMiss(kana);
  });

  $('new-per-session').addEventListener('input', (event) => {
    const value = Number(event.target.value);
    $('new-per-session-value').textContent = value;
    state.profile.settings.newPerSession = value;
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
      case 'go-home':
        if (state.profile) renderHome(); else renderProfiles();
        break;
      case 'quit-session': state.session = null; renderHome(); break;
      case 'again': startSession(state.courseId, true); break;
      case 'export': exportBackup(); break;
      case 'import': $('import-file').click(); break;
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

async function boot() {
  wire();
  store.requestPersistence();
  await renderProfiles();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline support is optional */ });
  }
}

boot();
