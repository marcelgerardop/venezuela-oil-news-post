# How to publish a news post

**Current workflow (no Telegram needed):** you paste a blurb to Claude in this repo, Claude
formats it and updates the feed, you push. The page updates automatically.

## Steps
1. Open this repo folder in Claude Code (or any Claude with file access to it).
2. Paste the news text, and give the path to an image for the card.
3. Claude writes the structured fields and runs:
   ```
   node scripts/add-news.js <fields.json> <image-source-path>
   ```
   This copies the image into `images/` and prepends the item to `news.json`.
4. Push:
   ```
   git add -A && git commit -m "news: <id>" && git push
   ```
5. (Optional, for instant refresh) open this URL once to bust the CDN cache:
   `https://purge.jsdelivr.net/gh/marcelgerardop/venezuela-oil-news-post@main/news.json`

The live site fetches `news.json` from jsDelivr and renders the cards (newest first), so no
website redeploy is ever needed — only this push.

## Doing it by hand
`scripts/add-news.js` just needs a fields JSON shaped like the items in `news.json`
(`category, dateShort, dateFull, cardTitle, articleTitle, summary, imageAlt, body[], sources[]`).
You can write that file yourself and run the script, or edit `news.json` directly.

## Later: the Telegram bot
`worker/` contains a finished Cloudflare Worker that does all of the above from a Telegram
message (photo + text) — same `news.json` format. It's deferred, not deleted; deploy it
(`worker/DEPLOY.md`) whenever you want to publish from your phone without opening the repo.
