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
const ART_DIR = path.join(ROOT, 'assets', 'stories');
// stories-plan.md §8.8's budgets, enforced rather than trusted: art is the one
// part of a story whose cost is measured in bytes a phone has to fetch, and
// "keep it small" is not a rule unless something checks.
const MAX_INLINE_ART = 6;
const MAX_INLINE_BYTES = 8 * 1024;
const MAX_INLINE_TOTAL_BYTES = 60 * 1024;
const MAX_PAINTED_BYTES = 150 * 1024;
const MAX_PAINTED_TOTAL_BYTES = 450 * 1024;
const MAX_COVER_BYTES = 60 * 1024;
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

/** A saved reading position is a (paragraph, sentence) index, so the hash
 * that guards it (stories-plan.md §3.5) covers what can move a sentence: the
 * text, readings, glosses and translations. Not `d`: which curriculum entry
 * a word links to changes whenever the vocabulary list grows, and that must
 * no more cost a reader their place than adding a picture does. */
function contentHash(body) {
  const text = body.map((paragraph) => paragraph.map((sentence) => ({
    ...sentence,
    t: sentence.t.map(({ d, ...token }) => token),
  })));
  return crypto.createHash('sha256').update(JSON.stringify(text)).digest('hex').slice(0, 8);
}

function autoLink(token, lookup) {
  if (token.pos === 'punct') return token;
  // An author can suppress a misleading surface match (家/いえ must not
  // open the curriculum's 家/け entry). Keep this source-only sentinel out
  // of the runtime format; the story's own reading and gloss still work.
  if (token.d === false) return { ...token, d: null };
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
  if (story.series !== null && story.series !== undefined) {
    const { id, part, of, name } = story.series;
    if (!id || !name) errors.push(`${story.id}: series needs an id and a name`);
    if (!Number.isInteger(part) || part < 1) errors.push(`${story.id}: series part must be a positive integer`);
    if (!Number.isInteger(of) || of < 1) errors.push(`${story.id}: series "of" must be a positive integer`);
    if (Number.isInteger(part) && Number.isInteger(of) && part > of) {
      errors.push(`${story.id}: series part ${part} is beyond its stated length of ${of}`);
    }
  }
  if (!story.source?.text || !story.source?.by || !story.source?.credit || !story.source?.licence || !story.source?.notes) {
    errors.push(`${story.id}: source needs text, by, credit, notes and licence`);
  }
  if (!['Written by', 'Retold by', 'Adapted by', 'Translated by'].includes(story.source?.credit)) {
    errors.push(`${story.id}: unsupported source credit ${story.source?.credit}`);
  }
  // A model credit names the exact model, family version and variant both
  // ("GPT-6 Astra", "GPT-5.6 Sol", "Claude Opus 5"): variants of one version
  // write very differently, and a bare "GPT-6" hides which one it was.
  if (/^GPT-[\d.]+$/.test(story.source?.by ?? '') || /^(Sol|Luna|Astra)\b/.test(story.source?.by ?? '')) {
    errors.push(`${story.id}: source.by "${story.source.by}" must name the model as "GPT-<version> <variant>", e.g. "GPT-6 Astra"`);
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

/**
 * Series integrity, which can only be checked once every story is loaded:
 * within one series id, parts must be unique, must agree about the series'
 * name and length, and must all sit at the same level.
 *
 * The level rule is the one worth stating. A series is read straight through,
 * so a part that jumps a level mid-way is a cliff the learner meets with no
 * warning and no way back — and the library groups a series under one level,
 * which a straddling series would simply be missing from at the others.
 *
 * A GAP in the numbering is deliberately allowed: a part withdrawn or not yet
 * written should not fail the build, and nextInSeries (src/library.js) walks
 * the manifest rather than incrementing, so it steps over one cleanly.
 */
export function validateSeries(stories) {
  const errors = [];
  const groups = new Map();
  stories.forEach((story) => {
    if (!story.series) return;
    if (!groups.has(story.series.id)) groups.set(story.series.id, []);
    groups.get(story.series.id).push(story);
  });
  groups.forEach((parts, id) => {
    const seen = new Map();
    parts.forEach((story) => {
      if (seen.has(story.series.part)) {
        errors.push(`series ${id}: part ${story.series.part} is claimed by both ${seen.get(story.series.part)} and ${story.id}`);
      }
      seen.set(story.series.part, story.id);
    });
    const names = new Set(parts.map((story) => story.series.name));
    if (names.size > 1) errors.push(`series ${id}: disagrees about its name (${[...names].join(' / ')})`);
    const lengths = new Set(parts.map((story) => story.series.of));
    if (lengths.size > 1) errors.push(`series ${id}: disagrees about how many parts it has (${[...lengths].join(' / ')})`);
    const levels = new Set(parts.map((story) => story.level));
    if (levels.size > 1) errors.push(`series ${id}: spans levels ${[...levels].sort().join(' / ')}; every part must sit at the same level`);
    const of = parts[0].series.of;
    if (parts.length > of) errors.push(`series ${id}: has ${parts.length} parts but claims to be ${of} long`);
  });
  if (errors.length) throw new Error(errors.join('\n'));
}

/**
 * Checks a story's art against §8.8's budgets and returns what actually
 * exists on disk, so the manifest can say whether there is a cover without
 * the library having to probe for one.
 *
 * SVG stays embedded so its colours follow the theme. Painted WebP stays
 * separate and lazy-loaded, with actual pixel dimensions reserved up front.
 * Its content hash versions the URL so the worker can reuse it safely.
 *
 * Covers stay files: they are raster, they do not care about the theme, and
 * the library wants them fetched lazily one tile at a time.
 *
 * Art is addressed by PARAGRAPH INDEX from outside `body`, never stored
 * inside it. That is deliberate and load-bearing: `hash` is computed over
 * `body` (§3.5), so putting an illustration in there would change the hash of
 * every story that gained one and throw away the saved position of everyone
 * mid-way through it. Pictures must never cost a reader their place.
 */
export async function resolveArt(story, artRoot = ART_DIR) {
  const art = story.art || null;
  const dir = path.join(artRoot, story.id);
  const errors = [];
  let cover = false;
  try {
    const stat = await fs.stat(path.join(dir, 'cover.webp'));
    cover = true;
    if (stat.size > MAX_COVER_BYTES) {
      errors.push(`${story.id}: cover.webp is ${Math.round(stat.size / 1024)}KB, over the ${MAX_COVER_BYTES / 1024}KB budget`);
    }
  } catch {
    cover = false; // no cover yet — the generated placeholder carries it (§8.8)
  }
  const inline = [];
  if (art?.inline) {
    if (art.inline.length > MAX_INLINE_ART) {
      errors.push(`${story.id}: ${art.inline.length} inline pictures exceeds the limit of ${MAX_INLINE_ART}`);
    }
    let total = 0;
    let paintedTotal = 0;
    const seen = new Set();
    for (const item of art.inline) {
      if (!Number.isInteger(item.after) || item.after < 0 || item.after >= story.body.length) {
        errors.push(`${story.id}: inline picture after paragraph ${item.after}, which does not exist`);
        continue;
      }
      if (seen.has(item.after)) {
        errors.push(`${story.id}: two inline pictures after paragraph ${item.after}`);
      }
      seen.add(item.after);
      if (typeof item.file !== 'string' || !/^[a-zA-Z0-9_-]+\.(svg|webp)$/.test(item.file)) {
        errors.push(`${story.id}: inline art must name a local .svg or .webp file`);
        continue;
      }
      if (item.file.endsWith('.webp')) {
        try {
          const bytes = await fs.readFile(path.join(dir, item.file));
          const { width, height } = webpDimensions(bytes);
          if (width > 1920 || height > 1920 || width * height > 1920 * 1080) {
            throw new Error('inline painting exceeds the pixel budget');
          }
          if (bytes.length > MAX_PAINTED_BYTES) throw new Error('inline painting exceeds 150 KiB');
          paintedTotal += bytes.length;
          const version = crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 16);
          inline.push({ after: item.after, src: `assets/stories/${story.id}/${item.file}?v=${version}`, width, height });
        } catch (error) {
          errors.push(`${story.id}: ${item.file}: ${error.message}`);
        }
        continue;
      }
      let markup;
      try {
        markup = await fs.readFile(path.join(dir, item.file), 'utf8');
      } catch {
        errors.push(`${story.id}: inline picture ${item.file} is missing from assets/stories/${story.id}/`);
        continue;
      }
      total += Buffer.byteLength(markup);
      if (Buffer.byteLength(markup) > MAX_INLINE_BYTES) {
        errors.push(`${story.id}: ${item.file} is ${Math.round(Buffer.byteLength(markup) / 1024)}KB, over the ${MAX_INLINE_BYTES / 1024}KB budget`);
      }
      // These are inlined into the DOM, so the build is the right and only
      // place to refuse anything executable. Our own files, checked anyway:
      // the cost of the check is nothing and the cost of missing one is XSS.
      const unsafe = /<script|<foreignObject|\son\w+\s*=|javascript:/i.exec(markup);
      if (unsafe) {
        errors.push(`${story.id}: ${item.file} contains ${unsafe[0].trim()}, which is not allowed in inline art`);
      }
      if (!/^\s*<svg[\s>]/.test(markup)) {
        errors.push(`${story.id}: ${item.file} must be a bare <svg> element`);
      }
      inline.push({ after: item.after, svg: markup.trim() });
    }
    if (total > MAX_INLINE_TOTAL_BYTES) {
      errors.push(`${story.id}: ${Math.round(total / 1024)}KB of inline art exceeds the ${MAX_INLINE_TOTAL_BYTES / 1024}KB per-story budget`);
    }
    if (paintedTotal > MAX_PAINTED_TOTAL_BYTES) errors.push(`${story.id}: inline paintings exceed 450 KiB per story`);
    if (paintedTotal && !story.source?.illustrations) errors.push(`${story.id}: inline paintings need a source.illustrations credit`);
  }
  if (errors.length) throw new Error(errors.join('\n'));
  inline.sort((a, b) => a.after - b.after);
  return { cover, inline };
}

// Read the three WebP dimension headers without an image-library dependency.
// Reject animation: these are quiet, still illustrations beside reading text.
export function webpDimensions(bytes) {
  if (bytes.length < 20 || bytes.toString('ascii', 0, 4) !== 'RIFF'
      || bytes.toString('ascii', 8, 12) !== 'WEBP' || bytes.readUInt32LE(4) + 8 !== bytes.length) {
    throw new Error('invalid WebP file');
  }
  let size;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const kind = bytes.toString('ascii', offset, offset + 4);
    const length = bytes.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (start + length > bytes.length) throw new Error('truncated WebP chunk');
    if (kind === 'ANIM' || kind === 'ANMF') throw new Error('animated WebP is not allowed');
    if (kind === 'VP8X' && length >= 10) {
      if (bytes[start] & 2) throw new Error('animated WebP is not allowed');
      size = { width: bytes.readUIntLE(start + 4, 3) + 1, height: bytes.readUIntLE(start + 7, 3) + 1 };
    } else if (!size && kind === 'VP8 ' && length >= 10
        && bytes.toString('hex', start + 3, start + 6) === '9d012a') {
      size = { width: bytes.readUInt16LE(start + 6) & 0x3fff, height: bytes.readUInt16LE(start + 8) & 0x3fff };
    } else if (!size && kind === 'VP8L' && length >= 5 && bytes[start] === 0x2f) {
      const bits = bytes.readUInt32LE(start + 1);
      size = { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    offset = start + length + (length % 2);
  }
  if (!size?.width || !size?.height) throw new Error('missing WebP dimensions');
  return size;
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
      // Paragraph count, so the library can draw a progress bar without
      // fetching the body: a saved position is a paragraph index (§3.5), and
      // measuring progress in the same unit means the bar and the place the
      // reader resumes to cannot disagree.
      paras: story.body.length,
      // Whether a real cover exists on disk. False means the library paints
      // its generated placeholder instead (coverPlaceholder in library.js) —
      // which is what lets covers arrive one story at a time.
      cover: story.art.cover,
      source: { kind: story.source.kind, by: story.source.by, credit: story.source.credit },
    };
  });
  return `// Generated by tools/build_story_data.mjs. Small and always loaded:\n// the library can list every story without fetching the full bodies.\n\nexport const STORIES = ${JSON.stringify(manifest, null, 2)};\n`;
}

