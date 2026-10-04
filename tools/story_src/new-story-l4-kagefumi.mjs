import fs from 'node:fs';
import { expandStory, line } from './helpers.mjs';

// Five complete L4 sessions, linked by the reader's series support.
// Prose-first manuscript, scene map and the rules of the magic:
// kagefumi-draft.md. Each chapter is one normal Level 4 reading session.
const chapters = JSON.parse(fs.readFileSync(new URL('./kagefumi/chapters.json', import.meta.url), 'utf8'));
const entries = JSON.parse(fs.readFileSync(new URL('./kagefumi/lexicon.json', import.meta.url), 'utf8'));
const definitions = {};
for (const [key, [form, gloss, pos, df, cf, link]] of Object.entries(entries)) {
  const sense = key.includes('#') ? `#${key.split('#')[1]}` : '';
  definitions[`${form}${sense}`] = [gloss, pos, {
    ...(df ? { df, cf } : {}),
    ...(link !== undefined ? { d: link } : {}),
  }];
}

const titles = [
  ['石段の影ふみ', 'Shadow Tag on the Steps'],
  ['影のない朝', 'A Morning Without a Shadow'],
  ['麦わら帽子', 'The Straw Hat'],
  ['柱のしるし', 'Marks on the Pillar'],
  ['三回目の夕日', 'The Third Sunset'],
];
const blurbs = [
  'Grandma’s old photo has one shadow too many. That evening, a boy in a straw hat joins Haru and Sora’s game on the shrine steps — and runs off with Sora’s shadow.',
  'Sora has no shadow, and people are starting to forget him. Grandma remembers the rest of the old saying: by the third sunset, nobody will remember him at all.',
  'The boy has waited sixty years for a shadow of his own, and he will not give Sora’s back. But when he runs, he leaves his hat behind.',
  'A name inside a straw hat, a pillar marked with two children’s heights, and a shadow in an old photo that has lost its hat overnight.',
  'One sunset left, and a sky full of cloud. Haru climbs the steps with the photo, the hat and her grandmother.',
];

export const STORY_SOURCES = chapters.map((body, index) => expandStory({
  id: `kagefumi-${index + 1}`,
  title: { ja: titles[index][0], en: titles[index][1] },
  level: 'L4',
  gram: 'G4',
  blurb: blurbs[index],
  nw: ['影', '影ふみ', '石段', '夕日', '足元', '麦わら帽子', '柱'],
  series: { id: 'kagefumi', part: index + 1, of: 5, name: '影ふみ — Shadow Tag' },
  source: {
    kind: 'original',
    text: 'An original five-chapter fantasy written for Kanji Trail',
    by: 'Claude Opus 5.5',
    credit: 'Written by',
    notes: 'Original Japanese prose and English translations for Level 4. 影ふみ (shadow tag) is a real Japanese children’s game in which you win by stepping on another player’s shadow, and marking children’s heights on a wooden pillar each year is a familiar Japanese household custom. The saying about sunset, the magic, the town and every character are invented; no published text was adapted.',
    licence: 'Original to Kanji Trail; Japanese text and English translations may be used and adapted with the app.',
    ...(index === 0 ? {
      illustrations: "Three inline paintings for Kanji Trail use the approved Kasa Jizō inline treatment. Haru and Sora's chapter cover guides their identity and palette; the existing first painting is reused for continuity, and the two new paintings were generated with OpenAI built-in image generation.",
    } : index === 1 ? {
      illustrations: "Three inline paintings for Kanji Trail use the approved Kasa Jizō inline treatment. The chapter cover guides Haru and Sora's identity and palette, the prior chapter image guides the straw-hat boy, the existing first painting is reused, and the two new paintings were generated with OpenAI built-in image generation.",
    } : index === 2 ? {
      illustrations: "Three inline paintings generated with OpenAI built-in image generation for Kanji Trail, using the approved Kasa Jizō inline treatment. The chapter cover guides Haru's character identity and palette only; the existing first painting is reused for continuity, and two new paintings accompany paragraphs 2 and 6.",
    } : index === 3 ? {
      illustrations: "Three inline paintings for Kanji Trail use the approved Kasa Jizō inline treatment. The chapter cover and existing first painting guide Haru’s character identity and palette; the existing 01.webp is reused, and two new paintings accompany paragraphs 0 and 8.",
    } : index === 4 ? {
      illustrations: "Three inline paintings for Kanji Trail use the approved Kasa Jizō inline treatment. The chapter cover and existing 01.webp guide Haru and Sora’s identity and palette; the existing 01.webp is reused, and two new paintings accompany paragraphs 1 and 5.",
    } : {}),
  },
  ...(index === 0 ? { art: { inline: [{ after: 0, file: '02.webp' }, { after: 5, file: '01.webp' }, { after: 7, file: '03.webp' }] } } : index === 1 ? { art: { inline: [{ after: 0, file: '01.webp' }, { after: 4, file: '02.webp' }, { after: 8, file: '03.webp' }] } } : index === 2 ? { art: { inline: [{ after: 2, file: '02.webp' }, { after: 4, file: '01.webp' }, { after: 6, file: '03.webp' }] } } : index === 3 ? { art: { inline: [{ after: 0, file: '02.webp' }, { after: 5, file: '01.webp' }, { after: 8, file: '03.webp' }] } } : index === 4 ? { art: { inline: [{ after: 1, file: '02.webp' }, { after: 5, file: '03.webp' }, { after: 7, file: '01.webp' }] } } : {}),
  lexicon: definitions,
  body: body.map((paragraph) => paragraph.map((sentence) => line(
    sentence.tokens.split('|').map((key) => {
      const sense = key.includes('#') ? `#${key.split('#')[1]}` : '';
      return `${entries[key]?.[0] || key.split('#')[0]}${sense}`;
    }).join('|'),
    sentence.en,
  ))),
}));
