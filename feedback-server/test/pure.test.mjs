// Unit tests for everything in the Worker that is a pure function of its
// input — validation, text neutralisation, the issue template, version
// comparison, and the webhook's label/close vocabulary.
//
// These run on Node (`npm test` in this directory), NOT on JavaScriptCore
// like the app's own test/*.js. The Worker code uses WebCrypto and dynamic
// imports that jsc does not have, and there is no reason to make server code
// pretend otherwise — the client half of this feature is tested under jsc in
// the repository's own test/contributions.js.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  filterDiagnostics, isReceiptToken, neutralizeMarkdown, parseStatusRequest,
  parseSubmission, ValidationError,
} from '../src/validate.js';
import { idFromMarker, issueBody, issueLabels, issueTitle } from '../src/issue-body.js';
import { atLeast, compareVersions, parseVersion } from '../src/version.js';
import { translateIssueEvent, verifySignature } from '../src/webhook.js';
import { mappingFingerprint, releaseSupersedes, signRelease } from '../src/releases.js';
import { hmacBytesHex, timingSafeEqual } from '../src/crypto.js';

const RECEIPT = 'A'.repeat(43);

function submission(overrides = {}) {
  return {
    id: '4c743f78-1f3e-4b52-9b1a-2b3c4d5e6f70',
    receiptToken: RECEIPT,
    category: 'bug',
    title: 'Placement result looks wrong',
    details: 'It said I knew zero kanji but I answered plenty right.',
    ...overrides,
  };
}

function rejects(body, code) {
  assert.throws(() => parseSubmission(body), (error) => {
    assert.ok(error instanceof ValidationError, 'expected a ValidationError');
    assert.equal(error.code, code);
    return true;
  });
}

// --- Receipts ---------------------------------------------------------------

test('a receipt must be exactly 32 bytes of base64url', () => {
  assert.equal(isReceiptToken(RECEIPT), true);
  assert.equal(isReceiptToken('A'.repeat(42)), false, 'too short');
  assert.equal(isReceiptToken('A'.repeat(44)), false, 'too long');
  assert.equal(isReceiptToken(`${'A'.repeat(42)}+`), false, 'base64, not base64url');
  assert.equal(isReceiptToken(`${'A'.repeat(42)}=`), false, 'padded');
  assert.equal(isReceiptToken(null), false);
});

// --- Submission validation --------------------------------------------------

test('a well-formed submission is accepted and normalised', () => {
  const parsed = parseSubmission(submission());
  assert.equal(parsed.category, 'bug');
  assert.equal(parsed.title, 'Placement result looks wrong');
  assert.deepEqual(parsed.diagnostics, {});
});

test('the id must be a UUID and the category must be in the enum', () => {
  rejects(submission({ id: 'not-a-uuid' }), 'invalid_id');
  rejects(submission({ category: 'urgent' }), 'invalid_category');
  rejects(submission({ receiptToken: 'short' }), 'invalid_receipt');
  rejects('a string', 'invalid_body');
  rejects([], 'invalid_body');
});

test('text bounds are counted in code points, so Japanese and emoji are not penalised', () => {
  // 4 code points is the floor; four kana must pass where four bytes of a
  // multi-byte character must not be mistaken for four characters.
  const ok = parseSubmission(submission({ title: 'ひらがな', details: 'よめない' }));
  assert.equal(ok.title, 'ひらがな');
  rejects(submission({ title: 'あい' }), 'short_title');
  rejects(submission({ details: '🌸🌸'.repeat(1) }), 'short_details');
  rejects(submission({ title: 'x'.repeat(101) }), 'long_title');
  rejects(submission({ details: 'x'.repeat(4001) }), 'long_details');
});

test('control characters and bidi overrides are stripped before anything else', () => {
  const parsed = parseSubmission(submission({
    details: 'before‮gnitirw‬​after end',
  }));
  assert.ok(!/[‮‬​]/.test(parsed.details), parsed.details);
  assert.ok(parsed.details.includes('before'));
  assert.ok(parsed.details.includes('end'));
});

test('newlines survive but runs of blank lines collapse', () => {
  const parsed = parseSubmission(submission({ details: 'one\n\n\n\n\ntwo   \nthree' }));
  assert.equal(parsed.details, 'one\n\ntwo\nthree');
});

