# venezuela-oil-news-post

Live news feed for the SEPESA newsroom page — oil & gas developments in Venezuela.

The newsroom page (hosted on cPanel) fetches `news.json` from this repo via the jsDelivr CDN and
renders it with `frontend/news-loader.js`. Publishing a new post is just a commit to this repo —
**the website is never redeployed.**

## What's here
- `news.json` — the feed (array of posts, newest first).
- `images/` — card images.
- `frontend/news-loader.js` — renders cards from `news.json`; resolves image paths to the CDN.
  Hosted at `https://cdn.jsdelivr.net/gh/marcelgerardop/venezuela-oil-news-post@main/frontend/news-loader.js`.
- `frontend/demo.html`, `frontend/INTEGRATION.md` — local preview + how to wire into the real page.
- `scripts/add-news.js` — local helper to add a post (copies image + prepends to `news.json`).
- `worker/` — **deferred** Telegram→feed automation (Cloudflare Worker). Same `news.json` format;
  deploy later via `worker/DEPLOY.md` to publish from your phone.
- `docs/` — design spec, plan, Postman references.

## Publish a post
See **PUBLISHING.md**. Short version: paste the blurb to Claude in this repo → it runs
`scripts/add-news.js` → `git push`.

## Tests
```
node --test "worker/*.test.js" "frontend/*.test.js"
```
