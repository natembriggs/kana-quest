// Putting two kanji side by side, and working out which two are worth
// putting there.
//
// The problem this exists for is the one a learner reported in their own
// words: "let me click on wrong answers to see that kanji — helps me look at
// kanji I tend to get mixed up." Definition mode asks about a kanji with
// English buttons, so a wrong tap flashes a meaning belonging to some OTHER
// character the learner never gets to see. The miss is the moment they most
// want that character in front of them, next to the one they were actually
// asked about, with the difference spelled out.
//
// Everything here is pure: it takes component lists and kanji entries and
// returns plain data or plain strings. Resolving a character to its parts
// (which needs the lazily-loaded per-grade component chunks) and painting
// the result both stay in app.js, the same split renderComponentBreakdown
// already uses.

/** A component list with each character appearing once, in first-seen order.
 * KanjiVG breakdowns legitimately repeat a part (林 is 木 twice), which is
 * true of the character but useless in a difference list — "both have 木 and
 * 木" says nothing. */
function dedupeParts(parts) {
  const seen = new Set();
  const out = [];
  parts.forEach((part) => {
    if (seen.has(part.c)) return;
    seen.add(part.c);
    out.push(part);
  });
  return out;
}

/**
 * What two kanji share and what they don't, as component lists.
 *
 * Takes the characters themselves as well as their parts because
 * containment is its own kind of relationship and the parts alone can't
 * express it: 土 has no breakdown of its own, so a plain parts-vs-parts diff
 * says 土 and 持 have nothing in common — when in fact 土 is sitting right
 * there inside 持, which is very likely why they got mixed up.
 *
 * Returns { shared, onlyA, onlyB, aInB, bInA }, where the three lists hold
 * `{ c, meaning }` part records and the two flags are booleans.
 */
export function componentDiff(a, aParts, b, bParts) {
  const aChars = new Set(aParts.map((p) => p.c));
  const bChars = new Set(bParts.map((p) => p.c));
  return {
    shared: dedupeParts(aParts.filter((p) => bChars.has(p.c))),
    onlyA: dedupeParts(aParts.filter((p) => !bChars.has(p.c))),
    onlyB: dedupeParts(bParts.filter((p) => !aChars.has(p.c))),
    aInB: bChars.has(a),
    bInA: aChars.has(b),
  };
}

/** "土 (earth)", or "土 (earth) and 寸 (measure)", or "A, B and C" — the
 * Oxford-comma-free list style the rest of the app's learner-facing text
 * uses. */
