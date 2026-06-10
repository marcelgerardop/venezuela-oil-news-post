# Telegram → Newsroom Automation — Design Spec

**Date:** 2026-06-10
**Repo:** `marcelgerardop/venezuela-oil-news-post`
**Status:** Approved design, ready for implementation plan

## Goal

Let the owner publish a news card to the SEPESA static newsroom page by sending a
Telegram message (photo + text + source URLs) to a private bot. No manual cPanel edits.

## Constraints

- The live website is **static HTML on cPanel/Apache** — it cannot run server code and is
  painful to update. We therefore **never push to cPanel**. News data lives in GitHub and is
  fetched by the browser via the jsDelivr CDN.
- The newsroom page itself is being built separately (claude.ai/design). This project produces a
  drop-in `news-loader.js` to connect later; it does **not** modify the live site.
- Owner is a non-expert; everything testable in Postman / browser before the next step.

## Locked decisions

1. **Render model:** JSON data + page-side rendering. The bot writes structured JSON; the page
   builds the card HTML. AI never emits HTML.
2. **Publish flow:** preview-then-confirm. Bot replies with extracted fields + ✅ Confirm / ❌ Cancel.
3. **Hosting:** single Cloudflare Worker (free tier, no cold starts, stable `*.workers.dev` HTTPS URL).
4. **Images:** photo is **required**. Text-only messages are rejected with a prompt to resend.

## Architecture

```
You (Telegram) --photo+text--> Cloudflare Worker --Claude Haiku 4.5--> structured JSON
                                      |                                      |
                                      | preview + Confirm/Cancel buttons <---+
                                      |  (draft stored in Cloudflare KV)
                                      v  on Confirm:
                       GitHub REST API: PUT images/<id>.jpg, PUT news.json (read-modify-write)
                                      |
                                      v
                          GET purge.jsdelivr.net (cache bust)
                                      |
   Static newsroom page (cPanel) --fetch()--> cdn.jsdelivr.net/gh/.../news.json --> renders cards
```

### Component 1 — `news.json` (the data)
Array of post objects, newest first. Each object maps to the card + article template:

```json
{
  "id": "2026-06-10-maha-capital-petrourdaneta",
  "category": "Acquisition",
  "dateShort": "Jun 2026",
  "dateFull": "June 2026",
  "cardTitle": "Maha Capital acquires 24% of PetroUrdaneta",
  "articleTitle": "Maha Capital exercises option for 24% stake in PetroUrdaneta oil field",
  "summary": "Stockholm-listed Maha Capital paid $5M to take a 24% stake in the Lake Maracaibo field.",
  "image": "images/2026-06-10-maha-capital.jpg",
  "imageAlt": "Oil field on Lake Maracaibo",
  "body": [
    { "type": "p",  "text": "..." },
    { "type": "h4", "text": "The deal" },
    { "type": "p",  "text": "..." }
  ],
  "sources": [
    { "title": "...", "url": "https://...", "publisher": "Brazil Energy Insight" }
  ]
}
```
Claude fills all fields **except** `id` and `image`, which the Worker generates/sets.

### Component 2 — `worker/worker.js` (the backend)
Single Cloudflare Worker. Two inbound update types:

**A. New message (photo + caption):**
1. Verify `X-Telegram-Bot-Api-Secret-Token` header == `TELEGRAM_SECRET_TOKEN`. Mismatch → 401.
2. Verify `message.from.id` == `OWNER_USER_ID`. Else → reply nothing, return 200.
3. No `message.photo` → reply "Please resend with a photo." return 200.
4. Call Claude Haiku 4.5 (`/v1/messages`, structured JSON output) on the caption text → fields.
5. Store draft `{fields, photoFileId, chatId}` in KV under a short id; TTL ~1h.
6. Reply with formatted preview + inline keyboard: ✅ Confirm (`callback_data=ok:<draftId>`) /
   ❌ Cancel (`cancel:<draftId>`).

**B. Callback query (button tap):**
- `ok:` → load draft from KV; `getFile`+download photo from Telegram; choose largest size <~1MB;
  PUT `images/<id>.jpg` (base64); read-modify-write `news.json` (GET sha → prepend → PUT, retry on 409);
  GET jsDelivr purge URLs for `news.json`; edit/reply "Published ✅ — live in a few seconds."; delete draft.
