#!/usr/bin/env node

// Expands the hand-tokenised sources in tools/story_src/ into the runtime
// story modules and their small, eagerly-loaded manifest. No morphological
// tokenizer is involved: the author controls every lookup unit and reading.

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_DIR = path.join(ROOT, 'tools', 'story_src');
const DATA_DIR = path.join(ROOT, 'src', 'data');
const KANJI_RE = /[㐀-䶿一-鿿]/;
// Deliberately excludes the prolonged-sound mark ー (U+30FC): it is shared
// with hiragana for casual elongation (よーい, "reeeady") and proves nothing
// about whether a word is actually katakana on its own — counting it here
// made a stray よーい in the L2 usagi-to-kame story register as "katakana"
// and fail the L1/L2 katakana budget below.
const KATAKANA_RE = /[ァ-ヺ]/;
// A whole katakana run: starts on a syllable, then takes ー and ・ freely.
// Mirrors reader.js's katakanaRuns, which is what actually decides where one
// hiragana ruby annotation begins and ends at reading time.
const KATAKANA_RUN_RE = /[ァ-ヺ][ァ-ヺー・]*/g;
const KANA_ONLY_RE = /^[ぁ-ゖァ-ヺー。、！？「」『』（）：・…\s]+$/;
const LEVELS = new Set(['L1', 'L2', 'L3', 'L4', 'L5', 'L6']);
const GRAMMAR = new Set(['G1', 'G2', 'G3', 'G4', 'G5', 'G6']);
const SENTENCE_LIMITS = {
  L1: [8, 15], L2: [15, 25], L3: [25, 40], L4: [40, 60], L5: [60, 120], L6: [60, Infinity],
};
const TOKEN_LIMITS = { L1: 8, L2: 12, L3: 16, L4: 22 };
// Below this there is no story to read, whatever the level says.
const MIN_SENTENCES = 6;
// How many DISTINCT katakana words a level may contain. Distinct words, not
// characters: シンデレラ fifteen times is one word to learn, and the old
// character count made a story's cost look fifteen times worse than it was.
//
// L1 is zero because the learner's first eight-to-fifteen sentences of
// Japanese have no room for a second script. From L2 up katakana is welcome —
// it is rendered with hiragana ruby until the learner has met its characters
// (stories-plan.md §5.6), so it costs a beginner a glance, not a wall — and
// the small L2 budget only keeps that first graded page from filling with
// ruby. Above L2 there is no ceiling and, deliberately, no floor: katakana
// practice is a property of the corpus, not a tax on every story. The old
// "L3+ needs 12 katakana characters" rule is why no Japanese folk tale could
// sit at L3.
const KATAKANA_BUDGET = { L1: 0, L2: 4 };

function parseExportedObject(source, name) {
  // Non-greedy up to the FIRST "\n});": a file with more than one export
  // (vocab-manifest.js has seven) would otherwise have an earlier
  // `export const NAME = {` swallow every export after it too, since `*`
  // is greedy and a plain `$` anchor only stops at the end of the whole
  // file. Every object here is written by json.dumps + "});" immediately
  // after its own closing brace, so the first match IS the real end.
  const match = source.match(new RegExp(`export const ${name} = (\\{[\\s\\S]*?\\n\\});`));
  if (!match) throw new Error(`could not parse ${name}`);
  return Function(`"use strict"; return (${match[1]});`)();
}

async function vocabLookup() {
  const source = await fs.readFile(path.join(DATA_DIR, 'vocab-lookup.js'), 'utf8');
  return parseExportedObject(source, 'VOCAB_LOOKUP');
}

/** Every real vocabulary item id (including a homograph's "surface|reading"
 * form, e.g. 市場|いちば) — what token.d actually links to at runtime (see
 * openReaderDetail/vocabCourseForId in app.js), unlike vocabLookup() above,
 * which is surface-keyed and used only for autoLink()'s best-guess fallback
 * when a token has no explicit `d`. Validating an explicit `d` against the
 * surface-only map instead of this one rejected every correctly-disambiguated
 * homograph link a story author wrote. */
async function vocabIds() {
  const source = await fs.readFile(path.join(DATA_DIR, 'vocab-manifest.js'), 'utf8');
  const units = parseExportedObject(source, 'VOCAB_UNITS');
  return new Set(Object.values(units).flat());
}

function contentHash(body) {
  return crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0, 8);
}

function autoLink(token, lookup) {
  if (token.pos === 'punct') return token;
  let d = token.d;
  if (!d && Object.prototype.hasOwnProperty.call(lookup, token.s)) d = token.s;
  if (!d && token.df && Object.prototype.hasOwnProperty.call(lookup, token.df)) d = token.df;
  // Noun+する verbs (約束する, 説明する, ...) deconjugate to a df that isn't
  // itself a vocab entry — only the bare noun is (約束, 説明). Fall back to
  // that noun so these link like any other vocab word instead of silently
  // going unlinked.
  if (!d && token.df && token.df.endsWith('する')) {
    const noun = token.df.slice(0, -2);
    if (noun && Object.prototype.hasOwnProperty.call(lookup, noun)) d = noun;
  }
  return { ...token, d: d || null };
}

