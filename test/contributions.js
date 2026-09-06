// The learner-facing half of the feedback loop (feedback-plan.md): the
// contribution model, its merge rules, version comparison, and the decision
// about when to celebrate a shipped fix.
//
// Kept separate from store.js/wiring.js because all of it is pure, and
// because the failure modes here are quiet ones — a merge that loses an
// acknowledgement shows up as a celebration firing twice on a second device
// weeks later, which no amount of clicking around would catch.
//
//   /System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc \
//       -m test/contributions.js

const c = await import('../src/contributions.js');
const merge = await import('../src/merge.js');

let failures = 0;
function check(name, condition, detail) {
  if (condition) { print(`ok    ${name}`); return; }
  failures += 1;
  print(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
}

function same(name, actual, expected) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  check(name, a === b, `got ${a}, expected ${b}`);
}

const ID_A = '4c743f78-1f3e-4b52-9b1a-2b3c4d5e6f70';
const ID_B = '5d854a89-2a4f-4c63-8c2b-3c4d5e6f7081';

function contribution(overrides = {}) {
  return c.normalizeContribution(ID_A, {
    receiptToken: 'R'.repeat(43),
    category: 'bug',
    title: 'Placement result looks wrong',
    createdAt: 1000,
    status: 'submitted',
    statusUpdatedAt: 2000,
    localUpdatedAt: 2000,
    ...overrides,
  });
}

// --- Version comparison -----------------------------------------------------

check('a version is a date plus an optional build letter',
  JSON.stringify(c.parseVersion('2026-09-05d')) === JSON.stringify({ year: 2026, month: 9, day: 5, build: 4 }));
check('a malformed version does not parse', c.parseVersion('2026-9-5') === null);
check('a month out of range does not parse', c.parseVersion('2026-13-01') === null);
check('a non-string does not parse', c.parseVersion(undefined) === null);

check('the unsuffixed build sorts before "a"', c.compareVersions('2026-09-05', '2026-09-05a') === -1);
check('later letters sort later', c.compareVersions('2026-09-05b', '2026-09-05a') === 1);
check('a later date beats any letter', c.compareVersions('2026-09-06', '2026-09-05z') === 1);
check('equal versions compare equal', c.compareVersions('2026-09-05d', '2026-09-05d') === 0);
check('the year rolls over correctly', c.compareVersions('2025-12-31', '2026-01-01') === -1);

// The distinction that stops a malformed server version celebrating forever.
check('an unparseable version compares to null, not to "older"',
  c.compareVersions('garbage', '2026-09-05') === null && c.compareVersions('2026-09-05', 'garbage') === null);
check('atLeast is false for an unparseable version', c.atLeast('garbage', '2026-09-05') === false);
check('an app older than the fix is not "at least" it', c.atLeast('2026-09-04', '2026-09-05') === false);
check('an app exactly at the fix is', c.atLeast('2026-09-05', '2026-09-05') === true);

// --- Normalization ----------------------------------------------------------

check('a non-UUID key is rejected', c.normalizeContribution('nope', { status: 'submitted' }) === null);
check('a non-object value is rejected', c.normalizeContribution(ID_A, 'x') === null);
check('an unknown status falls back to sending',
  c.normalizeContribution(ID_A, { status: 'hacked' }).status === 'sending');
check('a missing contributions field normalizes to undefined, not {}',
  c.normalizeContributions(undefined) === undefined);
check('an empty contributions object stays an object',
  JSON.stringify(c.normalizeContributions({})) === '{}');
check('a corrupt entry is dropped rather than crashing the map',
  Object.keys(c.normalizeContributions({ [ID_A]: { status: 'submitted' }, bad: { status: 'submitted' } })).length === 1);

// --- Merge: the basics ------------------------------------------------------

const empty = {};
same('two profiles with no contributions merge back to no field',
  c.mergeContributions(empty, empty),
  { contributions: undefined, forgottenContributions: undefined });

