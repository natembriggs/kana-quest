import fs from 'node:fs';
import { expandStory, line } from './helpers.mjs';

// Prose-first manuscript and scene continuity: akai-note-draft.md.
// Each chapter is one complete Level 4 reading session.
const chapters = JSON.parse(fs.readFileSync(new URL('./akai-note/chapters.json', import.meta.url), 'utf8'));
const entries = JSON.parse(fs.readFileSync(new URL('./akai-note/lexicon.json', import.meta.url), 'utf8'));
const definitions = {};
for (const [key, [form, gloss, pos, df, cf, link]] of Object.entries(entries)) {
  const sense = key.includes('#') ? `#${key.split('#')[1]}` : '';
  definitions[`${form}${sense}`] = [gloss, pos, {
    ...(df ? { df, cf } : {}),
    ...(link !== undefined ? { d: link } : {}),
  }];
}

const titles = [
  ['明日のページ', "Tomorrow's Page"],
  ['橋の向こう', 'Beyond the Bridge'],
  ['古い道', 'The Old Road'],
  ['一人足りない', 'One Missing'],
  ['まだ書かれていない朝', 'The Unwritten Morning'],
];
const blurbs = [
  'A red notebook appears in the library returns box. Its first warning names the bus Ren will take tomorrow.',
  'A small prediction comes true. Mika helps close a cracked bridge, but the words on the page change.',
  'The bus is already on the old mountain road. A line in the notebook points to a bend above the river.',
  'The bus stops before the landslide, but one child is missing. A red bag is found below the road.',
  'The notebook points beneath the town and gives Mika eight minutes to find the other end of the tunnel.',
];

export const STORY_SOURCES = chapters.map((body, index) => expandStory({
  id: `akai-nooto-${index + 1}`,
  title: { ja: titles[index][0], en: titles[index][1] },
  level: 'L4',
  gram: 'G4',
  blurb: blurbs[index],
  nw: ['図書館', '遠足', '橋', 'ひび', '地図', '消防', '出口'],
  series: { id: 'akai-nooto', part: index + 1, of: 5, name: '赤いノート — The Red Notebook' },
  source: {
    kind: 'original',
    text: 'An original five-chapter suspense story written for Kanji Trail',
    by: 'GPT-6 Astra',
    credit: 'Written by',
    notes: 'Original Japanese prose and English translations for Level 4. The town, people, notebook and events are invented. No published text was adapted.',
    licence: 'Original to Kanji Trail; Japanese text and English translations may be used and adapted with the app.',
  },
  lexicon: definitions,
  body: body.map((paragraph) => paragraph.map((sentence) => line(
    sentence.tokens.split('|').map((key) => {
      const sense = key.includes('#') ? `#${key.split('#')[1]}` : '';
      return `${entries[key]?.[0] || key.split('#')[0]}${sense}`;
    }).join('|'),
    sentence.en,
  ))),
}));