- `cancel:` → delete draft; reply "Discarded."

### Component 3 — `frontend/news-loader.js` + `frontend/demo.html`
`news-loader.js`: on DOMContentLoaded, `fetch()` `news.json` from jsDelivr → for each item build the
exact `<article class="card">…<template class="article-tpl">…</template></article>` markup from the
owner's pasted structure → inject into the grid container (newest first). Renders body blocks (`p`/`h4`)
and auto-numbered sources. `demo.html` is a local harness with the existing card CSS to verify rendering
without touching the live site.

## Repo layout
```
venezuela-oil-news-post/
├── news.json              # starts as []
├── images/                # post images (committed by the worker)
├── worker/
│   ├── worker.js
│   ├── wrangler.toml      # KV binding + plain vars (GITHUB_OWNER/REPO)
│   └── DEPLOY.md          # account setup, secrets, setWebhook
├── frontend/
│   ├── news-loader.js
│   └── demo.html
└── docs/
    ├── postman/           # importable test requests
    └── superpowers/specs/ # this file
```

## Secrets (Cloudflare encrypted; never in repo)
`TELEGRAM_BOT_TOKEN`, `TELEGRAM_SECRET_TOKEN`, `OWNER_USER_ID`, `ANTHROPIC_API_KEY`,
`GITHUB_TOKEN` (fine-grained PAT, Contents: read+write on this repo only).
Plain vars (`wrangler.toml`): `GITHUB_OWNER`, `GITHUB_REPO`, `GITHUB_BRANCH=main`.

## External APIs (verified)
- **Telegram:** webhook via `setWebhook` (HTTPS + `secret_token`); incoming `message.photo[]`
  (largest last), `message.caption`; `getFile` → download `file/bot<token>/<path>` (≤20MB, link ≥1h);
  `sendMessage` / `answerCallbackQuery` / inline keyboards; restrict by `message.from.id`.
- **GitHub Contents API:** `Authorization: Bearer`, `Accept: application/vnd.github+json`,
  `X-GitHub-Api-Version: 2022-11-28`. GET file → base64 content + `sha`; PUT with base64 `content` +
  `sha` (omit sha to create). 409 on stale sha → re-GET + retry. Keep files ≤~1MB.
- **jsDelivr:** serve `cdn.jsdelivr.net/gh/<owner>/<repo>@main/news.json` (CORS ok); purge via
  GET `purge.jsdelivr.net/gh/<owner>/<repo>@main/<path>` after each commit.
- **Anthropic:** `POST api.anthropic.com/v1/messages`, headers `x-api-key`, `anthropic-version: 2023-06-01`,
  `content-type`. Model `claude-opus-4-8` with `output_config.format` JSON-schema structured output
  (guarantees valid JSON for a public-facing site; cost is trivial at a few posts/day).

## Error handling
- Stale `news.json` sha → re-read + retry (≤3).
- Photo >~1MB → pick largest Telegram size under limit.
- Claude error/empty → reply "Couldn't format that, try again."; commit nothing.
- jsDelivr staleness → explicit purge after every commit.
- Non-owner / bad secret → ignored.

## Build order (each step independently testable)
1. **GitHub plumbing** — PAT + `news.json=[]`. Postman: GET file, PUT sample item, jsDelivr serves it.
2. **Telegram bot** — BotFather token + owner id. Postman: `getMe`, `sendMessage`.
3. **Frontend loader** — `news-loader.js` + `demo.html`. Browser: sample item renders as card + drawer.
4. **Worker skeleton** — deploy, `setWebhook`, owner/secret checks, echo. Test: message echoes; stranger ignored.
5. **Claude + preview** — Claude + KV + Confirm/Cancel. Test: real blurb → correct preview.
6. **Confirm → commit → purge** — end-to-end. Test: tap Confirm → card appears on demo page.

## Out of scope (YAGNI)
- Editing/deleting published posts via bot (do via GitHub directly for now).
- Multi-user / roles. Auto-translation of news to Spanish (separate i18n effort).
- Image resizing/cropping beyond size-tier selection.
```