const onlyLocal = { contributions: { [ID_A]: contribution() } };
check('a contribution present on one side only is copied',
  Object.keys(c.mergeContributions(onlyLocal, empty).contributions).length === 1);
check('…and in the other direction too',
  Object.keys(c.mergeContributions(empty, onlyLocal).contributions).length === 1);

// --- Merge: server-owned status vs local acknowledgement --------------------

const older = { contributions: { [ID_A]: contribution({ status: 'under_review', statusUpdatedAt: 2000 }) } };
const newer = { contributions: { [ID_A]: contribution({ status: 'fixed', statusUpdatedAt: 5000 }) } };

check('the newer server read wins for status',
  c.mergeContributions(older, newer).contributions[ID_A].status === 'fixed');
check('…regardless of argument order',
  c.mergeContributions(newer, older).contributions[ID_A].status === 'fixed');

// The rule that stops one device un-celebrating on another.
const acknowledgedButStale = {
  contributions: {
    [ID_A]: contribution({
      status: 'released', statusUpdatedAt: 2000,
      releasedIn: '2026-09-05', acknowledgedVersion: '2026-09-05', acknowledgedAt: 9000,
    }),
  },
};
const freshButUnacknowledged = {
  contributions: {
    [ID_A]: contribution({
      status: 'released', statusUpdatedAt: 7000,
      releasedIn: '2026-09-05', acknowledgedVersion: null, acknowledgedAt: 0,
    }),
  },
};
const ackMerged = c.mergeContributions(acknowledgedButStale, freshButUnacknowledged).contributions[ID_A];
check('an acknowledgement survives merging with a fresher unacknowledged read',
  ackMerged.acknowledgedVersion === '2026-09-05' && ackMerged.acknowledgedAt === 9000,
  JSON.stringify(ackMerged));
check('…while still taking the fresher status timestamp', ackMerged.statusUpdatedAt === 7000);

const ackReverse = c.mergeContributions(freshButUnacknowledged, acknowledgedButStale).contributions[ID_A];
check('acknowledgement merge is commutative',
  ackReverse.acknowledgedVersion === '2026-09-05' && ackReverse.statusUpdatedAt === 7000);

// --- Merge: idempotence and commutativity -----------------------------------

const twoSided = {
  contributions: {
    [ID_A]: contribution({ status: 'planned', statusUpdatedAt: 4000 }),
    [ID_B]: c.normalizeContribution(ID_B, {
      receiptToken: 'S'.repeat(43), category: 'idea', title: 'Dark mode',
      createdAt: 500, status: 'released', statusUpdatedAt: 6000, releasedIn: '2026-09-04',
    }),
  },
};
const forward = c.mergeContributions(twoSided, newer);
const backward = c.mergeContributions(newer, twoSided);
same('merge is commutative across a two-entry map', forward, backward);
same('merge is idempotent',
  c.mergeContributions({ contributions: forward.contributions }, { contributions: forward.contributions }),
  forward);

// --- Merge: tombstones ------------------------------------------------------

const withTombstone = { contributions: {}, forgottenContributions: { [ID_A]: 8000 } };
const staleDevice = { contributions: { [ID_A]: contribution() } };
const tombstoned = c.mergeContributions(withTombstone, staleDevice);
check('a tombstone stops an old device resurrecting a forgotten report',
  tombstoned.contributions[ID_A] === undefined, JSON.stringify(tombstoned.contributions));
check('…and the tombstone itself survives', tombstoned.forgottenContributions[ID_A] === 8000);
check('…in either direction',
  c.mergeContributions(staleDevice, withTombstone).contributions[ID_A] === undefined);
same('the earliest removal time wins',
  c.mergeContributions(
    { forgottenContributions: { [ID_A]: 8000 } },
    { forgottenContributions: { [ID_A]: 3000 } },
  ).forgottenContributions,
  { [ID_A]: 3000 });

