// Pure library logic for the story screen: how the shipped stories group into
// series, how far through each one a learner is, and what comes next. No DOM
// and no profile-mutating side effects, so all of it is unit-testable against
// a synthetic manifest (test/library.js). app.js renders what this decides.
//
// Separate from reader.js on purpose: that module is about turning ONE story's
// tokens into what a learner sees, this one is about the shelf they pick from.

/**
 * How far through a story a learner is, from `profile.stories` alone.
 *
 * Three states, and the order of the checks matters. Opening a story writes a
 * `read` entry immediately (touchStoryOpened in app.js), so the presence of
 * one proves only that the learner once tapped the card — which is why
 * "started" is judged by a saved POSITION and finishing by `read.done`.
 * Getting that backwards would mark every story ever opened as in progress
 * forever.
 *
 *   'unread'  — never opened, or opened and left without reading a paragraph
 *   'reading' — has a saved position and has not been finished
 *   'read'    — finished at least once (`passes` counts re-reads)
 */
export function storyReadState(id, stories) {
  const read = stories?.read?.[id];
  const pos = stories?.pos?.[id];
  if (read && read.done) return 'read';
  if (pos) return 'reading';
  return 'unread';
}

/**
 * How far through, as a 0–1 fraction, for a progress bar. Measured in
 * PARAGRAPHS, using the manifest's `paras` — the same unit the saved position
 * is recorded in (stories-plan.md §3.5), so the number on the library card and
 * the place the reader resumes to can never disagree. Null when there is
 * nothing meaningful to show.
 */
export function storyProgress(id, stories, entry) {
  if (storyReadState(id, stories) !== 'reading') return null;
  const pos = stories.pos[id];
  if (!entry?.paras) return null;
  return Math.min(1, Math.max(0, (pos.p || 0) / entry.paras));
}

/**
 * Everything at one level, as the library lists it: standalone stories and
 * series, each series collapsed into a single entry carrying its parts in
 * order.
 *
 * A series keeps the position of its FIRST part in the underlying order, so
 * turning a standalone story into part 1 of a series does not make it jump
 * around the shelf. Within a series, parts are ordered by `part` — a series is
 * read in order and should look like it, even though §8.2 is explicit that
 * nothing is locked and part 4 is tappable before part 1 has been read.
 *
 * A one-part "series" is listed as a standalone story, matching storyLabel's
 * rule and for the same reason: two shipped stories tag the work they adapt
 * (Alice, Oz) while being a single complete part of it, and wrapping those in
 * a series card that expands to reveal one chapter is pure ceremony.
 */
export function groupStoriesForLevel(manifest, level) {
  const out = [];
  const seriesIndex = new Map();
  Object.entries(manifest)
    .filter(([, entry]) => entry.level === level)
    .forEach(([id, entry]) => {
      if (!entry.series || entry.series.of <= 1) {
        out.push({ kind: 'story', id, entry });
        return;
      }
      const key = entry.series.id;
      let group = seriesIndex.get(key);
      if (!group) {
        group = {
          kind: 'series', id: key, name: entry.series.name, of: entry.series.of, parts: [],
        };
        seriesIndex.set(key, group);
        out.push(group);
      }
      group.parts.push({ id, entry, part: entry.series.part });
    });
  seriesIndex.forEach((group) => group.parts.sort((a, b) => a.part - b.part));
  return out;
}

/**
 * A series' standing: how many parts are finished, and which one the learner
 * should be offered. `current` is the first part that is not finished —
 * in-progress if there is one, otherwise the first unread — which is what a
 * "Continue" affordance should open. Null once every part is read, because at
 * that point the series has nothing left to continue into.
 */
export function seriesStanding(group, stories) {
  const states = group.parts.map((part) => storyReadState(part.id, stories));
  const done = states.filter((s) => s === 'read').length;
  const currentIndex = states.findIndex((s) => s !== 'read');
  return {
    done,
    total: group.parts.length,
    current: currentIndex === -1 ? null : group.parts[currentIndex],
  };
}

/**
 * The part after this one, or null at the end of a series (and for anything
 * standalone). What the end card's "Next" button opens.
 *
 * Looked up through the manifest rather than by incrementing `part`, so a
 * series whose parts are not contiguous — one withdrawn, one not yet written —
 * skips the gap instead of offering a story that does not exist.
 */
export function nextInSeries(manifest, id) {
  const entry = manifest[id];
  if (!entry?.series) return null;
  const group = Object.entries(manifest)
    .filter(([, other]) => other.series && other.series.id === entry.series.id)
    .map(([otherId, other]) => ({ id: otherId, part: other.series.part }))
    .sort((a, b) => a.part - b.part);
  const at = group.findIndex((part) => part.id === id);
  if (at === -1 || at === group.length - 1) return null;
  return group[at + 1].id;
}

