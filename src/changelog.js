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
    date: '2026-09-02',
    changes: [
      'Fixed: finishing a writing session on a phone showed the "Session done" screen for an instant and then started a whole new session on its own, with nobody touching the screen. The tap on Next was being counted twice — once by the button, and once again a moment later by whatever button had appeared underneath your finger by then, which on that screen is the one that starts the next review.',
    ],
  },
  {
    date: '2026-09-01',
    changes: [
      'New: 10 new stories, two each for reading levels L1, L3, L4, L5 and L6 — the library now has two stories at every level instead of just L2. All ten are original Japanese retellings of well-known tales (The Giant Turnip, The North Wind and the Sun, Cinderella, The Three Little Pigs, Little Red Riding Hood, The Bremen Town Musicians, Aladdin, Pinocchio, Alice in Wonderland, and The Wizard of Oz), each fully glossed and furigana-linked the same way the original two stories are, with real katakana practice built into the higher levels.',
      'New: every story now says who wrote it, and how, right where you can see it — "Retold by ..." at the end of the story, not just in the library. The two original stories are now credited to Claude Opus 5.0; the ten new ones to Sol 5.6.',
      'New: the vocabulary list has grown from 3,867 words to 6,239, and now really does cover the common words. Words like 紹介 ("introduction") — about as everyday as Japanese gets — previously had no entry to study at all, because the list was built by filling per-topic quotas that ran out long before the common vocabulary did. Every word that is genuinely common in speech or in writing now has a proper entry, with meanings, readings, example sentences and the rest.',
      'New: vocabulary can now be worked through in either of two orders, chosen with the "By commonness" / "By topic" switch on the vocabulary screen. "By commonness" is the new default: every word ranked by how often it actually turns up — in conversation and in writing together — commonest first, in tiers from "Everyday essentials" through to "Rare words". "By topic" is the old GCSE and A-level grouping, unchanged. Both cover exactly the same words, and a word remembers what you know about it regardless of which order you met it in, so switching costs you nothing.',
      'Changed: a kanji\'s "Common words" were ranked almost entirely by how often they appear in newspapers, which isn\'t the same thing as how often they\'re actually used — 具体 ("concreteness") used to lead 具\'s list even though it\'s rarely used as a standalone word, ahead of everyday words like 具合 ("condition") and 道具 ("tool"). Words are now ranked by a blend of newspaper frequency and how often they show up in real conversation (spoken dialogue and translated example sentences), and each word shows a 🗣️ and/or 🖊️ badge for whether it\'s common in speech, in writing, or both — tap either for a quick explanation in a popup, tap anywhere else to dismiss it. A written-only word like 具体 still shows up, just no longer first.',
      'New: a vocabulary word\'s own page now ends with up to three real Japanese sentences using it — furigana over every kanji in the whole sentence, not just over the word, and an English translation of all of it. Knowing that 招待 means "invitation" is not the same as having seen it in a sentence, and one sentence is often the least representative thing about a word: ご招待をありがとうございます is perfectly correct and tells you nothing about 招待する, so the three are picked to differ from each other. Idioms and proverbs are kept out — 一寸の虫にも五分の魂 ("the worm turns") teaches nothing about any word in it — except for the handful of words barely used outside one saying, where the sentence is labelled as an idiom. About one word in six has none: those are mostly rare newspaper compounds (春闘, 特殊法人) that appear in no sentence in the collection these come from, and their pages simply show nothing rather than an empty heading.',
      'New: every word inside those example sentences is tappable, not just the word being studied — tap any one of them for its reading, what it means, the dictionary word it comes from when the sentence has bent it (聞いて → 聞く), its kanji, and its own page where this app teaches it. Particles included: tap と and it says "if · and · with · used for quoting" rather than picking one of the six for you.',
      'New: once you\'ve answered a kanji, vocabulary or kana question — right before Next — the word or character on screen is tappable again, opening its own page (stroke order, every reading, common words) without losing your place in the session. A kanji or vocab word\'s example word is tappable too, with its own kanji as chips and a one-tap Add if you don\'t study it yet. Writing mode gets the same treatment: the character and its example word, both hidden while you\'re still drawing so the answer can\'t leak, appear and become tappable the moment you finish. Never offered where it would hand over an answer you haven\'t been asked for yet — a vocabulary word with its reading or spelling still to come stays untappable until that\'s answered too.',
      'Fixed: tapping a noun-plus-する word in a story, like 約束しました ("promised"), opened its kanji but not its "Word details" page. 30 such words across the stories (説明する, 心配する, 練習する and the rest) now link to their noun\'s vocabulary entry the same way any other story word does.',
    ],
  },
  {
    date: '2026-08-31',
    changes: [
      'New: reading settings has a "Show romaji" toggle, off by default — most learners reading kanji stories have outgrown it, and a story\'s reveal ladder no longer offers a romaji step at all unless it\'s turned on.',
      'New: in a story, tapping a word whose furigana is already showing hides it — and remembers that, for the rest of this story and every one after, the same permanent "I know this one" the vocab quiz already offers. Previously a tap on such a word only offered romaji on top of a reading already on the page, with no way to turn the furigana itself off.',
      'Changed: tapping the English translation of a sentence now hides it again, the same way tapping the sentence itself shows it. Previously the only way to hide it again was finding your way back to the sentence\'s own closing punctuation.',
      'New: 4 more theme colours (Green, Indigo, Crimson, Sky) and 8 more badge emoji (🐱 🐶 🐼 🦄 🌈 🍉 🎨 🌟) in Settings — 10 colours and 20 badges to choose from now, up from 6 and 12.',
      'Fixed: coming back from a kanji\'s page dropped you at the top of the story instead of where you were reading. It now returns you to the exact spot.',
      'New: tap any empty space — the margins, the gap between paragraphs, below the last line — to clear the highlighted word and close the definition panel together.',
      'New: the word you last tapped stays gently highlighted, so you can see which word the definition panel is about, and find your place again at a glance after looking something up.',
      'New: your reading text size (and the furigana and translation settings next to it) are remembered — across stories, and next time you open the app. They stay on this device only, so two learners sharing a tablet don\'t change each other\'s.',
      'New: tapping a conjugated word in a story now explains the form. 行きました shows "went" — the meaning in the tense actually on the page — and then "polite past of 行く (to go)", so you get the word in front of you and the dictionary word it comes from, rather than being handed one and left to work out the other.',
      'New: every word in a story now has a definition, including the ones the app doesn\'t teach as vocabulary. Both stories were re-tokenised so that each tap lands on a whole word rather than a fragment — 住んでいました is one word now, not four pieces, and 本当に is no longer split into 本 / 当 / に — and every one of them, particles included, carries its meaning in that sentence.',
      'Fixed: in a story, a line could begin with 。 or 、. Japanese line-breaking rules (禁則処理) are now enforced: sentence punctuation, closing brackets, small kana and the long-vowel mark can never start a line, and an opening bracket can never end one.',
      'New: within a single story, a word stops showing its furigana from its fourth appearance onward. Momotarō prints 鬼 eight times; after three helpings of おに in the paragraphs just above, a fourth is not teaching anything — and it is still one tap away if you want it. This is about repetition on the page you are reading, so it does not count toward the separate "seen it on four separate occasions" rule that hides a word\'s furigana permanently, and "Always show furigana" in the reading settings still overrides it.',
      'Changed: stories are much stricter about what counts as "you\'ve seen this word" for the purpose of quietly hiding its furigana. Before, a word counted after sitting on screen for a couple of seconds — so text you scrolled straight past, or left open while you put the phone down, could silently cost you the furigana on words you never actually read. Now a word only counts once you\'ve scrolled past it, or when you tap the new "Finished reading!" button at the end of a story (which is also what brings up the end-of-story card). Jumping to the end and tapping it only credits the parts you actually had on screen.',
      'Fixed: several words in the two starter stories — including 洗濯 (laundry) — were words the app genuinely teaches but showed "not one of the words this app teaches" when tapped, because the story text simply hadn\'t been linked to them yet. About 20 words across both stories are now linked to their real entries.',
      'Fixed: in a story, once a word\'s furigana or romaji was showing, there was no way to tap it away again — tapping it just sat there or opened its definition. A tap now always shows or hides, cycling back to fully hidden once it\'s shown everything there is to show.',
      'Changed: tapping a word in a story now opens a panel at the bottom of the screen showing just that word, large, so there\'s no small button to find and aim for. The meaning stays hidden until you tap "Show definition" underneath it — so a tap just to check a word, or place-mark it, never gives the meaning away before you\'ve asked for it. "Translate this sentence" and the way through to that word\'s or kanji\'s own page appear once you\'ve asked.',
      'Fixed: the reading settings sheet\'s "Done" button did nothing.',
      'Changed: the reading settings\' text size slider now goes noticeably larger at its top setting.',
    ],
  },
  {
    date: '2026-08-30',
    changes: [
      'New: a "Read" card on the home screen opens graded stories — pick a reading level and just read, tapping any word once for its pronunciation and again for what it means, with a "translate this sentence" option and a way through to that word\'s or kanji\'s own page. Nothing here is tested or scored. Starts with two short stories at the "Getting going" level, rendered in whichever script you\'ve actually reached — all hiragana with spaces if you haven\'t started katakana, mixed kana once you have, and kanji (with furigana) once you start learning it. Furigana you\'ve seen enough times, in stories or in vocabulary quizzes, starts hiding itself here too — the same "seen it enough, no more free furigana" rule now applies across both.',
      'Fixed: an urgent bug introduced by yesterday\'s "My study history" update — in a vocabulary Meaning review, once you got the definition right and moved on to the reading, tapping the CORRECT reading did nothing at all, while tapping a wrong one worked normally. The same fault could freeze a kanji Yomi review. It only affected characters and words you had already reviewed before the study-history update shipped, which is why it looked like almost everything was broken. Nothing you did was lost — no progress was saved incorrectly, the answer simply never registered. Fixed, and covered by a test so it cannot come back.',
      'Fixed: a quiz answer button could break a word across two lines mid-syllable — a vocabulary reading like すいようじつ was splitting as "すいよ" / "うじつ". Answer buttons now size themselves to fit their own text on one line; when a row can\'t fit everything at that size, it holds fewer, wider buttons instead of squeezing text onto a second line. Short answers (a single kana, a short reading) are unaffected and still line up evenly across the row.',
      'New: a character or word\'s own page now has a "My study history" button — every time it was reviewed, and whether you passed or failed, as a scrollable list plus a small timeline graphic (a dot per review, green for a pass and red for a fail, placed on a real date axis). A same-day pass and fail both stay visible rather than landing on top of each other. Kanji Yomi (reading) reviews only start appearing here from this update onward — that mode didn\'t keep a dated record of individual attempts before now, so older Yomi history can\'t be shown retroactively.',
      'Vocabulary is clearer about what you\'re actually studying. A unit\'s course card now shows its GCSE-style topic group and, for a themed unit, whether it\'s "Common words 1" (the everyday layer) or "Common words 2" (a topic\'s rarer words, previously invisible unless you already knew to look in the "Common words 2" group) — before this, a unit and its Common words 2 sibling looked completely identical. The Vocabulary screen also now says up front that its topics follow the UK GCSE Japanese specification but its actual word lists don\'t come from an exam board (that\'s copyrighted) — full reasoning in Settings\' new "Vocabulary word lists" card.',
      'Fixed: a vocabulary word longer than one character could wrap mid-word in its set overview tile — お母さん was splitting across three lines as "お母" / "さ" / "ん". Vocabulary tiles now set the word top-to-bottom instead, the traditional direction for a short label in Japanese, so a word is always one unbroken column regardless of length. Kanji and kana tiles are unchanged.',
      'New: Vocabulary now has an "A level" group — 12 topics of its own (society, the economy, politics, media, the arts, the environment, and more) rather than harder versions of the GCSE topics, since that\'s genuinely how A-level Japanese differs from GCSE. "Writing and arguing" leads the group with essay connectives and abstract nouns (したがって, 客観的, 結論...) the way Core leads everything else.',
      'New: a quiz question now offers "Exit and save progress" right under the header, above the character itself — clear of the answer buttons and Next so it\'s never an accidental tap, but visible from the very first question. Tapping it shows the same tappable end-of-session summary a finished session would, instead of silently dropping back to the course screen. Nothing about how progress is saved has actually changed (every answer was already saved the moment it was graded); this just makes that visible.',
      'New: "Test unlearned" now offers a "‹ Look at the previous one" button once you\'re past the first question — answered a character too quickly and want another look before moving on? This opens its detail screen (stroke order, readings) and comes straight back to where you were, without touching your answer or re-testing it.',
      'Changed: getting a multiple-choice question wrong twice (or more) no longer highlights the correct option for you — you now have to find and tap it yourself before the question moves on, however many wrong options you\'ve already ruled out. Missing it still counts as a miss the same way it always did; this only changes what happens after.',
      'New: Vocabulary has a "From kanji pages" group — every primary-school kanji\'s own "Common words" list showed a couple of everyday words next to it, but most had no "Add" button because they didn\'t exist anywhere in the vocab curriculum to add TO. Now they do: about 2,700 words, in the order you\'d meet their kanji, split into units of 40. Purely bonus — nothing here is required, it just means tapping "Add" on a kanji page\'s word now actually works.',
      'Fixed: a word added from a kanji page\'s "Common words" list (or from its own detail page) wasn\'t obviously findable afterward — it doesn\'t show under "due" until it\'s actually been taught once, and it could belong to any of thirty-odd vocab units. The "Learn" button at the top of the Vocabulary and Kanji screens, on a unit\'s own card, and at the end of a session all now say "Learn N waiting" instead of "Learn N next"/"N new" whenever something you specifically added is sitting there ready — tap it and that\'s exactly what gets taught first. N is the real count of what\'s waiting (not the usual session size), so "Learn 2 waiting" really does mean 2, not a padded-out 5.',
    ],
  },
  {
    date: '2026-08-29',
    changes: [
      'Fixed: Vocabulary\'s "Test unlearned" quizzed words in the same order they\'re listed, which let numbers give themselves away — after answering 三 correctly you could guess 四 was next without knowing either reading. Vocabulary placement tests are now shuffled (kanji and kana were already immune to this, for their own reasons — see the code comments if curious).',
      'Fixed: Vocabulary was marking right answers wrong. Words with more than one meaning only ever carried their first dictionary sense, and どうして is the worst case — it was listed only as "how", when the meaning you actually want is "why". Every word now carries all of its meanings, and a question shows them together on one button: どうして reads "why, for what reason / how, in what way". Whichever translation your mind reaches for first, it\'s there — with the others beside it, so you learn what else the word covers. どちら now shows "which way / which one / who" instead of just the first of those.',
      'Fixed: two answer options could mean the same thing, which made the question unanswerable rather than hard — どう and どうして were both offered as "how" in the same set of four. No two options ever share a meaning now, in either direction.',
      'Meaning questions with longer English now lay their options out one per line instead of squeezing four into two columns.',
      'Fixed: in Vocabulary\'s Meaning mode, getting the definition right used to jump straight into the reading question on the very same tap — easy to miss what had just happened. It now pauses on the green "correct" card with a "Next: the reading →" button, and the reading question announces itself ("Now choose how it\'s read") once you tap through. Recall mode\'s word-to-spelling follow-up works the same way now too.',
      'New: a vocabulary word\'s own page now shows how it\'s actually pronounced, not just its letter-by-letter romaji spelling — こんにちは now clearly shows "konnichiwa", not just "konnichiha", the same hint already offered mid-quiz and on the lesson card.',
      'Words and kanji are now tappable almost everywhere you see them outside an actual question. Tap a word — in a kanji\'s "Common words" list, or the example word under a reading — and it opens up to show its own kanji as buttons, plus a link to its full page. Tap one of those kanji and you go straight to its page: stroke order, readings, the lot. The "Add" button on a word still adds it to your vocabulary list in one tap without opening anything.',
      'Back now steps back one screen at a time however deep you have wandered — kanji to a word to one of its kanji and onwards — instead of getting stuck bouncing between the last two.',
      'The example word on a lesson card is tappable the same way, and a vocabulary lesson now shows the word\'s kanji as buttons underneath it. Looking one up never disturbs the lesson: Back returns you to exactly where you were.',
      'Vocabulary words in an end-of-session summary now open their own page when tapped, the way kanji and kana already did.',
      'New: Vocabulary now has a Higher-tier tile for many of its themes too — rarer words on the same topic, e.g. a second "Me, my family and pets" alongside the everyday one. They\'re grouped together under their own "Common words 2" tab rather than mixed into the tile you already know, so a familiar unit never quietly grows bigger overnight.',
      'The Kanji and Vocabulary screens no longer bury their buttons under a wall of units. Units are now grouped — primary school, secondary school and names & places for kanji; Core plus the five themes for vocabulary — with the groups on one line and that group\'s own units on the line underneath, both swiping sideways. Review, Learn, Test unlearned and View set overview all fit on screen again without scrolling, and a dot on a group means reviews are waiting somewhere inside it.',
      'New: Vocabulary now has the same two buttons at the top of its screen that Kanji already had — review everything that\'s due, and learn the next few words — both spanning every unit at once rather than only whichever one you happen to be browsing.',
      'New: tapping a word in Vocabulary\'s set overview now opens its own detail screen — full reading, every English meaning, and its own kanji shown as chips you can tap through to that kanji\'s full page (stroke order, readings, common words) and back again. Each word also gets its own Meaning/Recall study toggle there, the same way kanji already had Definition/Yomi/Writing.',
      'New: Vocabulary\'s Recall mode. See the English, pick the Japanese word out of six — always written in kana, so recognising the kanji doesn\'t let you skip actually recalling the sound. Get it right and, if the word is spelled with a kanji you\'re already studying, a second question asks you to pick its kanji spelling out of six real-looking alternatives.',
      'Vocabulary: getting a word\'s reading right, without needing to peek at the furigana, now also counts toward that kanji\'s own Yomi progress — reading 空港 correctly as くうこう credits 空 with くう the same way answering it directly in Kanji would. Only the part you were actually being asked about counts; a kanji whose reading was already showing on screen isn\'t.',
      'Fixed: a single-kanji Vocabulary word (船, 水, and the like) could have its furigana hidden just from adding that WORD to a Vocabulary study list, even though the kanji itself had never been studied — the two were being tracked as if they were the same thing.',
      'Fixed: finishing a session with nothing missed always highlighted "Learn new", even when review was also overdue — "Review due" is now the highlighted choice whenever it applies, same as it already was on the home screen and course list.',
      'New: a kanji\'s "Common words" now offers an Add button on any word that\'s also part of Vocabulary\'s curriculum — one tap adds it to your vocab study list without leaving the kanji page.',
    ],
  },
  {
    date: '2026-08-28',
    changes: [
      'Vocabulary: words you\'ve seen a few times start hiding their own furigana, even before you\'ve added them to a kanji study list. Meet a reading four times across the words you\'re actually reading and the app takes the hint — nothing to turn on, nothing to answer. If it guessed wrong, revealing that word\'s furigana a couple of times puts it back the way it was.',
      'Fixed: Vocabulary\'s "pick the reading" question was giving itself away. When a word contains a kanji you already know, that kanji\'s reading is hidden and the rest is left showing — so 質問 appears as 質(しつ)問, asking only whether you know 問 reads もん. The six options ignored this and included readings like じつもん and ちもん, which the しつ on screen already rules out, leaving barely a choice at all. Every option now agrees with the part of the reading you can see, so the only way to pick the right one is to know the hidden kanji.',
      'Vocabulary: a word whose known kanji has too few believable alternative readings to build a real question from now hides all of its furigana rather than some — you can still tap to reveal it, exactly as before, and you get a full set of six options to choose between instead of two.',
      'New: Vocabulary. A fourth thing to practise alongside hiragana, katakana and kanji — whole words, grouped into a "Core" set of the basics plus themed units (family, school, travel, food and more). Meaning mode shows a word and four English options; tap the word itself to see its reading, tap again for romaji if you need it. If you get the meaning right without needing to peek at the reading, you\'ll then be asked to pick that reading out of six — this only tests you on words made of kanji you\'re already studying.',
      'The words themselves are drawn from real dictionary frequency data rather than any exam board\'s official list — see vocab-plan.md for why, and what "Common words 1/2" means as a result.',
      'Vocabulary: tapping a word for its romaji now also shows how it\'s actually said, in italics underneath, whenever that\'s different from the letter-by-letter spelling — long vowels get the line over the letter they\'re used to (とう is written "tou" but said "tō"), and a couple of greetings spelled with は are shown said with a "w" (こんばんは is "konbanha" to spell but "konbanwa" to say).',
      'The "Install this app" reminder no longer covers the Next button during a lesson, a test or review question, or the end-of-session screen — it now only shows where nothing at the bottom of the screen needs the room.',
      'The end-of-session screen now has a back button in the top corner too, and once there\'s truly nothing left to review or learn, "Back to menu" is the highlighted button instead of "Practise again".',
      'Fixed: on a small phone the details panel pushed the answer choices down behind the Next button, so you could no longer see which answer you had picked. Everything now fits on one screen without scrolling.',
      '"Full details" moved up alongside the readings instead of sitting on a line of its own, and the character\'s card is no longer taller than the character in it — the card turning green or red is the tick, so there is no longer a ✓ underneath taking up room.',
      'Fixed: coming back from "Full details" could leave the Next button needing three or four presses before it would move on.',
    ],
  },
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