async function main() {
  const lookup = await vocabLookup();
  const ids = await vocabIds();
  const sources = await loadSourceStories();
  const coverSources = JSON.parse(await fs.readFile(path.join(ART_DIR, 'cover-sources.json'), 'utf8'));
  // Earlier hashes a position may have been saved against, for edits that
  // moved no sentence — see the file's own _about.
  const hashAliases = JSON.parse(await fs.readFile(path.join(SOURCE_DIR, 'hash-aliases.json'), 'utf8'));
  const existingIds = new Set();
  const report = { warnings: [], katakana: {} };
  const stories = [];
  for (const source of sources) {
    if (existingIds.has(source.id)) throw new Error(`duplicate story id ${source.id}`);
    existingIds.add(source.id);
    const body = source.body.map((paragraph) => paragraph.map((sentence) => ({
      ...sentence,
      t: sentence.t.map((token) => autoLink(token, lookup)),
    })));
    // `hash` covers `body` alone, and `art` is deliberately not part of it —
    // adding or changing a picture must not move anybody's saved place (§3.5).
    const hash = contentHash(body);
    const was = (hashAliases[source.id] || []).filter((old) => old !== hash);
    const story = { ...source, body, hash, ...(was.length ? { was } : {}) };
    const { warnings, katakana } = validateStory(story, ids);
    story.art = await resolveArt(story);
    if (story.art.cover) {
      if (!coverSources.covers[story.id] || !coverSources.credit) {
        throw new Error(`${story.id}: cover.webp needs a source and credit in cover-sources.json`);
      }
      story.source = { ...story.source, cover: coverSources.credit };
    }
    report.warnings.push(...warnings);
    report.katakana[story.id] = katakana;
    stories.push(story);
  }
  stories.sort((a, b) => a.level.localeCompare(b.level) || a.id.localeCompare(b.id));
  validateSeries(stories);
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
