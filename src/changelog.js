// Plain-language, user-facing record of what changed and when — shown in
// Settings under "App version" (see renderChangelog() in app.js). Hand-
// maintained: whenever APP_VERSION (app.js) is bumped for something a
// learner or parent would actually notice, prepend a new entry here in the
// SAME commit. Purely internal changes (refactors, test-only fixes, data
// regenerations with no visible behavior change) don't need one.
//
// Most recent first. CHANGELOG[0] is always "what's new" in Settings;
// everything else sits behind "Show previous updates". `date` is when the
// entry's changes shipped — not tied to one specific lettered build (a
// single day's version, e.g. '2026-08-23c', often bundles several).
export const CHANGELOG = [
  {
    date: '2026-08-27',
    changes: [
      'Fixed: in a test or review, tapping anywhere on the screen used to count as pressing Next, so a stray tap skipped straight past the answer. Only the Next button moves on now.',
      'The meaning/reading panel that appears once a kanji question is answered now has a "Full details" button — it opens the whole character page (stroke order, every reading, common words) without ending the session, and its back button says "Back to test".',
      'The answer choices now sit just above the Next button instead of leaving a long gap between them, and the panel with the kanji\'s details appears directly under the character it describes.',
      'On a computer, the Enter key now presses Next — in lessons, tests and reviews — so a session can be worked through with the mouse in one hand and the keyboard in the other.',
      'Fixed: starting a Yomi test after a Definition test squeezed the readings into two columns instead of using the full width of the screen.',
      'A learner who has never turned on sync now sees a reminder on their home screen that their progress lives on this device only, with a one-tap way to turn sync on.',
      'Turning on sync now tells you right away to save the code somewhere safe, since it\'s the only way to get progress back if this device is ever lost.',
      'Added a Share code button next to the sync code in Settings, on devices that support it — sends the code straight to Messages, Notes, email, or wherever you\'d like, instead of needing to retype it.',
      'A synced backup that\'s never touched again now lasts 5 years before it\'s deleted, up from 1 — long enough for a real break from practising. Settings now says so plainly, next to the code.',
      'Tapping "Turn on sync" from the home screen reminder now turns sync on right away and jumps straight to it in Settings, instead of just opening Settings and leaving you to find the button again.',
      'Fixed: that jump could land with the code and Copy code hidden behind the Settings header, and the confirmation message wrongly said Share code was "below" it.',
      'Turning sync off and back on now reuses the same code instead of generating a new one — so an accidental toggle, or a device paired with another one, doesn\'t end up cut loose from its backup.',
    ],
  },
  {
    date: '2026-08-26',
    changes: [
      'Fixed: in Writing mode, ぢ and づ now show as "dji" and "dzu" instead of "ji" and "zu" — those matched じ and ず exactly before, so there was no way to tell which character to draw.',
      'Writing mode now catches a stroke that starts and ends in the right place but is drawn straight through a curve, or curved the wrong way — it used to slip through as correct.',
    ],
  },
  {
    date: '2026-08-24',
    changes: [
      'Added Sync across devices, under Settings — pair another phone or tablet with a code and keep a learner\'s progress the same on both. No account needed; turn it on, or enter a code from another device, to get started.',
      'Once sync is on it now runs by itself — when you open a learner, when you finish a session, and when you leave or come back to the app. "Sync now" is still there, but you shouldn\'t need it.',
      'Fixed: quitting a session early (the ✕ button) now sends what was already answered to sync, instead of only sending it once a session is finished.',
      'Fixed: opening Settings could silently fail to show sync status for a learner who had never synced.',
      'Fixed: the app no longer occasionally reloads itself right after being installed for the very first time.',
      'Your badge now travels between synced devices, and you can change it any time under Settings — Badge.',
      'Added this changelog — see what changed and when, right here in Settings.',
      'Added a theme colour picker in Settings — pick your favourite accent colour for buttons, progress bars and highlights.',
    ],
  },
  {
    date: '2026-08-23',
    changes: [
      'Right and wrong answers now wait for you to tap Next instead of jumping to the next question automatically.',
      'A missed question no longer repeats right away in the same session — instead, you can choose to practise everything you missed once you finish.',
      'Practising what you missed now shows your improved overall result afterward, not just the practice round on its own.',
      'Kana placement tests mix up the order within each group, so you can\'t just guess from having memorized the alphabet order.',
      'Screens now transition smoothly instead of jumping; the back button and title stay visible while scrolling; buttons stay reachable at the bottom of the screen.',
      'The progress bar is bigger and easier to see; the exit button next to it is quieter.',
      '"Add N more" is now called "Learn N new".',
    ],
  },
  {
    date: '2026-08-22',
    changes: [
      'Fixed accidental text-highlighting, and a palm resting on the screen no longer interrupts drawing on an iPad.',
      'Kanji placement tests now go in the order you\'d learn them, instead of shuffled, so you can see exactly where your knowledge runs out.',
      'Fixed: opening a kanji\'s details from certain review sessions sometimes did nothing.',
      'Fixed: the progress counter could count a missed question as done before it was actually resolved.',
      '"Learn next" and "Review due" now always pick up where you left off, no matter which grade is selected below.',
    ],
  },
  {
    date: '2026-08-21',
    changes: [
      'Added "Review all due" and "Learn next" buttons at the top of the kanji screen.',
      'Added about 900 more kanji used in names and places, beyond the school curriculum — organized into new picker rows (Primary school, Secondary school, Names & places).',
      'Placement tests no longer repeat what you got wrong right away — you can go back and study those afterward instead.',
      'Fixed: combined kana like きゃ couldn\'t be practiced in Writing mode — they\'re now skipped there (still quizzed normally in Reading mode).',
      'The kanji detail screen now shows which grade a kanji belongs to, even when opened from a mixed review session.',
      'Reading labels now show which part is okurigana, e.g. まじ(わる).',
    ],
  },
  {
    date: '2026-08-20',
    changes: [
      'Added "Test unlearned" — a placement test that quickly finds out what you already know, for both kana and kanji.',
      'Added a reminder banner, on phones not using the installed app, to add it to the home screen so progress saves reliably.',
      'Writing practice: added Undo in Free mode; disabled accidental double-tap zooming throughout the app.',
      'Fixed: quitting a placement test partway through no longer marks the whole set as "in progress."',
      'Fixed two kanji whose reading data was slightly wrong.',
      'Added a way to clear the kanji search box; fixed a back-button glitch.',
    ],
  },
];