// --- Markdown neutralisation ------------------------------------------------

test('mentions, cross-references and closing keywords are defused', () => {
  const out = neutralizeMarkdown('hi @octocat and @a-team, see #12 / owner/repo#9. Fixes #55');
  assert.ok(!/(^|[^\w/])@[A-Za-z]/.test(out), `mention survived: ${out}`);
  assert.ok(out.includes('\\#12'), out);
  assert.ok(out.includes('owner/repo\\#9'), out);
  assert.ok(out.includes('`Fixes`'), out);
});

test('an email address keeps its @ so the form can be seen to have been ignored', () => {
  const out = neutralizeMarkdown('write to me at kid@example.com');
  assert.ok(out.includes('kid@example.com'), out);
});

test('user text cannot close the hidden marker comment', () => {
  const out = neutralizeMarkdown('sneaky --> <!-- kanaquest-feedback:whatever -->');
  assert.ok(!out.includes('<!--'), out);
  assert.ok(!out.includes('-->'), out);
});

test('a plain # that is not a reference is left alone', () => {
  assert.equal(neutralizeMarkdown('# heading'), '# heading');
  assert.equal(neutralizeMarkdown('question #3 was'), 'question \\#3 was');
});

// --- Diagnostics ------------------------------------------------------------

test('only allowlisted diagnostics survive, with their enums enforced', () => {
  const out = filterDiagnostics({
    appVersion: '2026-09-05d',
    viewport: 'small',
    browser: 'netscape',        // not in the enum
    online: 'yes',              // wrong type for a boolean
    syncCode: 'ABCD-EFGH',      // not allowlisted at all
    userAgent: 'Mozilla/5.0 …', // deliberately not allowlisted
    locale: 'en-GB',
  });
  assert.deepEqual(out, { appVersion: '2026-09-05d', viewport: 'small', locale: 'en-GB' });
});

test('diagnostics that are not an object degrade to empty rather than throwing', () => {
  assert.deepEqual(filterDiagnostics(null), {});
  assert.deepEqual(filterDiagnostics(['a']), {});
  assert.deepEqual(filterDiagnostics('x'), {});
});

test('an over-long diagnostic string is dropped, not truncated into the issue', () => {
  assert.deepEqual(filterDiagnostics({ screen: 'x'.repeat(49) }), {});
});

// --- Status batch -----------------------------------------------------------

test('a status batch drops malformed pairs but keeps the good ones', () => {
  const pairs = parseStatusRequest({
    items: [
      { id: '4c743f78-1f3e-4b52-9b1a-2b3c4d5e6f70', receiptToken: RECEIPT },
      { id: 'nope', receiptToken: RECEIPT },
      { id: '4c743f78-1f3e-4b52-9b1a-2b3c4d5e6f71', receiptToken: 'short' },
      { id: '4C743F78-1F3E-4B52-9B1A-2B3C4D5E6F70', receiptToken: RECEIPT }, // same id, other case
    ],
  });
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].id, '4c743f78-1f3e-4b52-9b1a-2b3c4d5e6f70');
});

test('a status batch larger than the cap is refused outright', () => {
  const items = Array.from({ length: 51 }, () => ({ id: '4c743f78-1f3e-4b52-9b1a-2b3c4d5e6f70', receiptToken: RECEIPT }));
  assert.throws(() => parseStatusRequest({ items }), /too many|Too many/i);
});

// --- Issue template ---------------------------------------------------------

test('the issue title and labels are server-chosen', () => {
  assert.equal(issueTitle('content', 'Wrong reading for 生'), '[Content correction] Wrong reading for 生');
  assert.deepEqual(issueLabels('idea'), ['from:kanaquest-app', 'kind:idea']);
  // An unknown category cannot invent a label.
  assert.deepEqual(issueLabels('nonsense'), ['from:kanaquest-app']);
});

test('the issue body carries the marker and round-trips through idFromMarker', () => {
  const id = '4c743f78-1f3e-4b52-9b1a-2b3c4d5e6f70';
  const body = issueBody({ id, category: 'bug', details: 'x', diagnostics: {}, submittedAt: 0 });
  assert.equal(idFromMarker(body), id);
  assert.equal(idFromMarker('no marker here'), null);
  assert.equal(idFromMarker(null), null);
});

