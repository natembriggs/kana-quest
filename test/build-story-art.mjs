// Node-only build checks; runtime suites continue to use JavaScriptCore.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { resolveArt, webpDimensions } from '../tools/build_story_data.mjs';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kana-art-test-'));
try {
  const dir = path.join(root, 'fixture');
  await fs.mkdir(dir);
  const bytes = await fs.readFile(new URL('../assets/stories/kasa-jizou/01.webp', import.meta.url));
  await fs.writeFile(path.join(dir, 'scene.webp'), bytes);
  const story = { id: 'fixture', source: { illustrations: 'Test credit' }, body: [[], [], [], []], art: { inline: [{ after: 0, file: 'scene.webp' }] } };
  assert.deepEqual(webpDimensions(bytes), { width: 960, height: 560 });
  const art = (await resolveArt(story, root)).inline[0];
  assert.equal(art.width, 960); assert.equal(art.height, 560);
  assert.match(art.src, /^assets\/stories\/fixture\/scene.webp\?v=[a-f0-9]{16}$/);
  // Changing any source byte must invalidate the cached URL.
  const changed = Buffer.from(bytes); changed[changed.length - 1] ^= 1;
  await fs.writeFile(path.join(dir, 'scene.webp'), changed);
  assert.notEqual((await resolveArt(story, root)).inline[0].src, art.src);
  await assert.rejects(resolveArt({ ...story, source: {} }, root), /credit/);
  await assert.rejects(resolveArt({ ...story, art: { inline: [{ after: 0, file: '../scene.webp' }] } }, root), /local/);
  await assert.rejects(resolveArt({ ...story, art: { inline: [{ after: 9, file: 'scene.webp' }] } }, root), /does not exist/);
  await assert.rejects(resolveArt({ ...story, art: { inline: [story.art.inline[0], story.art.inline[0]] } }, root), /two inline/);
  // Fill a valid RIFF metadata chunk so this budget check does not depend
  // on how well the current illustration happens to compress.
  const atLimit = Buffer.alloc(150 * 1024);
  bytes.copy(atLimit);
  atLimit.write('JUNK', bytes.length);
  atLimit.writeUInt32LE(atLimit.length - bytes.length - 8, bytes.length + 4);
  atLimit.writeUInt32LE(atLimit.length - 8, 4);
  await fs.writeFile(path.join(dir, 'scene.webp'), atLimit);
  await assert.rejects(resolveArt({ ...story, art: { inline: [0, 1, 2, 3].map(after => ({ after, file: 'scene.webp' })) } }, root), /450 KiB/);
  const oversized = Buffer.concat([bytes, Buffer.alloc(160 * 1024)]);
  oversized.writeUInt32LE(oversized.length - 8, 4);
  await fs.writeFile(path.join(dir, 'scene.webp'), oversized);
  await assert.rejects(resolveArt(story, root), /150 KiB/);
  await fs.writeFile(path.join(dir, 'scene.webp'), 'not a webp');
  await assert.rejects(resolveArt(story, root), /invalid WebP/);
  assert.throws(() => webpDimensions(bytes.subarray(0, 22)), /invalid WebP/);
  // Synthetic extended headers exercise dimension and animation limits.
  const extended = Buffer.alloc(30);
  extended.write('RIFF'); extended.writeUInt32LE(22, 4); extended.write('WEBPVP8X', 8); extended.writeUInt32LE(10, 16);
  extended.writeUIntLE(1999, 24, 3); extended.writeUIntLE(559, 27, 3);
  await fs.writeFile(path.join(dir, 'scene.webp'), extended);
  await assert.rejects(resolveArt(story, root), /pixel budget/);
  extended[20] = 2;
  assert.throws(() => webpDimensions(extended), /animated/);
  await fs.writeFile(path.join(dir, 'scene.svg'), '<svg viewBox="0 0 600 350"><path fill="var(--art-sky)"/></svg>');
  const vector = await resolveArt({ ...story, art: { inline: [{ after: 0, file: 'scene.svg' }] } }, root);
  assert.match(vector.inline[0].svg, /var\(--art-sky\)/);
  console.log('PASS build story art — dimensions, budgets, credits, placements, cache versions and SVG compatibility');
} finally { await fs.rm(root, { recursive: true, force: true }); }
