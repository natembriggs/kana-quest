# Kanji Trail app icon

`book-trail.png` is the approved 1254 × 1254 source, generated with the built-in image generation tool and selected on 21 September 2026. Keep this high-resolution master; do not regenerate from a 512px export. The final art has ひ, カ and 字 beside a single trail continuing across an open book.

Run `python3 tools/make_icons.py` with Pillow installed to export opaque square PNGs at 180, 192 and 512 pixels and a separate maskable 512px PNG. Corners are not rounded in the files. The maskable export scales this composition to 64% and extends the indigo edge colours to the canvas edges, keeping the book inside the centred 80%-diameter safe circle. Reassess that scale if the composition changes.

For a future release:

1. Replace the source and regenerate the exports. Check all three glyphs at home-screen size and check the maskable safe circle.
2. Change the icon URL revision (`book-trail-1`) in `manifest.webmanifest`, `index.html` and `sw.js`. Chrome 144+ uses icon URLs/metadata to detect changes; replacing bytes alone is insufficient. Keep the manifest URL, scope and start URL stable.
3. Bump `APP_VERSION` and the service-worker `VERSION` together and add a changelog entry.
4. Run the app checks, commit/push and deploy with `tools/deploy-site.sh`. Its icon allowlist includes only the four runtime exports; the source and local design explorations are not Cloudflare assets.

Existing installations control when their launcher picture changes. Chrome can require the user to accept a new icon. iOS/iPadOS users may need to add the app again; save/sync progress before removing an existing installation. This does not prevent app code from updating normally.

References: [Chrome icon update behaviour](https://developer.chrome.com/blog/improvements-to-web-app-updates), [PWA metadata updates](https://web.dev/learn/pwa/update), [maskable safe zone](https://www.w3.org/TR/appmanifest/#icon-masks).
