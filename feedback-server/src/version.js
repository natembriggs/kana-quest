// APP_VERSION comparison. Pure, and duplicated almost exactly in
// src/contributions.js on the client — the client needs it to decide whether
// the JavaScript actually executing is new enough to celebrate, and the
// server needs it to reject a malformed version before it is written into a
// release row that learners will be compared against forever.
//
// The format is the repository's existing convention: `YYYY-MM-DD` with an
// optional lowercase letter suffix for a second, third, … build on the same
// day (2026-09-05, 2026-09-05a, 2026-09-05b …).
//
// A plain string comparison very nearly works and is exactly the kind of
// undocumented trick that breaks once: '2026-09-05' < '2026-09-05a' is true,
// but the day with no suffix sorting *before* the day with one is a
// coincidence of ASCII rather than a stated rule, and nothing would catch it
// changing. So it is parsed.

const VERSION_RE = /^(\d{4})-(\d{2})-(\d{2})([a-z]?)$/;

export function parseVersion(value) {
  if (typeof value !== 'string') return null;
  const match = VERSION_RE.exec(value.trim());
  if (!match) return null;
  const [, year, month, day, letter] = match;
  const m = Number(month);
  const d = Number(day);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return {
    year: Number(year),
    month: m,
    day: d,
    // No suffix is the day's first build, so it sorts before 'a'.
    build: letter ? letter.charCodeAt(0) - 96 : 0,
  };
}

export function isValidVersion(value) {
  return parseVersion(value) !== null;
}

/**
 * -1 / 0 / 1, or null if either side is unparseable. Null rather than a
 * guess: a caller deciding whether to tell a learner their fix has shipped
 * must be able to tell "older" apart from "no idea", and treating an
 * unrecognised version as older would celebrate on every load.
 */
export function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return null;
  const fields = ['year', 'month', 'day', 'build'];
  for (const field of fields) {
    if (left[field] !== right[field]) return left[field] < right[field] ? -1 : 1;
  }
  return 0;
}

/** True when `version` is at least `target` — both parseable, target reached. */
export function atLeast(version, target) {
  const result = compareVersions(version, target);
  return result !== null && result >= 0;
}