// --- Merge: pending drafts --------------------------------------------------

const unsent = { contributions: { [ID_A]: contribution({ status: 'sending', pendingDetails: 'the details' }) } };
const accepted = { contributions: { [ID_A]: contribution({ status: 'accepted', statusUpdatedAt: 9000, pendingDetails: null }) } };
check('a draft accepted on one device stops being pending everywhere',
  c.mergeContributions(unsent, accepted).contributions[ID_A].pendingDetails === null);
check('a draft still unsent on both sides stays pending',
  c.mergeContributions(unsent, unsent).contributions[ID_A].pendingDetails === 'the details');

// --- Applying a server refresh ----------------------------------------------

const local = contribution({ status: 'under_review', statusUpdatedAt: 3000 });

const advanced = c.applyStatusResult(local, {
  found: true, status: 'fixed', statusUpdatedAt: 5000, cursor: 4,
});
check('a newer server result moves the status forward', advanced.status === 'fixed');
check('…and carries the cursor', advanced.cursor === 4);

const stale = c.applyStatusResult(local, { found: true, status: 'submitted', statusUpdatedAt: 1000 });
check('a stale server result does not move the status back', stale.status === 'under_review');

// The single most important rule in the file.
const releasedLocal = contribution({
  status: 'released', statusUpdatedAt: 9000, releasedIn: '2026-09-05',
});
const tryToUndo = c.applyStatusResult(releasedLocal, {
  found: true, status: 'under_review', statusUpdatedAt: 1000, releasedIn: null,
});
check('a stale read can never un-release a contribution',
  tryToUndo.status === 'released' && tryToUndo.releasedIn === '2026-09-05');

const missing = c.applyStatusResult(local, { found: false });
check('a not-found result changes nothing at all', missing === local);
check('a null result changes nothing at all', c.applyStatusResult(local, null) === local);

// --- Celebration eligibility ------------------------------------------------

const shipped = {
  [ID_A]: contribution({ status: 'released', releasedIn: '2026-09-05', createdAt: 100 }),
};

check('a released fix celebrates once the running app is new enough',
  c.pendingCelebrations(shipped, '2026-09-05').length === 1);
check('…and does not on an older build',
  c.pendingCelebrations(shipped, '2026-09-04').length === 0);
check('…and does on a later build',
  c.pendingCelebrations(shipped, '2026-09-07').length === 1);
check('a report that has not shipped never celebrates',
  c.pendingCelebrations({ [ID_A]: contribution({ status: 'fixed' }) }, '2026-09-05').length === 0);
check('a malformed running version never celebrates',
  c.pendingCelebrations(shipped, 'nonsense').length === 0);

const acknowledged = c.acknowledgeCelebrations(shipped, [ID_A], '2026-09-05', 1234);
check('acknowledging stamps the version that was actually running',
  acknowledged[ID_A].acknowledgedVersion === '2026-09-05' && acknowledged[ID_A].acknowledgedAt === 1234);
check('an acknowledged celebration does not fire again',
  c.pendingCelebrations(acknowledged, '2026-09-05').length === 0);
check('…nor on a later version, for the same fix',
  c.pendingCelebrations(acknowledged, '2026-09-09').length === 0);

// A second, later fix for a different report still deserves its own moment.
const twoFixes = {
  ...acknowledged,
  [ID_B]: c.normalizeContribution(ID_B, {
    receiptToken: 'S'.repeat(43), category: 'idea', title: 'Dark mode',
    createdAt: 50, status: 'released', statusUpdatedAt: 100, releasedIn: '2026-09-09',
  }),
};
const pendingTwo = c.pendingCelebrations(twoFixes, '2026-09-09');
check('a newer fix still celebrates after an older one was acknowledged',
  pendingTwo.length === 1 && pendingTwo[0].id === ID_B, JSON.stringify(pendingTwo.map((x) => x.id)));

