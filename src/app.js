// Screen routing, session flow and event wiring.

import { COURSES, romajiFor, buildChoices } from './kana.js';
import { KANJI_COURSES, kanjiInfo, buildReadingChoices } from './kanji.js';
import {
  MODES, itemKey, grade, buildSession, courseStats,
  currentSetIndex, readyForMore, newRecord,
} from './srs.js';
import * as store from './store.js';

const ALL_COURSES = [...COURSES, ...KANJI_COURSES];
function getAnyCourse(courseId) {
  return ALL_COURSES.find((c) => c.id === courseId);
}

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
  // Kanji only has a reading mode built so far (see kanji.js); once writing
  // mode exists for kanji this filter goes away.
  const visibleCourses = ALL_COURSES.filter((c) => c.kind !== 'kanji' || state.mode === 'recognition');
  visibleCourses.forEach((course) => {
    const stats = courseStats(course, state.mode, profile.progress);
    const setIndex = currentSetIndex(course, state.mode, profile.progress);
    const currentChunk = course.chunks[setIndex];
    const pct = Math.round((stats.started / stats.total) * 100);
    const newCount = Math.min(stats.fresh, profile.settings.newPerSession);
    const settled = readyForMore(course, state.mode, profile.progress);

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
      <div class="hint">Current set: <b>${currentChunk.label}</b> · ${setIndex + 1} of ${course.chunks.length} · ★ ${stats.mastered} mastered</div>
    `;

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
  });

  show('screen-home');
}

// --- Session --------------------------------------------------------------

function startSession(courseId, kind) {
  state.courseId = courseId;
  state.kind = kind;
  const course = getAnyCourse(courseId);
  const { progress, settings } = state.profile;
  const built = buildSession(course, state.mode, progress, kind, {
    newPerSession: settings.newPerSession,
    maxReviews: settings.maxReviews,
  });

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
  const item = session.lesson[session.lessonIndex];
  const course = getAnyCourse(state.courseId);

  $('lesson-kana').textContent = item;
  $('lesson-counter').textContent = `${session.lessonIndex + 1}/${session.lesson.length}`;
  $('lesson-next').textContent = session.lessonIndex === session.lesson.length - 1 ? 'Start quiz' : 'Next';

  if (course.kind === 'kanji') {
    const info = kanjiInfo(course, item);
    $('lesson-romaji').hidden = true;
    $('lesson-readings').hidden = false;
    $('lesson-readings').textContent = [...info.on, ...info.kun].join(' · ');
    $('lesson-meanings').hidden = false;
    $('lesson-meanings').textContent = info.meanings.join(', ');
    $('lesson-hint').textContent = 'The quiz asks you to pick out these readings — no need to remember every one yet.';
  } else {
    $('lesson-romaji').hidden = false;
    $('lesson-romaji').textContent = romajiFor(item);
    $('lesson-readings').hidden = true;
    $('lesson-meanings').hidden = true;
    $('lesson-hint').textContent = "Say it out loud, then remember it — it's coming up in the quiz.";
  }

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
}

function renderQuestion() {
  const session = state.session;
  if (session.position >= session.queue.length) {
    finishSession();
    return;
  }
  const item = session.queue[session.position];
  const course = getAnyCourse(state.courseId);

  $('quiz-kana').textContent = item;
  $('quiz-feedback').textContent = '';
  $('quiz-feedback').className = 'feedback';
  $('quiz-card').className = 'quiz-card';
  $('quiz-info').hidden = true;
  session.awaitingAcknowledge = false;
  session.locked = false;

  const choices = $('quiz-choices');
  choices.innerHTML = '';

  if (course.kind === 'kanji') renderKanjiChoices(course, item);
  else renderKanaChoices(course, item);

  const done = session.answered;
  $('quiz-counter').textContent = `${Math.min(done + 1, session.total)}/${session.total}`;
  $('quiz-progress').style.width = `${(done / Math.max(session.total, 1)) * 100}%`;
}

// --- Kana: tap once, grades instantly ---------------------------------

function renderKanaChoices(course, kana) {
  state.session.attempt = 0;
  $('quiz-ok').hidden = true;
  const choices = $('quiz-choices');
  buildChoices(course, kana).forEach((romaji) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'choice';
    button.textContent = romaji;
    button.dataset.romaji = romaji;
    button.addEventListener('click', () => chooseAnswer(romaji, button));
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
function chooseAnswer(romaji, button) {
  const session = state.session;
  // Taps during the pause after a resolved question are handled by acknowledge().
  if (!session || session.locked || session.awaitingAcknowledge || button.disabled) return;

  const kana = session.queue[session.position];
  const answer = romajiFor(kana);
  const correct = romaji === answer;
  session.attempt += 1;

  if (session.attempt === 1) {
    session.answered += 1;
    recordResult(kana, correct);
  }

  if (correct) {
    button.classList.add('is-right');
    $('quiz-card').className = 'quiz-card is-correct';
    $('quiz-feedback').className = 'feedback ok';
    $('quiz-feedback').textContent = '✓';
    session.locked = true;
    session.pendingAdvance = setTimeout(nextQuestion, 550);
    return;
  }

  button.classList.add('is-wrong');
  button.disabled = true;

  if (session.attempt === 1) {
    // Missed characters come back later in the same session regardless of
    // what happens on the second try.
    const reinsertAt = Math.min(session.position + 4, session.queue.length);
    session.queue.splice(reinsertAt, 0, kana);
    $('quiz-card').className = 'quiz-card is-wrong';
    $('quiz-feedback').className = 'feedback bad';
    $('quiz-feedback').textContent = 'Try once more';
    return; // still their turn — no lock, no reveal yet
  }

  // Second miss: out of chances, reveal the answer and move on.
  revealKanaAnswer(answer);
  $('quiz-card').className = 'quiz-card is-wrong';
  $('quiz-feedback').className = 'feedback bad';
  $('quiz-feedback').textContent = answer;
  session.locked = true;
  session.awaitingAcknowledge = true; // wait for a tap, but don't stall forever
  session.pendingAdvance = setTimeout(nextQuestion, 2600);
}

function revealKanaAnswer(answer) {
  $('quiz-choices').querySelectorAll('.choice').forEach((el) => {
    if (el.dataset.romaji === answer) el.classList.add('is-right');
  });
}

// --- Kanji: tick every reading that applies, then press OK -------------

function renderKanjiChoices(course, kanji) {
  const session = state.session;
  const { options, correct } = buildReadingChoices(course, kanji);
  session.selected = new Set();
  session.currentCorrect = correct;
  session.graded = false;
  session.kanjiAttempt = 0;

  $('quiz-ok').hidden = false;
  $('quiz-ok').disabled = false;
  $('quiz-ok').textContent = 'OK';

  const choices = $('quiz-choices');
  options.forEach((reading) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'choice';
    button.textContent = reading;
    button.dataset.reading = reading;
    button.addEventListener('click', () => toggleReading(reading, button));
    choices.appendChild(button);
  });
}

function toggleReading(reading, button) {
  const session = state.session;
  if (!session || session.graded || button.disabled) return;
  if (session.selected.has(reading)) {
    session.selected.delete(reading);
    button.classList.remove('is-selected');
  } else {
    session.selected.add(reading);
    button.classList.add('is-selected');
  }
}

/**
 * Graded on OK. A wrong first attempt gets one more try: options picked
 * wrongly turn red, lock, and clear themselves, but which options were
 * actually correct is not revealed yet, and options not yet tried (right or
 * wrong) stay available. As with kana, the pass/fail record is always
 * locked to the first attempt regardless of the second attempt's outcome.
 */
function submitKanjiAnswer() {
  const session = state.session;
  if (!session || session.graded) return;

  const kanji = session.queue[session.position];
  const course = getAnyCourse(state.courseId);
  const correctSet = session.currentCorrect;
  const selected = session.selected;
  const isExactMatch = selected.size === correctSet.size
    && [...selected].every((r) => correctSet.has(r));
  session.kanjiAttempt += 1;

  if (session.kanjiAttempt === 1) {
    session.answered += 1;
    recordResult(kanji, isExactMatch);
  }

  if (!isExactMatch && session.kanjiAttempt === 1) {
    $('quiz-choices').querySelectorAll('.choice').forEach((button) => {
      const reading = button.dataset.reading;
      if (selected.has(reading) && !correctSet.has(reading)) {
        // Wrong pick: flash red, then free it up for a different guess.
        button.classList.remove('is-selected');
        button.classList.add('is-wrong');
        button.disabled = true;
        selected.delete(reading);
      }
      // Correct picks stay ticked; untried options (right or wrong) stay
      // available — nothing here reveals which options are correct.
    });
    $('quiz-card').className = 'quiz-card is-wrong';
    $('quiz-feedback').className = 'feedback bad';
    $('quiz-feedback').textContent = 'Not quite — try once more';
    // Missed kanji come back later in the same session regardless of what
    // happens on the second try.
    const reinsertAt = Math.min(session.position + 4, session.queue.length);
    session.queue.splice(reinsertAt, 0, kanji);
    return; // still their turn — OK stays "OK", nothing is final yet
  }

  // Final: either correct, or out of chances. Reveal everything.
  session.graded = true;
  $('quiz-choices').querySelectorAll('.choice').forEach((button) => {
    const reading = button.dataset.reading;
    button.classList.remove('is-selected');
    button.disabled = true;
    if (correctSet.has(reading) && selected.has(reading)) button.classList.add('is-right');
    else if (correctSet.has(reading)) button.classList.add('is-missed'); // should have been ticked
    else if (selected.has(reading)) button.classList.add('is-wrong');
  });

  $('quiz-card').className = `quiz-card ${isExactMatch ? 'is-correct' : 'is-wrong'}`;
  $('quiz-feedback').className = `feedback ${isExactMatch ? 'ok' : 'bad'}`;
  const hits = [...selected].filter((r) => correctSet.has(r)).length;
  $('quiz-feedback').textContent = isExactMatch ? '✓' : `${hits} of ${correctSet.size} correct`;
  showKanjiInfo(course, kanji);
  $('quiz-ok').textContent = 'Next';
}

function showKanjiInfo(course, kanji) {
  const info = kanjiInfo(course, kanji);
  $('quiz-meanings').textContent = info.meanings.join(', ');
  const word = info.words[0];
  const wordEl = $('quiz-word');
  wordEl.innerHTML = '';
  if (word) {
    wordEl.innerHTML = '<span class="word-kanji"></span><span class="word-kana"></span><span class="word-en"></span>';
    wordEl.querySelector('.word-kanji').textContent = word.kanji;
    wordEl.querySelector('.word-kana').textContent = `(${word.kana})`;
    wordEl.querySelector('.word-en').textContent = word.en;
  }
  $('quiz-info').hidden = false;
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
    const chip = document.createElement('div');
    chip.className = `chip ${ok ? 'chip-ok' : 'chip-bad'}`;
    chip.innerHTML = `<span class="chip-kana"></span><span class="chip-romaji"></span>`;
    chip.querySelector('.chip-kana').textContent = item;
    chip.querySelector('.chip-romaji').textContent = course.kind === 'kanji'
      ? (kanjiInfo(course, item).quizReadings[0] || '')
      : romajiFor(item);
    list.appendChild(chip);
  });

  // Offer the same two choices as the home screen, so carrying on with more
  // new characters does not mean navigating back out first.
  const stats = courseStats(course, state.mode, state.profile.progress);
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

  // Taps on choice buttons bubble up to here; chooseAnswer ignores them while
  // an answer is revealed, so the two handlers never both act on one tap.
  $('screen-quiz').addEventListener('click', acknowledge);

  // Kanji only: OK grades the ticked readings; once graded, the same button
  // (now reading "Next") advances.
  $('quiz-ok').addEventListener('click', () => {
    const session = state.session;
    if (!session) return;
    if (session.graded) nextQuestion();
    else submitKanjiAnswer();
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
      case 'quit-session':
        if (state.session) clearTimeout(state.session.pendingAdvance);
        state.session = null;
        renderHome();
        break;
      case 'again': startSession(state.courseId, 'practice'); break;
      case 'learn-more': startSession(state.courseId, 'new'); break;
      case 'review-more': startSession(state.courseId, 'review'); break;
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
