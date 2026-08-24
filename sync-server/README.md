# kana-quest-sync

The server half of cross-device sync — see `../sync-plan.md`. A Cloudflare
Worker, one Durable Object per synced profile, holding nothing but opaque
encrypted bytes and a version counter. It has no idea it's kana-quest: no
kana, kanji, or profile logic lives here, only compare-and-swap.

Live at `https://kana-quest-sync.natebriggs.workers.dev`.

## Setup (one-time, already done on this machine)

Node wasn't installed system-wide, so it went in via `nvm` rather than
Homebrew — no admin password needed:

```sh
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.7/install.sh | bash
# then, in a new shell:
nvm install --lts
```

Then, from this directory:

```sh
npm install
```

`wrangler login` opens a browser to authorize against the Cloudflare account.
Credentials are cached in `~/Library/Preferences/.wrangler/config/`, so this
is a one-time step per machine.

## Running it

```sh
npm run dev       # local dev server, wrangler dev
npm run deploy    # ships to kana-quest-sync.natebriggs.workers.dev
npm test          # runs test.sh against the LIVE deployment, not local dev —
                   # see the note at the top of test.sh for why
```

## Layout

| Path | What it is |
| --- | --- |
| `wrangler.toml` | Worker config: the Durable Object binding and the SQLite-backed migration that creates it |
| `src/document-store.js` | The Durable Object: GET/PUT/DELETE with conditional-request (ETag) compare-and-swap, the 4 MB size ceiling, and the 12-month sweep alarm |
| `src/index.js` | Routing (`/v1/doc/:id`, id validation) and CORS — see sync-plan.md §2.1 for why CORS is wide open |
| `test.sh` | Drives the live Worker through the full CAS lifecycle with curl |
