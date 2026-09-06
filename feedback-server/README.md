# kana-quest-feedback

The Cloudflare Worker behind KanaQuest's in-app **Feedback** button. It turns a
report typed on a phone into a GitHub issue in a private inbox repository, and
reports that issue's progress back to the learner — without the browser ever
holding a GitHub credential, and without this service ever learning who the
learner is.

Design and reasoning: [`../feedback-plan.md`](../feedback-plan.md).

- **Deployed:** <https://kana-quest-feedback.natebriggs.workers.dev>
- **Inbox:** <https://github.com/natembriggs/kana-quest-feedback> (private)
- **D1:** `kana-quest-feedback` (`6b67e82a-a5e1-4123-8602-eb4c8a51c27e`, WEUR)

## Why this is a second Worker

`sync-server/` cannot read its own payload, and its broad CORS is a deliberate
part of that design: possession of the sync capability *is* the authorization
boundary. This Worker is the opposite in every respect — it validates and
formats user text, it holds a GitHub credential, and it gets a real origin
allowlist. Keeping them apart means a bug or a leaked key here cannot reach the
encrypted profile store, and the privacy promise of sync stays easy to state.

## What it stores

Per report: a receipt **hash**, a category, a GitHub issue number, a status, a
few timestamps, and a short timeline of server-chosen messages. The report text
itself is deleted from D1 the moment GitHub has it.

It never stores a learner name, profile id, progress, sync code, IP address, or
the clear receipt token. The clear receipt exists only inside the learner's
end-to-end encrypted profile, which is what makes their contribution history
follow them across devices without an account.

## Going live — the two remaining steps

The Worker is deployed and working, but it is running without a GitHub
credential and on Turnstile's public test keys. Both are one command each.

### 1. A GitHub token, so issues actually get filed

Until this is set, submissions are accepted and sit in D1 as `accepted`; the
cron sweep files every one of them within five minutes of the token appearing.
Nothing is lost in the meantime — that is what the outbox is for.

Create a **fine-grained personal access token** at
<https://github.com/settings/personal-access-tokens/new>:

- Resource owner: `natembriggs`
- Repository access: **Only select repositories** → `kana-quest-feedback`
- Permissions → Repository → **Issues: Read and write**
- Expiry: whatever you will actually remember to rotate

Then:

```bash
cd feedback-server && npx wrangler secret put GITHUB_TOKEN
```