const bothNew = {
  [ID_A]: contribution({ status: 'released', releasedIn: '2026-09-05', createdAt: 100 }),
  [ID_B]: c.normalizeContribution(ID_B, {
    receiptToken: 'S'.repeat(43), category: 'idea', title: 'Dark mode',
    createdAt: 50, status: 'released', statusUpdatedAt: 100, releasedIn: '2026-09-05',
  }),
};
const combined = c.pendingCelebrations(bothNew, '2026-09-05');
check('several fixes in one release produce one combined list', combined.length === 2);
check('…ordered oldest report first', combined[0].id === ID_B, JSON.stringify(combined.map((x) => x.id)));

// --- Summary and selection helpers ------------------------------------------

const mixed = {
  [ID_A]: contribution({ status: 'released' }),
  [ID_B]: c.normalizeContribution(ID_B, { status: 'in_progress', receiptToken: 'S'.repeat(43) }),
  '6e965b9a-3b5f-4d74-9d3c-4d5e6f708192': c.normalizeContribution(
    '6e965b9a-3b5f-4d74-9d3c-4d5e6f708192', { status: 'not_planned', receiptToken: 'T'.repeat(43) },
  ),
};
same('the three non-competitive totals', c.contributionSummary(mixed), { shared: 3, inProgress: 1, shipped: 1 });
same('an empty profile totals zero', c.contributionSummary(undefined), { shared: 0, inProgress: 0, shipped: 0 });

check('settled and acknowledged reports are not refreshed forever',
  !c.refreshableContributions({
    [ID_A]: contribution({ status: 'released', acknowledgedAt: 5, releasedIn: '2026-09-05' }),
  }).length);
check('a not-yet-acknowledged release still refreshes',
  c.refreshableContributions({ [ID_A]: contribution({ status: 'released', acknowledgedAt: 0 }) }).length === 1);
check('an unsent draft is not sent to the status endpoint',
  !c.refreshableContributions({ [ID_A]: contribution({ status: 'sending' }) }).length);
check('a report with no receipt cannot be refreshed',
  !c.refreshableContributions({ [ID_A]: contribution({ receiptToken: null }) }).length);

check('an unsent draft is offered for retry',
  c.unsentContributions({ [ID_A]: contribution({ status: 'sending', pendingDetails: 'x' }) }).length === 1);
check('a failed delivery is offered for retry',
  c.unsentContributions({ [ID_A]: contribution({ status: 'delivery_failed', pendingDetails: 'x' }) }).length === 1);
check('a submitted report is not',
  !c.unsentContributions({ [ID_A]: contribution({ status: 'submitted', pendingDetails: null }) }).length);

// --- Integration with mergeProfiles -----------------------------------------

const profileA = {
  id: 'p1', name: 'A', progress: {},
  contributions: { [ID_A]: contribution({ status: 'planned', statusUpdatedAt: 4000 }) },
};
const profileB = {
  id: 'p1', name: 'A', progress: {},
  contributions: { [ID_A]: contribution({ status: 'fixed', statusUpdatedAt: 7000 }) },
};
const mergedProfile = merge.mergeProfiles(profileA, profileB);
check('mergeProfiles carries contributions through',
  mergedProfile.contributions[ID_A].status === 'fixed',
  JSON.stringify(mergedProfile.contributions));

const bare = { id: 'p1', name: 'A', progress: {} };
const bareMerged = merge.mergeProfiles(bare, bare);
check('a profile that predates contributions merges back to no field at all',
  !('contributions' in bareMerged) || bareMerged.contributions === undefined,
  JSON.stringify(bareMerged.contributions));
check('…and no tombstone field either',
  bareMerged.forgottenContributions === undefined);

print(failures ? `\n${failures} failure(s)` : '\nall contribution tests passed');
if (failures) throw new Error(`${failures} failure(s)`);
