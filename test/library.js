// Unit tests for src/library.js — how stories group into series, how far
// through one a learner is, and what comes next. Run from the repo root:
//   /System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m test/library.js

import {
  storyReadState, storyProgress, groupStoriesForLevel, seriesStanding, nextInSeries, storyLabel,
  shelfReadState, sortShelf, shelfCounts, filterShelf, coverPlaceholder,
} from '../src/library.js';

let failures = 0;
function check(name, condition, detail) {
  if (condition) { print(`ok    ${name}`); return; }
  failures += 1;
  print(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
}

const story = (level, over = {}) => ({
  title: { ja: 'たいとる', en: 'Title' }, blurb: 'b', level, length: 120, paras: 10,
  series: null, source: { by: 'X', credit: 'Retold by' }, ...over,
});
const part = (level, id, n, of, name = 'The Long Tale') => story(level, {
  series: { id, part: n, of, name },
});

const MANIFEST = {
  alone: story('L2'),
  'saga-1': part('L2', 'saga', 1, 3),
  'saga-2': part('L2', 'saga', 2, 3),
  'saga-3': part('L2', 'saga', 3, 3),
  'other-level': story('L3'),
  'one-parter': story('L2', { series: { id: 'solo', part: 1, of: 1, name: 'A Whole Book' } }),
};

// --- storyReadState: the order of the checks is the whole point -------------

check('a story never opened is unread',
  storyReadState('alone', { read: {}, pos: {} }) === 'unread');

// Opening a story writes a `read` entry straight away (touchStoryOpened), so
// a `read` entry on its own must NOT count as started — otherwise every story
// ever tapped would read as in-progress forever.
check('opened but with no saved position is still unread, not "reading"',
  storyReadState('alone', { read: { alone: { first: 1, last: 1, done: null, passes: 0 } }, pos: {} }) === 'unread',
  'a read entry alone must not imply progress');

check('a saved position means reading',
  storyReadState('alone', { read: { alone: { done: null } }, pos: { alone: { p: 2 } } }) === 'reading');

check('a done stamp means read, even with a saved position still sitting there',
  storyReadState('alone', { read: { alone: { done: 99, passes: 1 } }, pos: { alone: { p: 2 } } }) === 'read');

check('a missing stories object does not throw',
  storyReadState('alone', undefined) === 'unread');

// A bookmark alone is also "started" — and a tombstone (p: -1, written when
// a bookmark is cleared) is not a bookmark and must not resurrect a finished
// story as in progress.
check('a bookmark on its own counts as reading',
  storyReadState('alone', { read: {}, pos: {}, mark: { alone: { p: 3, s: 1 } } }) === 'reading');
check('a cleared bookmark tombstone does not',
  storyReadState('alone', { read: {}, pos: {}, mark: { alone: { p: -1, s: -1 } } }) === 'unread');

// --- storyProgress ---------------------------------------------------------

const midway = { read: { alone: { done: null } }, pos: { alone: { p: 5 } } };
check('progress is paragraphs read over paragraphs total',
  storyProgress('alone', midway, MANIFEST.alone) === 0.5,
  String(storyProgress('alone', midway, MANIFEST.alone)));
check('an unread story has no progress to report',
  storyProgress('alone', { read: {}, pos: {} }, MANIFEST.alone) === null);
check('a finished story has no progress bar either',
  storyProgress('alone', { read: { alone: { done: 1 } }, pos: { alone: { p: 5 } } }, MANIFEST.alone) === null);
check('a manifest entry with no paragraph count yields null rather than NaN',
  storyProgress('alone', midway, { ...MANIFEST.alone, paras: undefined }) === null);
check('a position past the end clamps to 1 rather than overflowing the bar',
  storyProgress('alone', { read: { alone: { done: null } }, pos: { alone: { p: 99 } } }, MANIFEST.alone) === 1);

// --- groupStoriesForLevel --------------------------------------------------

const l2 = groupStoriesForLevel(MANIFEST, 'L2');
check('a series collapses into ONE entry, however many parts it has',
  l2.filter((g) => g.kind === 'series').length === 1, JSON.stringify(l2.map((g) => g.kind)));
check('and that entry carries every part',
  l2.find((g) => g.kind === 'series').parts.length === 3);
check('standalone stories stay their own entries',
  l2.filter((g) => g.kind === 'story').map((g) => g.id).sort().join() === 'alone,one-parter');
check('stories at another level are not listed',
  !JSON.stringify(l2).includes('other-level'));

const shuffled = {
  'saga-3': MANIFEST['saga-3'], 'saga-1': MANIFEST['saga-1'], 'saga-2': MANIFEST['saga-2'],
};
check('parts are ordered by their part number, whatever order the manifest holds them in',
  groupStoriesForLevel(shuffled, 'L2')[0].parts.map((p) => p.id).join() === 'saga-1,saga-2,saga-3');

// A series takes the shelf position of its first part, so promoting a
// standalone story to part 1 does not make it jump around the library.
check('a series sits where its first part sat',
  l2[1].kind === 'series', JSON.stringify(l2.map((g) => g.id)));

check('an empty level groups to nothing rather than throwing',
  groupStoriesForLevel(MANIFEST, 'L6').length === 0);

// --- seriesStanding --------------------------------------------------------

const group = l2.find((g) => g.kind === 'series');
const fresh = { read: {}, pos: {} };
check('a fresh series is at 0 read and offers part 1',
  seriesStanding(group, fresh).done === 0 && seriesStanding(group, fresh).current.id === 'saga-1');

const oneDone = { read: { 'saga-1': { done: 5 } }, pos: {} };
check('one chapter finished moves the offer to chapter 2',
  seriesStanding(group, oneDone).done === 1 && seriesStanding(group, oneDone).current.id === 'saga-2');

// Reading ahead out of order is allowed (§8.2 locks nothing), and the offer
// should still be the earliest chapter NOT finished, not the one after the
// latest one touched.
const skipped = { read: { 'saga-3': { done: 5 } }, pos: {} };
check('finishing a later chapter first still offers the earliest unfinished one',
  seriesStanding(group, skipped).current.id === 'saga-1'
  && seriesStanding(group, skipped).done === 1);

const allDone = { read: { 'saga-1': { done: 1 }, 'saga-2': { done: 2 }, 'saga-3': { done: 3 } }, pos: {} };
check('a fully read series has nothing left to continue into',
  seriesStanding(group, allDone).current === null && seriesStanding(group, allDone).done === 3);

// --- nextInSeries ----------------------------------------------------------

check('the next part follows', nextInSeries(MANIFEST, 'saga-1') === 'saga-2');
check('the last part has no next', nextInSeries(MANIFEST, 'saga-3') === null);
check('a standalone story has no next', nextInSeries(MANIFEST, 'alone') === null);
check('an unknown id has no next, and does not throw', nextInSeries(MANIFEST, 'nope') === null);

// A withdrawn or not-yet-written part leaves a gap. Walking the manifest
// steps over it; incrementing `part` would offer a story that does not exist.
const gappy = { 'g-1': part('L2', 'g', 1, 4), 'g-2': part('L2', 'g', 2, 4), 'g-4': part('L2', 'g', 4, 4) };
check('a gap in the numbering is stepped over, not walked into',
  nextInSeries(gappy, 'g-2') === 'g-4', String(nextInSeries(gappy, 'g-2')));

// --- storyLabel ------------------------------------------------------------

check('a real chapter is captioned with its series and number',
  storyLabel(MANIFEST['saga-2']) === 'The Long Tale · 2/3', storyLabel(MANIFEST['saga-2']));
check('a standalone story is captioned with its own title',
  storyLabel(MANIFEST.alone) === 'たいとる');
// Two shipped stories tag the work they adapt while being one complete part
// of it; "Chapter 1 of 1" would be noise about a second chapter that is not
// coming.
check('a one-part "series" is captioned as standalone, not "1/1"',
  storyLabel(MANIFEST['one-parter']) === 'たいとる', storyLabel(MANIFEST['one-parter']));

// --- shelfReadState: a series is read only when every part is --------------

const seriesGroup = groupStoriesForLevel(MANIFEST, 'L2').find((g) => g.kind === 'series');

check('an untouched series is unread',
  shelfReadState(seriesGroup, { read: {}, pos: {} }) === 'unread');
// The case that matters: one chapter down out of six is emphatically not
// "unread", and a learner filtering for what they have not started should not
// be shown it.
check('one chapter finished makes the whole series "reading", not unread',
  shelfReadState(seriesGroup, { read: { 'saga-1': { done: 1 } }, pos: {} }) === 'reading');
check('a chapter merely in progress also makes the series "reading"',
  shelfReadState(seriesGroup, { read: {}, pos: { 'saga-2': { p: 1 } } }) === 'reading');
check('only every chapter finished makes a series "read"',
  shelfReadState(seriesGroup, {
    read: { 'saga-1': { done: 1 }, 'saga-2': { done: 2 }, 'saga-3': { done: 3 } }, pos: {},
  }) === 'read');
check('a standalone story reports its own state',
  shelfReadState({ kind: 'story', id: 'alone', entry: MANIFEST.alone }, { read: { alone: { done: 1 } }, pos: {} }) === 'read');

// --- sortShelf: in progress, then unread shortest-first, then finished -----

const shelfManifest = {
  long: story('L4', { length: 900 }),
  short: story('L4', { length: 100 }),
  middling: story('L4', { length: 400 }),
  done: story('L4', { length: 50 }),
  mid: story('L4', { length: 800 }),
};
const shelfStories = { read: { done: { done: 1 } }, pos: { mid: { p: 2 } } };
const sorted = sortShelf(groupStoriesForLevel(shelfManifest, 'L4'), shelfStories).map((g) => g.id);
check('what you are part-way through comes first',
  sorted[0] === 'mid', sorted.join());
// Cheapest-to-try first: choosing is the hard part, and the opposite order
// asks a learner to commit before they know the level suits them.
check('then the unread, shortest first',
  sorted.slice(1, 4).join() === 'short,middling,long', sorted.join());
check('and what you have finished goes last',
  sorted[4] === 'done', sorted.join());

// --- shelfCounts and filterShelf -------------------------------------------

const counts = shelfCounts(groupStoriesForLevel(shelfManifest, 'L4'), shelfStories);
check('the counts add up to everything on the shelf',
  counts.all === 5 && counts.unread === 3 && counts.reading === 1 && counts.read === 1,
  JSON.stringify(counts));
check('"all" filters nothing out',
  filterShelf(groupStoriesForLevel(shelfManifest, 'L4'), 'all', shelfStories).length === 5);
check('filtering to unread leaves only the unread',
  filterShelf(groupStoriesForLevel(shelfManifest, 'L4'), 'unread', shelfStories)
    .map((g) => g.id).sort().join() === 'long,middling,short');
check('a filter that matches nothing returns nothing rather than everything',
  filterShelf(groupStoriesForLevel(MANIFEST, 'L2'), 'read', { read: {}, pos: {} }).length === 0);

// --- coverPlaceholder ------------------------------------------------------

const tile = coverPlaceholder('ari-to-hato', MANIFEST.alone);
check('a placeholder carries the title\'s first character',
  tile.char === 'た', tile.char);
check('and is stable for the same id — a story must not change colour on reload',
  coverPlaceholder('ari-to-hato', MANIFEST.alone).hue === tile.hue);
check('the hue is a legal degree',
  tile.hue >= 0 && tile.hue < 360 && tile.hue2 >= 0 && tile.hue2 < 360,
  `${tile.hue}/${tile.hue2}`);

// The property that actually matters on a shelf. Hues are snapped to a fixed
// wheel so two tiles are either the SAME colour — which reads as a deliberate
// palette — or clearly different. Computing the hue continuously from the
// hash (multiplying by the golden angle) produced pairs one degree apart,
// which just looks like a bug. Any two hues must therefore be equal or well
// separated, never merely close.
const ids = [
  'ari-to-hato', 'momotaro-1', 'cinderella', 'dracula', 'oz-no-mahoutsukai',
  'usagi-to-kame', 'kasa-jizou', 'rapunzel', 'takarajima', 'pinocchio',
  'akazukin', 'ali-baba', 'goldilocks', 'frankenstein', 'ookina-kabu',
  'machi-no-nezumi-inaka-no-nezumi', 'futatsu-no-obentou', 'jekyll-to-hyde',
];
const hues = ids.map((one) => coverPlaceholder(one, MANIFEST.alone).hue);
const tooClose = hues.flatMap((a, i) => hues.slice(i + 1)
  .filter((b) => a !== b && Math.abs(a - b) < 20 && Math.abs(a - b) > 0)
  .map((b) => `${a}/${b}`));
check('no two covers land on nearly-but-not-quite the same hue',
  tooClose.length === 0, tooClose.join(' '));
check('and the wheel is actually being spread across, not collapsed to one spoke',
  new Set(hues).size >= 8, `${new Set(hues).size} distinct hues from ${ids.length} ids`);
check('the light/deep bit gives the wheel twice the tiles it has spokes',
  new Set(ids.map((one) => {
    const t = coverPlaceholder(one, MANIFEST.alone);
    return `${t.hue}${t.deep ? 'd' : 'l'}`;
  })).size > new Set(hues).size);
check('a story with no title still gets a mark rather than an empty tile',
  coverPlaceholder('x', {}).char === '読');

print('');
if (failures) throw new Error(`${failures} failure(s)`);
print('all library tests passed');