A **GitHub App** is the better long-term shape — installation tokens expire
hourly, actions are attributed to the app rather than to you, and the
permissions are narrower than any user token can be. `src/github.js` already
supports it: register a private app with Issues read/write and Metadata read,
install it on `kana-quest-feedback` only, and set `GITHUB_APP_ID` and
`GITHUB_APP_PRIVATE_KEY` (the PKCS#1 `.pem` exactly as GitHub gives it).
`GITHUB_INSTALLATION_ID` is optional. When both are present the App wins.

### 2. A real Turnstile widget

Test keys pass every challenge, so today the only real defence against a bot
is the rate limiter and the daily counter. At
<https://dash.cloudflare.com/?to=/:account/turnstile>, add a widget for
`natembriggs.github.io`, then:

```bash
cd feedback-server && npx wrangler secret put TURNSTILE_SECRET
```

…and put the **site key** into `FEEDBACK_TURNSTILE_SITEKEY` in `src/feedback.js`
in the app. Set `TURNSTILE_HOSTNAMES = "natembriggs.github.io"` in
`wrangler.toml` at the same time so a token solved on somebody else's page is
refused.

## Secrets

| Name | Set? | What it is |
| --- | --- | --- |
| `RECEIPT_PEPPER` | ✅ | HMAC pepper for receipt hashes. Rotating it invalidates every existing receipt unless `receipt_hash_version` is used to migrate. |
| `GITHUB_WEBHOOK_SECRET` | ✅ | Shared with the repository webhook; verifies `X-Hub-Signature-256`. |
| `RELEASE_SECRET` | ✅ | Signs `POST /v1/admin/releases` and `/v1/admin/duplicate`. Also belongs in GitHub Actions secrets when release automation lands. |
| `GITHUB_TOKEN` | ❌ | See step 1 above. |
| `TURNSTILE_SECRET` | ❌ | See step 2 above. Falls back to Cloudflare's test secret. |

`npx wrangler secret list` shows what is set. Nothing here is ever logged.

## API

| Route | Auth | Purpose |
| --- | --- | --- |
| `POST /v1/feedback` | Turnstile + origin allowlist + rate limit | Accept a report. Returns `202` with a receipt; the issue is created in the background. |
| `POST /v1/feedback/status` | Receipt capability | Batch status for up to 50 reports. Unknown ids and wrong receipts are both `found: false`, so it cannot be used to enumerate. |
| `POST /v1/github/webhook` | `X-Hub-Signature-256` | Issue labels, closes and reopens become app status. |
| `POST /v1/admin/releases` | HMAC + timestamp | The only call that may say a fix is *on learners' devices*. |
| `POST /v1/admin/duplicate` | HMAC + timestamp | Link a report to the canonical one it duplicates, so release credit fans out. |
| `GET /health` | none | Liveness. |

### Firing a release by hand

The break-glass path, and the same payload the deploy workflow will eventually
send — so automating it later needs no data migration.

```bash
cd feedback-server
BODY='{"version":"2026-09-06a","credits":[{"issue":3,"message":"Your report about the placement result fixed it."}]}'
TS=$(python3 -c 'import time;print(int(time.time()*1000))')
SECRET='…'   # the RELEASE_SECRET value
SIG=$(printf '%s.%s' "$TS" "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -hex | sed 's/^.* /sha256=/')
curl -sS -X POST https://kana-quest-feedback.natebriggs.workers.dev/v1/admin/releases \
  -H "content-type: application/json" \
  -H "x-kanaquest-timestamp: $TS" \
  -H "x-kanaquest-signature: $SIG" \
  --data "$BODY"
```

Re-running an identical call is a no-op. The same version with a *different*
mapping is refused with `409 version_conflict` — a learner who has been told
their fix shipped must not be quietly untold.

## Label vocabulary

These are what a maintainer actually touches. Everything else in the tracker is
invisible to the app.

| Label | App status | Learner sees |
| --- | --- | --- |
| *(none, just created)* | `submitted` | "Thank you — it reached the team." |
| `status:reviewing` | `under_review` | "It is being looked at." |
| `status:planned` | `planned` | "This is planned." |
| `status:in-progress` | `in_progress` | "Work has started." |
| `status:not-planned` | `not_planned` | A genuine thank-you, with no promise. |
| *close as completed* | `fixed` | "Fixed, waiting for an app update." |
| *close as not planned* | `not_planned` | As above. |
| *close as duplicate* | `duplicate` | "Others asked about this too." |
| *reopen* | back to the labels | The one signal allowed to move backwards. |

`from:kanaquest-app` and `kind:*` are set by this server and should not be
edited by hand. **Issue comments never reach a learner** — they carry
shorthand, other people's details, and promises that were not meant as product
copy. To say something to a learner, move the status.

Closing an issue does **not** celebrate. Only a signed release call naming the
exact `APP_VERSION` does.

## Operating it

```bash
npx wrangler deploy                 # ship
npx wrangler tail                   # live logs (counts and outcomes only)
npx wrangler d1 migrations apply kana-quest-feedback --remote
npm test                            # 30 pure unit tests, on Node
```

The cron sweep logs one line per run: `sweep {"found":N,...}`. A run that keeps
finding work every five minutes means `waitUntil` is failing and the sweep has
become the primary path rather than the backstop — worth looking at.

**Kill switch.** To stop new submissions while leaving status reads, sync and
the webhook working, set `ACCEPTING_SUBMISSIONS = "false"` in `wrangler.toml`
and redeploy.

### Adding a staging environment

Deliberately not configured: a half-declared `[env.staging]` with a placeholder
`database_id` fails validation for the production deploy too. To add it, create
`kana-quest-feedback-staging` as both a D1 database and a private repo, then
paste back:

```toml
[env.staging]
name = "kana-quest-feedback-staging"

[env.staging.vars]
GITHUB_OWNER = "natembriggs"
GITHUB_REPO = "kana-quest-feedback-staging"
ISSUES_ARE_PUBLIC = "false"
ALLOWED_ORIGINS = "http://localhost:8000,http://127.0.0.1:8000"
TURNSTILE_HOSTNAMES = ""
TURNSTILE_SECRET_FALLBACK = "1x0000000000000000000000000000000AA"
ACCEPTING_SUBMISSIONS = "true"

[[env.staging.d1_databases]]
binding = "DB"
database_name = "kana-quest-feedback-staging"
database_id = "…"
migrations_dir = "migrations"
```

Secrets are per-environment: `npx wrangler secret put NAME --env staging`.

## Tests

`npm test` runs 30 unit tests on Node — validation, Unicode and code-point
bounds, Markdown neutralisation, the diagnostics allowlist, the issue template,
version comparison, the webhook label/close vocabulary, and both signature
schemes.

These run on Node rather than on JavaScriptCore like the app's own `test/*.js`,
because the Worker uses WebCrypto and dynamic imports that `jsc` does not have.
The *client* half of this feature is tested under `jsc` in the repository's
`test/contributions.js`, alongside everything else.
