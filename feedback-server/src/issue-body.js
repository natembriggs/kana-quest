// The GitHub issue template. Pure — no bindings — so the exact bytes that
// reach GitHub can be asserted in a test.
//
// Everything structural is chosen here: the title prefix, the section
// headings, the order of the diagnostics, the closing note, and the hidden
// marker. The learner supplies exactly two strings, and both arrive already
// neutralised by validate.js.

import { CATEGORY_LABEL, CATEGORY_GITHUB_LABEL, SOURCE_LABEL } from './config.js';

export const MARKER_PREFIX = 'kanaquest-feedback:';

export function markerFor(id) {
  return `<!-- ${MARKER_PREFIX}${id} -->`;
}

/**
 * Pull the feedback id back out of an issue body. This is the reconciliation
 * path: if GitHub created the issue but the Worker died before saving the
 * number, the next attempt lists recent server-labelled issues and reads
 * their markers rather than blindly creating a second one.
 */
export function idFromMarker(body) {
  if (typeof body !== 'string') return null;
  const match = body.match(/<!--\s*kanaquest-feedback:([0-9a-f-]{36})\s*-->/i);
  return match ? match[1].toLowerCase() : null;
}

/**
 * A fixed prefix plus the learner's title, hard-capped. The prefix is what
 * makes an inbox scannable, and it is server-chosen so no report can
 * disguise itself as something else in a notification list.
 */
export function issueTitle(category, title) {
  const prefix = `[${CATEGORY_LABEL[category] || 'Feedback'}]`;
  const trimmed = title.length > 100 ? `${title.slice(0, 99)}…` : title;
  return `${prefix} ${trimmed}`;
}

const DIAGNOSTIC_ORDER = [
  ['appVersion', 'Version'],
  ['swVersion', 'Service worker'],
  ['screen', 'Screen'],
  ['course', 'Course'],
  ['mode', 'Mode'],
  ['display', 'Install mode'],
  ['browser', 'Browser family'],
  ['platform', 'Platform'],
  ['viewport', 'Viewport'],
  ['online', 'Online'],
  ['locale', 'Locale'],
];

export function issueBody({ id, category, details, diagnostics = {}, submittedAt }) {
  const lines = [
    '## In-app feedback',
    '',
    `**Kind:** ${CATEGORY_LABEL[category] || 'Feedback'}`,
    '',
    '### What happened / idea',
    '',
    details,
    '',
    '### App context',
    '',
  ];

  const rows = DIAGNOSTIC_ORDER
    .filter(([key]) => diagnostics[key] !== undefined)
    .map(([key, label]) => `- ${label}: ${String(diagnostics[key])}`);
  lines.push(rows.length ? rows.join('\n') : '- (the learner chose not to attach app details)');

  lines.push(
    '',
    `- Submitted: ${new Date(submittedAt).toISOString()}`,
    '',
    '_Submitted from KanaQuest. No learner name, progress, sync code, or contact',
    'details were attached. The text above is exactly what was typed, with',
    '@mentions and issue references defused._',
    '',
    markerFor(id),
  );

  return lines.join('\n');
}

export function issueLabels(category) {
  return [SOURCE_LABEL, CATEGORY_GITHUB_LABEL[category]].filter(Boolean);
}