test('a report with no diagnostics says so rather than showing an empty list', () => {
  const body = issueBody({ id: 'x', category: 'bug', details: 'y', diagnostics: {}, submittedAt: 0 });
  assert.ok(body.includes('chose not to attach app details'), body);
});

// --- Version comparison -----------------------------------------------------

test('versions parse as date plus optional build letter', () => {
  assert.deepEqual(parseVersion('2026-09-05'), { year: 2026, month: 9, day: 5, build: 0 });
  assert.deepEqual(parseVersion('2026-09-05d'), { year: 2026, month: 9, day: 5, build: 4 });
  assert.equal(parseVersion('2026-9-5'), null);
  assert.equal(parseVersion('2026-13-01'), null);
  assert.equal(parseVersion('v1.2.3'), null);
  assert.equal(parseVersion(''), null);
  assert.equal(parseVersion(undefined), null);
});

test('same-day letters, later dates and equality all compare correctly', () => {
  assert.equal(compareVersions('2026-09-05', '2026-09-05a'), -1, 'no suffix is the first build of the day');
  assert.equal(compareVersions('2026-09-05b', '2026-09-05a'), 1);
  assert.equal(compareVersions('2026-09-06', '2026-09-05z'), 1);
  assert.equal(compareVersions('2026-09-05d', '2026-09-05d'), 0);
  assert.equal(compareVersions('2025-12-31', '2026-01-01'), -1);
});

test('an unparseable version compares to null, never to "older"', () => {
  // The distinction that stops a malformed server version celebrating on
  // every single load.
  assert.equal(compareVersions('garbage', '2026-09-05'), null);
  assert.equal(compareVersions('2026-09-05', 'garbage'), null);
  assert.equal(atLeast('garbage', '2026-09-05'), false);
  assert.equal(atLeast('2026-09-05', '2026-09-05'), true);
  assert.equal(atLeast('2026-09-04', '2026-09-05'), false, 'an app older than the fix must not celebrate');
});

// --- Webhook translation ----------------------------------------------------

const issueWith = (labels = [], extra = {}) => ({
  issue: { number: 7, labels: labels.map((name) => ({ name })), ...extra },
});

test('closing translates by state_reason, and never straight to released', () => {
  assert.deepEqual(translateIssueEvent('closed', issueWith([], { state_reason: 'completed' })), { status: 'fixed' });
  assert.deepEqual(translateIssueEvent('closed', issueWith([], { state_reason: 'not_planned' })), { status: 'not_planned' });
  assert.deepEqual(translateIssueEvent('closed', issueWith([], { state_reason: 'duplicate' })), { status: 'duplicate' });
  // An older payload with no reason at all is still "the code work is done".
  assert.deepEqual(translateIssueEvent('closed', issueWith([])), { status: 'fixed' });
});

test('labels move status only through the fixed map', () => {
  assert.deepEqual(translateIssueEvent('labeled', issueWith(['status:planned'])), { status: 'planned' });
  assert.deepEqual(translateIssueEvent('labeled', issueWith(['status:in-progress'])), { status: 'in_progress' });
  // A label the maintainer uses for their own purposes changes nothing.
  assert.equal(translateIssueEvent('labeled', issueWith(['good first issue'])), null);
  assert.equal(translateIssueEvent('labeled', issueWith([])), null);
});

test('unlabeling recomputes from the whole remaining label set', () => {
  // status:planned removed, status:reviewing still on: fall back, do not
  // keep asserting a state the tracker no longer shows.
  assert.deepEqual(
    translateIssueEvent('unlabeled', issueWith(['status:reviewing'])),
    { status: 'under_review' },
  );
  assert.equal(translateIssueEvent('unlabeled', issueWith(['kind:bug'])), null);
});

test('a reopen is the one signal allowed to move a report backwards', () => {
  assert.deepEqual(translateIssueEvent('reopened', issueWith([])), { status: 'under_review', allowRegress: true });
  assert.deepEqual(
    translateIssueEvent('reopened', issueWith(['status:in-progress'])),
    { status: 'in_progress', allowRegress: true },
  );
});

