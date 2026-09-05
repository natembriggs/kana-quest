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
// and fail the L1/L2 zero-katakana rule below.
const KATAKANA_RE = /[ァ-ヺ]/;
const KANA_ONLY_RE = /^[ぁ-ゖァ-ヺー。、！？「」『』（）：・…\s]+$/;
const LEVELS = new Set(['L1', 'L2', 'L3', 'L4', 'L5', 'L6']);
const GRAMMAR = new Set(['G1', 'G2', 'G3', 'G4', 'G5', 'G6']);
const SENTENCE_LIMITS = {
  L1: [8, 15], L2: [15, 25], L3: [25, 40], L4: [40, 60], L5: [60, 120], L6: [60, Infinity],
};
const TOKEN_LIMITS = { L1: 8, L2: 12, L3: 16, L4: 22 };

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

export function validateStory(story, ids) {
  const errors = [];
  const where = (p, s, message) => errors.push(`${story.id} p${p + 1}s${s + 1}: ${message}`);
  if (!story.id || !/^[a-z0-9-]+$/.test(story.id)) errors.push(`${story.id || '(missing id)'}: invalid id`);
  if (!LEVELS.has(story.level)) errors.push(`${story.id}: unknown level ${story.level}`);
  if (!GRAMMAR.has(story.gram)) errors.push(`${story.id}: unknown grammar tier ${story.gram}`);
  if (story.level && story.gram && story.level.slice(1) !== story.gram.slice(1)) {
    errors.push(`${story.id}: ${story.level} must use matching ${`G${story.level.slice(1)}`}`);
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
  if (sentences.length < minSentences || sentences.length > maxSentences) {
    errors.push(`${story.id}: ${sentences.length} sentences falls outside ${minSentences}–${maxSentences}`);
  }
  let katakana = [...story.title.ja].filter((ch) => KATAKANA_RE.test(ch)).length;
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
      katakana += [...token.s].filter((ch) => KATAKANA_RE.test(ch)).length;
    });
    if (!/[。！？]$/.test(sentenceText(sentence))) where(p, s, 'does not end in sentence punctuation');
  }));
  if ((story.level === 'L1' || story.level === 'L2') && katakana > 0) {
    errors.push(`${story.id}: ${story.level} contains ${katakana} katakana characters`);
  }
  if (['L3', 'L4', 'L5', 'L6'].includes(story.level) && katakana < 12) {
    errors.push(`${story.id}: higher-level story needs more katakana practice (found ${katakana}, need at least 12)`);
  }
  if (errors.length) throw new Error(errors.join('\n'));
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
  const stories = sources.map((source) => {
    if (existingIds.has(source.id)) throw new Error(`duplicate story id ${source.id}`);
    existingIds.add(source.id);
    const body = source.body.map((paragraph) => paragraph.map((sentence) => ({
      ...sentence,
      t: sentence.t.map((token) => autoLink(token, lookup)),
    })));
    const story = { ...source, body, hash: contentHash(body) };
    validateStory(story, ids);
    return story;
  });
  stories.sort((a, b) => a.level.localeCompare(b.level) || a.id.localeCompare(b.id));
  const levelCounts = Object.fromEntries([...LEVELS].map((level) => [level, 0]));
  stories.forEach((story) => { levelCounts[story.level] += 1; });
  Object.entries(levelCounts).forEach(([level, count]) => {
    if (count !== 5) throw new Error(`${level} must contain exactly five stories; found ${count}`);
  });
  await Promise.all(stories.map((story) => fs.writeFile(
    path.join(DATA_DIR, `story-${story.id}.js`), runtimeModule(story), 'utf8',
  )));
  await fs.writeFile(path.join(DATA_DIR, 'story-manifest.js'), manifestModule(stories), 'utf8');
  console.log(`built ${stories.length} stories (${stories.reduce((n, s) => n + s.body.flat().length, 0)} sentences)`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