function partList(parts) {
  const labels = parts.map((p) => (p.meaning ? `${p.c} (${p.meaning})` : p.c));
  if (labels.length <= 1) return labels.join('');
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

/**
 * One sentence saying what actually separates these two characters, in the
 * plainest words that are still true — this is the whole payload of the
 * comparison, and it is read by children.
 *
 * Returns '' when there is genuinely nothing to say (neither character has a
 * breakdown on record and neither contains the other), rather than padding
 * with something vacuous. The caller hides the line in that case; the glyphs,
 * meanings and readings above it still do their job.
 */
export function comparisonSummary(a, b, diff) {
  // Containment first: it outranks a parts-vs-parts reading of the same two
  // characters, and it is the more surprising fact of the two.
  if (diff.aInB) return `${a} is one of the parts ${b} is built from — look for it inside.`;
  if (diff.bInA) return `${b} is one of the parts ${a} is built from — look for it inside.`;

  const hasShared = diff.shared.length > 0;
  const sides = [];
  if (diff.onlyA.length) sides.push(`${a} has ${partList(diff.onlyA)}`);
  if (diff.onlyB.length) sides.push(`${b} has ${partList(diff.onlyB)}`);

  if (hasShared && sides.length) {
    return `Both are built from ${partList(diff.shared)}. The difference: ${sides.join(', while ')}.`;
  }
  if (hasShared) {
    // Identical part sets — rare, but real: the same two parts stacked
    // rather than side by side. Saying "the difference is X" would be a
    // lie here.
    return `Both are built from the same parts (${partList(diff.shared)}) — what differs is how they sit.`;
  }
  if (sides.length === 2) {
    return `No parts in common: ${sides.join(', while ')}.`;
  }
  if (sides.length === 1) {
    // Only one side has a breakdown on record. Worth saying, since half an
    // answer still tells you which character has a handle to grab.
    const bare = diff.onlyA.length ? b : a;
    return `${sides[0]}. ${bare} isn't broken into parts here — it's learned as one shape.`;
  }
  return '';
}

// How much each kind of overlap counts toward "you could mix these two up".
// Shared components dominate on purpose: a shared LOOK is what actually
// causes a misread, whereas a shared meaning or reading causes a different
// (and rarer) kind of mistake. Containment scores the same as a shared
// component because it is the same confusion seen from one level up.
//
// The gap between the first two and the last two is deliberately wide enough
// that no plausible number of shared meanings outranks a single shared
// component. 町 (town, village, block, street) and 村 (village, town) share
// two meanings and not one stroke; 町 and 男 share 田. At two points a
// meaning the first pair won, which is the wrong answer to "which of these
// do I mix up with 町".
const SCORE_SHARED_COMPONENT = 4;
const SCORE_CONTAINS = 4;
const SCORE_SHARED_MEANING = 1;
const SCORE_SHARED_READING = 1;

/**
 * How confusable two kanji are, as a bare number. Higher is more confusable;
 * 0 means "nothing in common worth showing", and the caller drops those
 * rather than padding a list out to a fixed length with strangers.
 *
 * `aInfo`/`bInfo` are kanjiInfo() entries (meanings + quizReadings); either
 * may be null for a character whose grade hasn't been loaded, in which case
 * only the component half of the score is computed.
 */
export function similarityScore(a, aParts, aInfo, b, bParts, bInfo) {
  if (a === b) return 0;
  const diff = componentDiff(a, aParts, b, bParts);
  let score = diff.shared.length * SCORE_SHARED_COMPONENT;
  if (diff.aInB || diff.bInA) score += SCORE_CONTAINS;

  if (aInfo && bInfo) {
    const meanings = new Set((bInfo.meanings || []).map((m) => m.toLowerCase()));
    (aInfo.meanings || []).forEach((m) => {
      if (meanings.has(m.toLowerCase())) score += SCORE_SHARED_MEANING;
    });
    const readings = new Set(bInfo.quizReadings || []);
    (aInfo.quizReadings || []).forEach((r) => {
      if (readings.has(r)) score += SCORE_SHARED_READING;
    });
  }
  return score;
}

/**
 * The `limit` kanji from `candidates` most worth comparing `char` against,
 * best first.
 *
 * `resolve(c)` hands back `{ parts, info }` for one character — injected
 * rather than imported so this stays pure and testable, and so the caller
 * keeps control of the lazy per-grade loading that resolving actually needs.
 *
 * Ties are broken by the candidate's position in `candidates`, which the
 * caller orders meaningfully (the learner's own study list first, then the
 * character's own grade) — so an equally-similar kanji they are actually
 * studying beats one they have never met.
 */
export function rankSimilar(char, candidates, resolve, limit = 6) {
  const self = resolve(char) || { parts: [], info: null };
  const scored = [];
  const seen = new Set([char]);
  candidates.forEach((c, order) => {
    // `candidates` is deliberately allowed to contain duplicates — the
    // caller concatenates the study list and the character's own grade, and
    // a kanji in both should keep its earlier (study-list) tie-break
    // position rather than having to be deduped before it gets here.
    if (seen.has(c)) return;
    seen.add(c);
    const other = resolve(c);
    if (!other) return;
    const score = similarityScore(char, self.parts, self.info, c, other.parts, other.info);
    if (score > 0) scored.push({ char: c, score, order });
  });
  scored.sort((x, y) => (y.score - x.score) || (x.order - y.order));
  return scored.slice(0, limit).map((entry) => entry.char);
}
