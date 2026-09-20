import fs from 'node:fs';
import { expandStory, line } from './helpers.mjs';

// Five complete L5 sessions, linked by the reader's existing series support.
// Prose-first manuscript and scene/continuity notes: kakure-tani-no-akari-draft.md.
// The JSON keeps this unusually long source manageable: each sentence retains
// hand-authored lookup boundaries and its own aligned English translation.
const chapters = JSON.parse(fs.readFileSync(new URL('./kakure-tani/chapters.json', import.meta.url), 'utf8'));
const entries = JSON.parse(fs.readFileSync(new URL('./kakure-tani/lexicon.json', import.meta.url), 'utf8'));
const definitions = {};
for (const [key, [form, gloss, pos, df, cf, link]] of Object.entries(entries)) {
  definitions[form] = [gloss, pos, {
    ...(df ? { df, cf } : {}),
    ...(link !== undefined ? { d: link } : {}),
  }];
}

const titles = [
  ['名前のない提灯', 'The Lantern with No Name'],
  ['霧の橋', 'The Bridge in the Mist'],
  ['夜を作る家', 'The House That Makes the Night'],
  ['水の向こうの名前', 'The Names Across the Water'],
  ['帰ってくる灯り', 'A Place for the Returning Light'],
];
const blurbs = [
  'At Obon in a mountain village in Nagano, Aoi repairs her grandmother’s old lantern—and a boy in a fox mask arrives to ask for help.',
  'Following a path into the mist, Aoi and Ren encounter a festival of borrowed memories and a bridge with no middle.',
  'Beyond a black river, a paper-maker guards a village’s fading stories and the bell that could open its way home.',
  'As the river rises and her memories fade, Aoi must trust that Ren will return—and find a way to mend the crossing.',
  'A cracked bell sounds across the water, an old promise finds its answer, and Aoi must decide what to carry home.',
];

export const STORY_SOURCES = chapters.map((body, index) => expandStory({
  id: `kakure-tani-no-akari-${index + 1}`,
  title: { ja: titles[index][0], en: titles[index][1] },
  level: 'L5',
  gram: 'G5',
  blurb: blurbs[index],
  nw: ['提灯', '灯籠', '和紙', 'お盆', '盆踊り', '帳面', '祠'],
  series: { id: 'kakure-tani-no-akari', part: index + 1, of: 5, name: '隠れ谷の灯り — The Lanterns of the Hidden Valley' },
  source: {
    kind: 'original',
    text: 'An original five-chapter adventure written for Kana Quest',
    by: 'GPT-6',
    credit: 'Written by',
    notes: 'Original Japanese prose and English translations for level 5. Set in a fictional mountain village in Nagano during Obon. Obon, bon odori, washi craft and lantern-floating provide the cultural setting; the village, song, characters and supernatural customs are invented, not a description of a traditional religious rite. Practices vary by region. Background: Japan National Tourism Organization, “Japan in August”, “Summer traditions in Japan” and “Kiso Valley”. No published story was adapted.',
    licence: 'Original to Kana Quest; Japanese text and English translations may be used and adapted with the app.',
  },
  lexicon: definitions,
  body: body.map((paragraph) => paragraph.map((sentence) => line(
    sentence.tokens.split('|').map((key) => entries[key]?.[0] || key).join('|'),
    sentence.en,
  ))),
}));
