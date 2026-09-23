import fs from 'node:fs';
import { expandStory, line } from './helpers.mjs';

// Five complete L5 sessions, linked by the reader's existing series support.
// Prose-first manuscript and scene/continuity notes: saigo-no-otehon-draft.md.
// The JSON keeps this long source manageable: each sentence retains its own
// hand-authored lookup boundaries and its own aligned English translation,
// and the five chapters share one lexicon because they share a cast.
const chapters = JSON.parse(fs.readFileSync(new URL('./saigo-no-otehon/chapters.json', import.meta.url), 'utf8'));
const entries = JSON.parse(fs.readFileSync(new URL('./saigo-no-otehon/lexicon.json', import.meta.url), 'utf8'));
const definitions = {};
for (const [key, [form, gloss, pos, df, cf, link]] of Object.entries(entries)) {
  definitions[form] = [gloss, pos, {
    ...(df ? { df, cf } : {}),
    ...(link !== undefined ? { d: link } : {}),
  }];
}

const titles = [
  ['休みの札', 'The "Closed" Sign'],
  ['黒い傘の男', 'The Man with the Black Umbrella'],
  ['峠の茶屋', 'The Teahouse on the Pass'],
  ['三つの字', 'Three Characters'],
  ['八つ目の引き出し', 'The Eighth Drawer'],
];
const blurbs = [
  'Clearing out her late grandfather’s calligraphy school, Mio finds a letter hidden behind the “Closed Today” sign: the first clue in a trail of kanji he left across town. Someone else is already following it.',
  'Someone got into the school without breaking the lock. A child’s practice sheet, a wish on a shrine tablet, and a stranger who drops a key that should not exist.',
  'The next character points up the mountain. An old man will hand over the box only if Mio brings “the other one” — and then a storm traps everyone at the top of the pass.',
  'Waiting out the storm, Mio learns why someone left home twenty years ago, and three sheets of paper point to a drawer nobody knew was there.',
  'A night race to reach a desk before it leaves for market, a drawer that opens only for someone who remembers her first lesson, and the last thing her grandfather wrote.',
];

export const STORY_SOURCES = chapters.map((body, index) => expandStory({
  id: `saigo-no-otehon-${index + 1}`,
  title: { ja: titles[index][0], en: titles[index][1] },
  level: 'L5',
  gram: 'G5',
  blurb: blurbs[index],
  nw: ['書道', '半紙', '硯', '絵馬', '峠', '茶屋', '引き出し'],
  series: { id: 'saigo-no-otehon', part: index + 1, of: 5, name: '最後のお手本 — The Last Lesson' },
  source: {
    kind: 'original',
    text: 'An original five-chapter mystery written for Kanji Trail',
    by: 'Claude Opus 5.5',
    credit: 'Written by',
    notes: 'Original Japanese prose and English translations for level 5. The trail is built from real character structure: 休 is 人 beside 木, 明 is 日 beside 月, 天 is 一 over 大, and 峠 is a character made in Japan from 山, 上 and 下. Reading 親 as 立 + 木 + 見, “a parent standing on a tree, watching”, is a popular folk explanation rather than the character’s actual etymology; the story presents it as something the grandfather taught. 永字八法, the teaching that 永 contains the eight basic strokes, is a standard first lesson in calligraphy. Tenmangū shrines enshrine Sugawara no Michizane as a deity of learning and calligraphy, votive ema tablets carry written wishes, and kakizome is the year’s first calligraphy in early January. The canal town of Funaki, Meigetsudō, the shrine, the teahouse, the Takagi typeface and every character are invented.',
    licence: 'Original to Kanji Trail; Japanese text and English translations may be used and adapted with the app.',
  },
  lexicon: definitions,
  body: body.map((paragraph) => paragraph.map((sentence) => line(
    sentence.tokens.split('|').map((key) => entries[key]?.[0] || key).join('|'),
    sentence.en,
  ))),
}));