function sentenceText(sentence) {
  return sentence.t.map((token) => token.s).join('');
}

/** Every distinct katakana word in a piece of text, as whole runs. */
function katakanaWords(text) {
  return (text.match(KATAKANA_RUN_RE) || []).map((run) => run.replace(/・$/, ''));
}

/**
 * Throws on anything that makes a story wrong; RETURNS anything that only
 * makes it unusual. The distinction matters because the gates below are
 * guidance about difficulty, not facts about correctness: a story two
 * sentences under its level's band is a fine story, and failing the build
 * over it only teaches an author to pad.
 */
export function validateStory(story, ids) {
  const errors = [];
  const warnings = [];
  const where = (p, s, message) => errors.push(`${story.id} p${p + 1}s${s + 1}: ${message}`);
  if (!story.id || !/^[a-z0-9-]+$/.test(story.id)) errors.push(`${story.id || '(missing id)'}: invalid id`);
  if (!LEVELS.has(story.level)) errors.push(`${story.id}: unknown level ${story.level}`);
  if (!GRAMMAR.has(story.gram)) errors.push(`${story.id}: unknown grammar tier ${story.gram}`);
  // A ceiling, not a target. An L4 story written in G2 grammar is an easy
  // read at a wide vocabulary, which is a perfectly good thing to be; only
  // grammar ABOVE the level's tier breaks the promise the level makes.
  if (story.level && story.gram && Number(story.gram.slice(1)) > Number(story.level.slice(1))) {
    errors.push(`${story.id}: ${story.gram} is above what ${story.level} allows`);
  }
  if (!story.title?.ja || !story.title?.en || !story.blurb) errors.push(`${story.id}: missing title or blurb`);
  if (!story.source?.text || !story.source?.by || !story.source?.credit || !story.source?.licence || !story.source?.notes) {
    errors.push(`${story.id}: source needs text, by, credit, notes and licence`);
  }
  if (!['Written by', 'Retold by', 'Adapted by', 'Translated by'].includes(story.source?.credit)) {
    errors.push(`${story.id}: unsupported source credit ${story.source?.credit}`);
  }
  const sentences = story.body?.flat() || [];
  const [minSentences, maxSentences] = SENTENCE_LIMITS[story.level] || [1, Infinity];
  // Over the maximum is an error — an L1 story of forty sentences is not an
  // L1 story. Under the minimum is only a warning, above an absolute floor
  // below which there is no story at all: a tight, complete tale that lands
  // two sentences short of its band is better than the two sentences of
  // padding the old hard error asked for.
  if (sentences.length > maxSentences) {
    errors.push(`${story.id}: ${sentences.length} sentences exceeds the ${story.level} maximum of ${maxSentences}`);
  } else if (sentences.length < MIN_SENTENCES) {
    errors.push(`${story.id}: ${sentences.length} sentences is too short to be a story`);
  } else if (sentences.length < minSentences) {
    warnings.push(`${story.id}: ${sentences.length} sentences is under the ${story.level} guide of ${minSentences}`);
  }
  const katakana = new Set(katakanaWords(story.title.ja));
  story.body?.forEach((paragraph, p) => paragraph.forEach((sentence, s) => {
    if (!sentence.en || !sentence.en.trim()) where(p, s, 'missing English translation');
    if (!Array.isArray(sentence.t) || sentence.t.length === 0) where(p, s, 'has no tokens');
    // Sentence-length guidance counts lexical lookup units. Particles remain
    // fully tappable and glossed, but do not make a simple sentence harder in
    // the same way another noun, adjective or verb does.
    const contentTokens = sentence.t.filter((token) => !['punct', 'part', 'aux'].includes(token.pos));
    const limit = TOKEN_LIMITS[story.level];
    if (limit && contentTokens.length > limit) {
      where(p, s, `${contentTokens.length} lookup tokens exceeds the ${story.level} guide of ${limit}`);
    }
    sentence.t.forEach((token, i) => {
      const label = `token ${i + 1} (${token.s})`;
      if (!token.s || !token.k || !token.pos) where(p, s, `${label} is missing s, k or pos`);
      if (!KANA_ONLY_RE.test(token.k)) where(p, s, `${label} has non-kana reading ${token.k}`);
      if (token.pos === 'punct') {
        if (token.g !== null) where(p, s, `${label} punctuation must have a null gloss`);
      } else if (!token.g || !token.g.trim()) {
        where(p, s, `${label} has no contextual gloss`);
      }
      const kanjiPositions = [...token.s].map((ch, index) => [ch, index])
        .filter(([ch]) => KANJI_RE.test(ch)).map(([, index]) => index);
      const rubyPositions = (token.ruby || []).map(([index]) => index);
      if (JSON.stringify(kanjiPositions) !== JSON.stringify(rubyPositions)) {
        where(p, s, `${label} ruby positions ${rubyPositions} do not cover kanji positions ${kanjiPositions}`);
      }
      if (!!token.df !== !!token.cf) where(p, s, `${label} must carry df and cf together`);
      if (token.d && !ids.has(token.d)) {
        where(p, s, `${label} links to missing vocabulary id ${token.d}`);
      }
      katakanaWords(token.s).forEach((word) => katakana.add(word));
    });
    if (!/[。！？]$/.test(sentenceText(sentence))) where(p, s, 'does not end in sentence punctuation');
  }));
  const budget = KATAKANA_BUDGET[story.level];
  if (budget !== undefined && katakana.size > budget) {
    errors.push(`${story.id}: ${story.level} allows ${budget} distinct katakana words, found ${katakana.size} (${[...katakana].join(', ')})`);
  }
  if (errors.length) throw new Error(errors.join('\n'));
  return { warnings, katakana: katakana.size };
}