/**
 * The label a story carries wherever it needs to name itself alongside its
 * series — the reader's top bar, the continue card. Standalone stories get
 * their own title and nothing else; a part of a real serialization gets the
 * series' name and its number.
 *
 * A one-part "series" is deliberately treated as standalone. Two shipped
 * stories carry a `series` tag naming the work they adapt while being a single
 * complete part of it (`of: 1`), and captioning those "Chapter 1 of 1" would
 * be noise about a book that has no second chapter here.
 */
export function storyLabel(entry) {
  if (!entry?.series || entry.series.of <= 1) return entry?.title?.ja || '';
  return `${entry.series.name} · ${entry.series.part}/${entry.series.of}`;
}

/**
 * One shelf entry's read state — a story's own, or a series' as a whole.
 *
 * A series counts as read only when every part is; anything part-way through
 * (some chapters finished, or one in progress) is 'reading'. That is what a
 * learner means when they ask which books they have finished, and it keeps a
 * six-chapter series from sitting in "Unread" because chapter 1 is done.
 */
export function shelfReadState(group, stories) {
  if (group.kind !== 'series') return storyReadState(group.id, stories);
  const standing = seriesStanding(group, stories);
  if (standing.done === standing.total) return 'read';
  if (standing.done > 0) return 'reading';
  return group.parts.some((part) => storyReadState(part.id, stories) === 'reading')
    ? 'reading' : 'unread';
}

/** Minutes, from the manifest's token count — the whole series for a series,
 * since that is what committing to it costs. */
function shelfLength(group) {
  if (group.kind !== 'series') return group.entry.length;
  return group.parts.reduce((n, part) => n + part.entry.length, 0);
}

/**
 * How a level's shelf is ordered once there is more on it than fits on a
 * screen: what you are in the middle of, then what you have not started,
 * then what you have finished.
 *
 * Unread is ordered SHORTEST first. Choosing is the hard part of picking
 * something to read, and the cheapest thing to try is the right default —
 * the opposite order asks a learner to commit before they know whether the
 * level suits them. Finished goes last because it is a re-read shelf, not a
 * to-do list.
 *
 * Stable within each band, so the underlying order (and a series' position at
 * its first part) still shows through.
 */
const SHELF_ORDER = { reading: 0, unread: 1, read: 2 };
export function sortShelf(groups, stories) {
  return groups
    .map((group, i) => ({ group, i, state: shelfReadState(group, stories) }))
    .sort((a, b) => {
      const band = SHELF_ORDER[a.state] - SHELF_ORDER[b.state];
      if (band !== 0) return band;
      if (a.state === 'unread') {
        const len = shelfLength(a.group) - shelfLength(b.group);
        if (len !== 0) return len;
      }
      return a.i - b.i;
    })
    .map((row) => row.group);
}

/** How many entries at this level sit in each read state — the numbers the
 * filter row shows. Worth showing as much as the filter itself: they are the
 * only place the app says how much there is at a level, which is what a
 * learner wants to know before committing to one. */
export function shelfCounts(groups, stories) {
  const counts = {
    all: groups.length, unread: 0, reading: 0, read: 0,
  };
  groups.forEach((group) => { counts[shelfReadState(group, stories)] += 1; });
  return counts;
}

export function filterShelf(groups, filter, stories) {
  if (!filter || filter === 'all') return groups;
  return groups.filter((group) => shelfReadState(group, stories) === filter);
}

/**
 * The look of a story's generated cover: two hues and the character to put on
 * it, derived from the id so one story always gets the same tile.
 *
 * This is what makes covers tractable rather than a blocker (stories-plan.md
 * §8.8). The library looks finished before any art exists, real covers can
 * arrive one story at a time, and the tile costs zero bytes and zero requests
 * because it is painted from CSS, not fetched.
 *
 * Hues come from a FIXED WHEEL of evenly spaced buckets rather than being
 * computed continuously from the hash. The obvious approach — multiply the
 * hash by the golden angle — spreads *sequential* indices beautifully and
 * arbitrary hashes not at all: it put two L2 stories at 102° and 103°, which
 * on a shelf reads as a mistake. Snapping to a wheel means two tiles are
 * either clearly different or exactly the same, and exactly the same reads as
 * a deliberate palette. A second bit picks a light or deep tone, so the wheel
 * yields twice as many distinguishable tiles as it has spokes.
 */
const COVER_SPOKES = 16;
export function coverPlaceholder(id, entry) {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) % 1000003; // prime, to mix the tail
  }
  const hue = (Math.floor(hash / 7) % COVER_SPOKES) * (360 / COVER_SPOKES);
  const title = entry?.title?.ja || '';
  return {
    hue,
    hue2: (hue + 24) % 360,
    deep: hash % 2 === 1,
    char: [...title][0] || '読',
  };
}
