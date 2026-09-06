// Pure input validation and text neutralisation. No bindings, no fetch, no
// clock — so it can be unit-tested exhaustively, which matters more here
// than anywhere else in the service: this is the only code between an
// anonymous public POST and a GitHub API call.

import { CATEGORIES, DIAGNOSTIC_FIELDS, LIMITS } from './config.js';

export class ValidationError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function fail(code, message) {
  throw new ValidationError(code, message);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;

export function isFeedbackId(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

/**
 * A receipt is 32 random bytes in base64url — 43 characters, unpadded. The
 * length is checked rather than merely the alphabet so a short, guessable
 * "token" can never be registered against an id in the first place.
 */
export function isReceiptToken(value) {
  if (typeof value !== 'string') return false;
  const expected = Math.ceil((LIMITS.receiptBytes * 4) / 3);
  if (value.length !== expected) return false;
  return BASE64URL_RE.test(value);
}

/**
 * Unicode control characters, bidirectional overrides and zero-width
 * formatting marks, stripped before the text is ever put in a Markdown
 * document. Bidi overrides in particular can make an issue body render as
 * something quite different from what it contains, which is exactly the kind
 * of surprise a maintainer reading a child's bug report should not have to
 * think about. Ordinary newlines and tabs survive.
 */
function stripControls(text) {
  // \u0000-\u0008, \u000b, \u000c, \u000e-\u001f, \u007f  C0/C1 controls (\n and \t survive)
  // \u200b-\u200f                                zero-width space/joiners and LRM/RLM
  // \u2028\u2029                                 line/paragraph separators
  // \u202a-\u202e, \u2066-\u2069                 bidirectional embedding and isolate overrides
  // \ufeff                                       byte-order mark used as an invisible character
  return text.replace(
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]/g,
    '',
  );
}

/**
 * Collapse runs of blank lines and trim trailing whitespace per line. A
 * child mashing Return should not produce a two-screen issue body, and a
 * predictable shape makes the "### What happened / idea" section boundary
 * reliable.
 */
function tidyWhitespace(text) {
  return text
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Neutralise anything in user text that GitHub would treat as an instruction
 * to notify or link something rather than as prose:
 *
 *   @name          -> pings a real person into a private inbox they may not
 *                     be part of
 *   #123           -> silently cross-references some unrelated issue
 *   owner/repo#12  -> the same, across repositories
 *   Fixes #123     -> a closing keyword; if this text were ever copied into
 *                     a pull request body it would close someone's issue
 *
 * A zero-width word joiner would be invisible but is itself stripped above,
 * so the substitution has to be a visible character. U+FF20 (fullwidth
 * commercial at) and a backslash-escaped `#` keep the text readable while
 * making it inert.
 */
export function neutralizeMarkdown(text) {
  return text
    // Bare HTML comments first, so a report cannot close the hidden marker
    // comment this server appends to the issue body and open something of
    // its own after it.
    .replace(/<!--/g, '&lt;!--')
    .replace(/-->/g, '--&gt;')
    // @mentions, including team mentions. Anchored on a non-word, non-slash
    // character so the local part of an email address is left visible —
    // the form asks learners not to include one, and quietly mangling it
    // would hide the fact that they did.
    .replace(/(^|[^\w/])@([A-Za-z\d][\w-]*)/g, '$1\uff20$2')
    // Cross-references, with or without an owner/repo prefix: #123 in a
    // child's sentence about "question #3" should not silently link some
    // unrelated issue into this one.
    .replace(/(^|[^\w])((?:[\w.-]+\/[\w.-]+)?)#(\d+)/g, '$1$2\\#$3')
    // GitHub's closing keywords. By this point a #number has already become
    // an escaped #number and is inert, but the keyword is quoted as well: if
    // this text were ever pasted into a pull request body the pair would close
    // someone's issue, and defence in depth is cheap here.
    .replace(
      /\b(clos(?:e|es|ed)|fix(?:es|ed)?|resolv(?:e|es|ed))(\s+)(\\?#\d+|https:\/\/github\.com\/\S+)/gi,
      (_match, verb, gap, reference) => `\`${verb}\`${gap}${reference}`,
    );
}

function requireText(value, field, min, max) {
  if (typeof value !== 'string') fail(`invalid_${field}`, `${field} must be text.`);
  const cleaned = tidyWhitespace(stripControls(value));
  // Count by code point, not UTF-16 unit: a report written in Japanese, or
  // one carrying emoji, should get the same allowance as one in English.
  const length = [...cleaned].length;
  if (length < min) fail(`short_${field}`, `${field} is too short.`);
  if (length > max) fail(`long_${field}`, `${field} is too long.`);
  return cleaned;
}

/**
 * Keep only the diagnostics named in DIAGNOSTIC_FIELDS, each within its own
 * type and bound. Unknown keys are dropped silently (an app version ahead of
 * this Worker must still be able to submit); a known key with the wrong
 * shape is also dropped rather than failing the whole report, because losing
 * a learner's words over a malformed viewport class would be a bad trade.
 */
export function filterDiagnostics(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const out = {};
  for (const [key, spec] of Object.entries(DIAGNOSTIC_FIELDS)) {
    const value = input[key];
    if (value === undefined || value === null) continue;
    if (spec.type === 'boolean') {
      if (typeof value === 'boolean') out[key] = value;
      continue;
    }
    if (typeof value !== 'string') continue;
    if (spec.type === 'enum') {
      if (spec.values.includes(value)) out[key] = value;
      continue;
    }
    const cleaned = stripControls(value).trim();
    if (cleaned && cleaned.length <= spec.max) out[key] = cleaned;
  }
  return out;
}

/**
 * Validate a POST /v1/feedback body. Returns the normalised submission; the
 * only text that survives is `title` and `details`, both neutralised, plus
 * allowlisted diagnostics.
 */
export function parseSubmission(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    fail('invalid_body', 'Expected a JSON object.');
  }
  if (!isFeedbackId(body.id)) fail('invalid_id', 'Missing or malformed id.');
  if (!isReceiptToken(body.receiptToken)) fail('invalid_receipt', 'Missing or malformed receipt.');
  if (!CATEGORIES.includes(body.category)) fail('invalid_category', 'Unknown category.');

  const title = requireText(body.title, 'title', LIMITS.titleMin, LIMITS.titleMax);
  const details = requireText(body.details, 'details', LIMITS.detailsMin, LIMITS.detailsMax);

  return {
    id: body.id.toLowerCase(),
    receiptToken: body.receiptToken,
    category: body.category,
    title: neutralizeMarkdown(title),
    details: neutralizeMarkdown(details),
    diagnostics: filterDiagnostics(body.diagnostics),
    // An opaque random id the client keeps per install, used only as the
    // rate-limit key. Not stored, not logged, not linkable to a profile.
    installId: typeof body.installId === 'string' && body.installId.length <= 64
      ? body.installId
      : null,
    turnstileToken: typeof body.turnstileToken === 'string' ? body.turnstileToken : '',
  };
}

/**
 * Validate a POST /v1/feedback/status body: at most 50 id/receipt pairs.
 * Malformed pairs are dropped rather than failing the batch — one corrupted
 * entry in a synced profile must not stop the other nine from refreshing.
 */
export function parseStatusRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    fail('invalid_body', 'Expected a JSON object.');
  }
  const items = Array.isArray(body.items) ? body.items : null;
  if (!items) fail('invalid_body', 'Expected an items array.');
  if (items.length > LIMITS.statusBatch) fail('too_many', 'Too many items in one request.');
  const pairs = [];
  const seen = new Set();
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    if (!isFeedbackId(item.id) || !isReceiptToken(item.receiptToken)) continue;
    const id = item.id.toLowerCase();
    if (seen.has(id)) continue;
    seen.add(id);
    pairs.push({ id, receiptToken: item.receiptToken });
  }
  return pairs;
}