test('comments and edits are ignored entirely', () => {
  assert.equal(translateIssueEvent('created', issueWith([])), null);
  assert.equal(translateIssueEvent('edited', issueWith([])), null);
  assert.equal(translateIssueEvent('assigned', issueWith([])), null);
});

// --- Signatures -------------------------------------------------------------

test('the webhook signature is verified over raw bytes, including non-ASCII', () => {
  const secret = 'shhh';
  const raw = new TextEncoder().encode(JSON.stringify({ text: 'ひらがながよめない 🌸' }));
  return hmacBytesHex(secret, raw).then(async (hex) => {
    assert.equal(await verifySignature(secret, raw, `sha256=${hex}`), true);
    assert.equal(await verifySignature(secret, raw, `sha256=${'0'.repeat(64)}`), false);
    assert.equal(await verifySignature(secret, raw, hex), false, 'must require the sha256= prefix');
    assert.equal(await verifySignature('', raw, `sha256=${hex}`), false, 'no secret, no trust');
    assert.equal(await verifySignature(secret, raw, null), false);
  });
});

test('constant-time compare still gets the answer right', () => {
  assert.equal(timingSafeEqual('abc', 'abc'), true);
  assert.equal(timingSafeEqual('abc', 'abd'), false);
  assert.equal(timingSafeEqual('abc', 'ab'), false);
  assert.equal(timingSafeEqual(null, 'abc'), false);
});

test('a release signature covers the timestamp, so a body cannot be replayed later', async () => {
  const raw = new TextEncoder().encode('{"version":"2026-09-06a"}');
  const a = await signRelease('secret', 1000, raw);
  const b = await signRelease('secret', 2000, raw);
  assert.notEqual(a, b);
  assert.equal(await signRelease('secret', 1000, raw), a, 'and is deterministic');
});

test('the release mapping fingerprint ignores order but not content', async () => {
  const one = await mappingFingerprint([{ issue: 2, message: 'b' }, { issue: 1, message: 'a' }]);
  const two = await mappingFingerprint([{ issue: 1, message: 'a' }, { issue: 2, message: 'b' }]);
  const three = await mappingFingerprint([{ issue: 1, message: 'a' }, { issue: 2, message: 'CHANGED' }]);
  assert.equal(one, two, 'a re-run of the same deploy must hash identically');
  assert.notEqual(one, three, 'a different mapping for the same version must not');
});

// A report can be answered twice: a first fix ships, turns out not to be
// good enough, and a better one ships later. The client has always expected
// that (pendingCelebrations re-fires when acknowledgedVersion is older than
// releasedIn); until 2026-09-08 the server refused to record it, so the only
// way to thank somebody a second time was to edit the database by hand.
test('a later release supersedes an earlier one for the same report', () => {
  assert.equal(releaseSupersedes(null, '2026-09-07g'), true, 'never released before');
  assert.equal(releaseSupersedes('', '2026-09-07g'), true, 'empty reads as never released');
  assert.equal(releaseSupersedes('2026-09-06k', '2026-09-07g'), true, 'a later day');
  assert.equal(releaseSupersedes('2026-09-07f', '2026-09-07g'), true, 'a later build the same day');
  assert.equal(releaseSupersedes('2026-09-07', '2026-09-07a'), true, 'no suffix is the first build');
});

test('a release never overwrites itself or anything newer', () => {
  assert.equal(releaseSupersedes('2026-09-07g', '2026-09-07g'), false,
    'a replayed deploy changes nothing — and recordRelease already guarantees the same message');
  assert.equal(releaseSupersedes('2026-09-07g', '2026-09-07f'), false,
    'an old deploy script firing late must not downgrade what a learner was told');
  assert.equal(releaseSupersedes('2026-09-07g', '2026-09-06k'), false, 'nor an earlier day');
});

test('an unparseable version leaves the report alone rather than guessing', () => {
  assert.equal(releaseSupersedes('garbage', '2026-09-07g'), false);
  assert.equal(releaseSupersedes('2026-09-07g', 'garbage'), false);
  assert.equal(releaseSupersedes('garbage', 'nonsense'), false);
});