async function loadSourceStories() {
  const files = (await fs.readdir(SOURCE_DIR))
    .filter((name) => name.endsWith('.mjs') && name !== 'helpers.mjs')
    .sort();
  const stories = [];
  for (const file of files) {
    const module = await import(`${pathToFileURL(path.join(SOURCE_DIR, file)).href}?t=${Date.now()}`);
    if (!Array.isArray(module.STORY_SOURCES)) throw new Error(`${file} must export STORY_SOURCES`);
    stories.push(...module.STORY_SOURCES);
  }
  return stories;
}

function runtimeModule(story) {
  return `// Generated by tools/build_story_data.mjs from tools/story_src/.\n// Hand-tokenised source: edit the source and regenerate; do not edit here.\n\nexport const STORY = ${JSON.stringify(story, null, 2)};\n`;
}

function manifestModule(stories) {
  const manifest = {};
  stories.forEach((story) => {
    manifest[story.id] = {
      title: story.title,
      series: story.series,
      level: story.level,
      gram: story.gram,
      blurb: story.blurb,
      hash: story.hash,
      length: story.body.flatMap((paragraph) => paragraph.flatMap((sentence) => sentence.t)).length,
      source: { kind: story.source.kind, by: story.source.by, credit: story.source.credit },
    };
  });
  return `// Generated by tools/build_story_data.mjs. Small and always loaded:\n// the library can list every story without fetching the full bodies.\n\nexport const STORIES = ${JSON.stringify(manifest, null, 2)};\n`;
}

async function main() {
  const lookup = await vocabLookup();
  const ids = await vocabIds();
  const sources = await loadSourceStories();
  const existingIds = new Set();
  const report = { warnings: [], katakana: {} };
  const stories = sources.map((source) => {
    if (existingIds.has(source.id)) throw new Error(`duplicate story id ${source.id}`);
    existingIds.add(source.id);
    const body = source.body.map((paragraph) => paragraph.map((sentence) => ({
      ...sentence,
      t: sentence.t.map((token) => autoLink(token, lookup)),
    })));
    const story = { ...source, body, hash: contentHash(body) };
    const { warnings, katakana } = validateStory(story, ids);
    report.warnings.push(...warnings);
    report.katakana[story.id] = katakana;
    return story;
  });
  stories.sort((a, b) => a.level.localeCompare(b.level) || a.id.localeCompare(b.id));
  // Every level needs SOMETHING in it — an empty rung on the ladder is worse
  // than a coarse one (stories-plan.md §11.1). It used to need exactly six,
  // which meant the corpus could only ever grow six stories at a time, in
  // lockstep across all six levels. That was never the intent.
  const levelCounts = Object.fromEntries([...LEVELS].map((level) => [level, 0]));
  stories.forEach((story) => { levelCounts[story.level] += 1; });
  Object.entries(levelCounts).forEach(([level, count]) => {
    if (count === 0) throw new Error(`${level} has no stories`);
  });
  await Promise.all(stories.map((story) => fs.writeFile(
    path.join(DATA_DIR, `story-${story.id}.js`), runtimeModule(story), 'utf8',
  )));
  await fs.writeFile(path.join(DATA_DIR, 'story-manifest.js'), manifestModule(stories), 'utf8');
  console.log(`built ${stories.length} stories (${stories.reduce((n, s) => n + s.body.flat().length, 0)} sentences)`);
  // Katakana practice is reported rather than enforced: the question worth
  // answering is whether a learner working through a LEVEL will meet katakana,
  // not whether every individual story carries its share of it.
  Object.entries(levelCounts).forEach(([level, count]) => {
    const atLevel = stories.filter((story) => story.level === level);
    const withKatakana = atLevel.filter((story) => report.katakana[story.id] > 0).length;
    const words = atLevel.reduce((n, story) => n + report.katakana[story.id], 0);
    console.log(`  ${level}: ${count} stories, ${withKatakana} with katakana, ${words} distinct katakana words`);
  });
  report.warnings.forEach((warning) => console.log(`  warning: ${warning}`));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
