import fs from 'node:fs';
import { expandStory, line } from './helpers.mjs';

// Five complete L4 sessions, linked by the reader's existing series support.
// Prose-first manuscript and scene/continuity notes: mittsu-no-kane-draft.md.
// The JSON keeps this long source manageable: each sentence retains its own
// hand-authored lookup boundaries and its own aligned English translation,
// and the five chapters share one lexicon because they share a cast.
const chapters = JSON.parse(fs.readFileSync(new URL('./mittsu-no-kane/chapters.json', import.meta.url), 'utf8'));
const entries = JSON.parse(fs.readFileSync(new URL('./mittsu-no-kane/lexicon.json', import.meta.url), 'utf8'));
const definitions = {};
for (const [key, [form, gloss, pos, df, cf, link]] of Object.entries(entries)) {
  definitions[form] = [gloss, pos, {
    ...(df ? { df, cf } : {}),
    ...(link !== undefined ? { d: link } : {}),
  }];
}

const titles = [
  ['えんぴつの字', 'The Pencil Marks'],
  ['ひばり丸', 'The Hibari-maru'],
  ['砂の道', 'The Sand Road'],
  ['四十年前の手紙', 'A Letter Forty Years Old'],
  ['鐘を鳴らす', 'Ringing the Bell'],
];
const blurbs = [
  'Riku arrives in a fishing town for the summer. A road of sand reaches the island at low tide — and the tide table on his aunt’s shop wall has been altered in pencil.',
  'A stranger is stranded on the island and nobody will go and fetch him. In the bag he left behind: one date, written over and over, and the name of a boat.',
  'Riku and Chika cross at dawn to bring him back. Under the bell they find a rope broken short, and a name scratched into the floor.',
  'The man on the island has carried a letter for forty years, addressed to nobody at all — and what it says turns the town’s account of that night inside out.',
  'Cut off by the storm with the bell as their only signal, Riku climbs the tower. Whoever hears it will learn what really happened forty years ago.',
];

export const STORY_SOURCES = chapters.map((body, index) => expandStory({
  id: `mittsu-no-kane-${index + 1}`,
  title: { ja: titles[index][0], en: titles[index][1] },
  level: 'L4',
  gram: 'G4',
  blurb: blurbs[index],
  nw: ['潮見表', '引き潮', 'やぐら', '鐘', '防波堤', '懐中電灯', '船小屋'],
  series: { id: 'mittsu-no-kane', part: index + 1, of: 5, name: '三つの鐘 — Three Bells' },
  source: {
    kind: 'original',
    text: 'An original five-chapter adventure written for Kanji Trail',
    by: 'Claude Opus 5',
    credit: 'Written by',
    illustrations: index === 0 ? 'Inline paintings generated with OpenAI image generation, using the chapter cover as a character and palette reference.' : undefined,
    notes: 'Original Japanese prose and English translations for level 4. A sand road that surfaces at low tide is a real landform — a tombolo — and several in Japan can be walked at the times a published tide table gives. Fog bells were genuinely used as navigational aids here: the first in Japan was installed at Shiriyazaki Lighthouse in 1877 and replaced two years later because a bell carried too poorly, and sound fog signals were later discontinued as ships’ own navigation improved. The town of Shiomi, the island, its bell and the custom of ringing it until every boat is home, the Hibari-maru and every character are invented; nothing here describes a real place or a real loss at sea. Background: Japan National Tourism Organization regional guides on tidal sand roads, and the Japanese Wikipedia article 霧信号所.',
    licence: 'Original to Kanji Trail; Japanese text and English translations may be used and adapted with the app.',
  },
  art: index === 0 ? { inline: [
    { after: 1, file: '01.webp' },
    { after: 3, file: '02.webp' },
    { after: 9, file: '03.webp' },
  ] } : undefined,
  lexicon: definitions,
  body: body.map((paragraph) => paragraph.map((sentence) => line(
    sentence.tokens.split('|').map((key) => entries[key]?.[0] || key).join('|'),
    sentence.en,
  ))),
}));
