# Telegram → Newsroom Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the owner publish a news card to the SEPESA newsroom by sending a photo + text to a private Telegram bot, with a preview-confirm step, committing structured JSON to GitHub that a static page renders via jsDelivr.

**Architecture:** A single Cloudflare Worker receives the Telegram webhook, formats the text with Claude Haiku 4.5 into structured JSON, previews it back with Confirm/Cancel buttons (draft held in Cloudflare KV), and on confirm commits the image + a new `news.json` entry to the GitHub repo, then purges jsDelivr. The static newsroom page fetches `news.json` and builds cards client-side via `news-loader.js`.

**Tech Stack:** Cloudflare Workers + KV (wrangler), GitHub Contents REST API, Anthropic Messages API (`claude-haiku-4-5`), jsDelivr CDN, vanilla JS, Node 18+ built-in test runner for unit tests, Postman for API checks.

---

## Conventions for the engineer

- **Repo root** = `C:\Users\marce\Projects\project05-sepesa-business-plan\docs\website\venezuela-oil-news-post` (its own git repo, remote `marcelgerardop/venezuela-oil-news-post`). All paths below are relative to it.
- **Secrets never go in files.** The Anthropic key, GitHub PAT, and Telegram token live only in Cloudflare secrets. Code references `env.NAME`.
- **Owner actions** (creating tokens, running deploy commands, Postman, Telegram) are marked **[OWNER]** — pause and have the user do them, supplying the exact commands/requests.
- Node tests run with `node --test` (Node 18+, no dependencies).

---

## File structure (locked decomposition)

```
venezuela-oil-news-post/
├── news.json                  # data array; starts []
├── .gitignore                 # node_modules, .dev.vars, .wrangler
├── images/.gitkeep            # post images committed here by the worker
├── frontend/
│   ├── news-loader.js         # buildCardHTML(item) [pure] + renderNews() + auto-init
│   ├── news-loader.test.js    # Node test of buildCardHTML
│   └── demo.html              # local browser harness
├── worker/
│   ├── lib.js                 # pure helpers (no CF APIs): slug, photo pick, item build, claude prompt/parse, preview text
│   ├── lib.test.js            # Node tests for lib.js
│   ├── worker.js              # fetch handler wiring Telegram/KV/GitHub/Anthropic
│   ├── wrangler.toml          # KV binding + plain vars
│   └── DEPLOY.md              # account setup, secrets, setWebhook, rollback
└── docs/
    ├── postman/
    │   ├── github-requests.md # ready-to-paste Postman requests
    │   └── telegram-requests.md
    ├── superpowers/specs/2026-06-10-telegram-news-automation-design.md
    └── superpowers/plans/2026-06-10-telegram-news-automation.md
```

---

## Task 0: Repo scaffolding

**Files:**
- Create: `news.json`, `.gitignore`, `images/.gitkeep`, `frontend/`, `worker/`, `docs/postman/` (dirs)

- [ ] **Step 1: Create the empty data file and dirs**

`news.json`:
```json
[]
```

`.gitignore`:
```
node_modules/
.dev.vars
.wrangler/
*.log
```

`images/.gitkeep`: (empty file)

- [ ] **Step 2: Commit**

```bash
git add news.json .gitignore images/.gitkeep
git commit -m "chore: scaffold news data file and gitignore"
```

---

## Task 1: GitHub plumbing — PAT + manual data round-trip  **[OWNER]**

Proves the data layer (GitHub write + jsDelivr read) before any code depends on it.

**Files:**
- Create: `docs/postman/github-requests.md`

- [ ] **Step 1: [OWNER] Confirm repo is public**

GitHub → repo → Settings → ensure visibility is **Public** (jsDelivr only serves public repos). The news is public anyway.

- [ ] **Step 2: [OWNER] Create a fine-grained PAT**

GitHub → Settings → Developer settings → **Fine-grained tokens** → Generate new token:
- **Resource owner:** your account. **Repository access:** Only select repositories → `venezuela-oil-news-post`.
- **Permissions → Repository → Contents: Read and write.**
- Expiration: 90 days (renewable). Copy the token (starts `github_pat_…`). Keep it safe; paste into Cloudflare later, not into any file.

- [ ] **Step 3: Write the Postman request reference**

`docs/postman/github-requests.md`:
````markdown
# GitHub Contents API — Postman tests

Common headers (all requests):
```
Authorization: Bearer github_pat_YOUR_TOKEN
Accept: application/vnd.github+json
X-GitHub-Api-Version: 2022-11-28
```

## 1. GET current news.json (read content + sha)
GET https://api.github.com/repos/marcelgerardop/venezuela-oil-news-post/contents/news.json
→ Response `.content` is base64 of `[]`; copy `.sha` for the next request.

## 2. PUT a sample item into news.json (Content-Type: application/json)
PUT https://api.github.com/repos/marcelgerardop/venezuela-oil-news-post/contents/news.json
Body:
```json
{
  "message": "test: add sample news item",
  "content": "BASE64_OF_THE_ARRAY_BELOW",
  "sha": "SHA_FROM_REQUEST_1",
  "branch": "main"
}
```
Where the decoded array is:
```json
[{"id":"2026-06-10-sample","category":"Test","dateShort":"Jun 2026","dateFull":"June 2026","cardTitle":"Sample card","articleTitle":"Sample article title","summary":"This is a sample summary.","image":"images/placeholder.jpg","imageAlt":"placeholder","body":[{"type":"p","text":"Body paragraph."}],"sources":[{"title":"Example","url":"https://example.com","publisher":"Example"}]}]
```
Base64-encode that array (Postman: use an online base64 encoder or the pre-encoded value the implementer provides).
Expect **200 OK**.

## 3. Verify jsDelivr serves it (browser or Postman GET)
GET https://cdn.jsdelivr.net/gh/marcelgerardop/venezuela-oil-news-post@main/news.json
(may take a moment first time). To force-refresh after later commits:
GET https://purge.jsdelivr.net/gh/marcelgerardop/venezuela-oil-news-post@main/news.json
````

- [ ] **Step 4: [OWNER] Run requests 1–3 in Postman**

Expected: GET returns base64 of `[]`; PUT returns 200; jsDelivr GET returns the sample array (after a purge if cached).

- [ ] **Step 5: [OWNER] Reset news.json back to `[]`**

Re-run the PUT with `content` = base64 of `[]` and the new `sha` (from the PUT response). Confirms the read-modify-write loop works both ways. Then GET the purge URL.

- [ ] **Step 6: Commit the reference**

```bash
git add docs/postman/github-requests.md
git commit -m "docs: add GitHub Postman request reference"
```

---

## Task 2: Telegram bot creation  **[OWNER]**

**Files:**
- Create: `docs/postman/telegram-requests.md`

- [ ] **Step 1: [OWNER] Create the bot**

In Telegram, message **@BotFather** → `/newbot` → give a name → give a username ending in `bot`. Copy the **bot token** (`123456:ABC…`).

- [ ] **Step 2: [OWNER] Get your numeric user id**

Message **@userinfobot** → it replies with your `Id` (a number like `987654321`). This is `OWNER_USER_ID`.

- [ ] **Step 3: [OWNER] Choose a webhook secret token**

Invent a random string (16–64 chars, `A-Za-z0-9_-` only), e.g. `sepesa_news_8f3kд...` — actually only ASCII: `sepesa_news_8f3k2zQ9xL`. This is `TELEGRAM_SECRET_TOKEN`. Save all three values (bot token, owner id, secret) in your password manager.

- [ ] **Step 4: Write the Telegram Postman reference**

`docs/postman/telegram-requests.md`:
````markdown
# Telegram Bot API — Postman tests
Base: https://api.telegram.org/bot<BOT_TOKEN>/<METHOD>

## getMe — verify token
GET https://api.telegram.org/bot<BOT_TOKEN>/getMe
→ `{ ok: true, result: { username: ... } }`

## sendMessage — send yourself a message
POST https://api.telegram.org/bot<BOT_TOKEN>/sendMessage
Content-Type: application/json
{ "chat_id": <OWNER_USER_ID>, "text": "Test from Postman" }
→ you receive the message in Telegram.

## (after Worker deploy) setWebhook
POST https://api.telegram.org/bot<BOT_TOKEN>/setWebhook
Content-Type: application/json
{ "url": "https://YOUR-WORKER.workers.dev", "secret_token": "<TELEGRAM_SECRET_TOKEN>" }

## getWebhookInfo — debug
GET https://api.telegram.org/bot<BOT_TOKEN>/getWebhookInfo
## deleteWebhook — reset
GET https://api.telegram.org/bot<BOT_TOKEN>/deleteWebhook
````

- [ ] **Step 5: [OWNER] Run getMe + sendMessage in Postman**

Expected: getMe `ok:true`; you receive "Test from Postman" in Telegram.

- [ ] **Step 6: Commit**

```bash
git add docs/postman/telegram-requests.md
git commit -m "docs: add Telegram Postman request reference"
```

---

## Task 3: Frontend loader (renders cards from news.json)

Build and unit-test the pure card builder, then a browser demo. Independent of the backend.

**Files:**
- Create: `frontend/news-loader.js`, `frontend/news-loader.test.js`, `frontend/demo.html`

- [ ] **Step 1: Write the failing test**

`frontend/news-loader.test.js`:
```js
const test = require('node:test');
const assert = require('node:assert');
const { buildCardHTML } = require('./news-loader.js');

const item = {
  id: '2026-06-10-maha', category: 'Acquisition',
  dateShort: 'Jun 2026', dateFull: 'June 2026',
  cardTitle: 'Maha buys 24%', articleTitle: 'Maha Capital exercises option',
  summary: 'Short summary.', image: 'images/maha.jpg', imageAlt: 'rig',
  body: [{ type: 'p', text: 'Para one.' }, { type: 'h4', text: 'The deal' }, { type: 'p', text: 'Para two.' }],
  sources: [{ title: 'Src', url: 'https://e.com', publisher: 'Pub' }],
};

test('card shows card-level fields', () => {
  const html = buildCardHTML(item);
  assert.match(html, /class="card"/);
  assert.match(html, /images\/maha\.jpg/);
  assert.match(html, /Maha buys 24%/);          // cardTitle in <h3>
  assert.match(html, /Short summary\./);
  assert.match(html, /Jun 2026/);
});

test('template holds article-level content', () => {
  const html = buildCardHTML(item);
  assert.match(html, /<template class="article-tpl">/);
  assert.match(html, /Maha Capital exercises option/); // articleTitle in <h1>
  assert.match(html, /<h4>The deal<\/h4>/);
  assert.match(html, /Para two\./);
  assert.match(html, /href="https:\/\/e\.com"/);
  assert.match(html, /June 2026/);
});

test('escapes HTML in text fields', () => {
  const html = buildCardHTML({ ...item, summary: 'A <script>x</script> & "q"' });
  assert.doesNotMatch(html, /<script>x<\/script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&amp;/);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test frontend/`
Expected: FAIL — `Cannot find module './news-loader.js'` / `buildCardHTML is not a function`.

- [ ] **Step 3: Implement `news-loader.js`**

`frontend/news-loader.js`:
```js
// Renders SEPESA newsroom cards from news.json.
// Pure builder buildCardHTML(item) is unit-tested in Node and reused in the browser.
(function (root) {
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function escAttr(s) { return esc(s); }

  function bodyHTML(blocks) {
    return (blocks || []).map(function (b) {
      if (b.type === 'h4') return '<h4>' + esc(b.text) + '</h4>';
      return '<p>' + esc(b.text) + '</p>';
    }).join('\n        ');
  }

  function sourcesHTML(sources) {
    if (!sources || !sources.length) return '';
    var lis = sources.map(function (s) {
      return '<li>\n            <a href="' + escAttr(s.url) + '" target="_blank" rel="noopener">' +
        esc(s.title) + '</a>\n            <span class="src-pub">' + esc(s.publisher) + '</span>\n          </li>';
    }).join('\n          ');
    return '\n      <div class="article-sources-wrap">\n        <h4>Sources &amp; further reading</h4>\n' +
      '        <ol class="article-sources">\n          ' + lis + '\n        </ol>\n      </div>';
  }

  function buildCardHTML(item) {
    return '' +
'<article class="card" data-article tabindex="0" role="button" aria-haspopup="dialog">\n' +
'  <div class="card-media">\n' +
'    <img src="' + escAttr(item.image) + '" alt="' + escAttr(item.imageAlt) + '">\n' +
'  </div>\n' +
'  <div class="card-body">\n' +
'    <div class="news-meta">\n' +
'      <span>' + esc(item.category) + '</span>\n' +
'      <span class="dot"></span>\n' +
'      <span class="date">' + esc(item.dateShort) + '</span>\n' +
'    </div>\n' +
'    <h3>' + esc(item.cardTitle) + '</h3>\n' +
'    <p>' + esc(item.summary) + '</p>\n' +
'    <span class="cta">Read more <span class="ar"></span></span>\n' +
'  </div>\n' +
'  <template class="article-tpl">\n' +
'    <img class="article-hero" src="' + escAttr(item.image) + '" alt="' + escAttr(item.imageAlt) + '">\n' +
'    <div class="article-inner">\n' +
'      <div class="article-meta news-meta">\n' +
'        <span>' + esc(item.category) + '</span>\n' +
'        <span class="dot"></span>\n' +
'        <span class="date">' + esc(item.dateFull) + '</span>\n' +
'      </div>\n' +
'      <h1 class="article-title">' + esc(item.articleTitle) + '</h1>\n' +
'      <div class="article-prose">\n        ' + bodyHTML(item.body) + '\n      </div>' +
sourcesHTML(item.sources) + '\n' +
'    </div>\n' +
'  </template>\n' +
'</article>';
  }

  // Browser: fetch news.json and inject into a grid container.
  function renderNews(container, items) {
    container.innerHTML = (items || []).map(buildCardHTML).join('\n');
  }

  async function init(opts) {
    opts = opts || {};
    var url = opts.url || 'https://cdn.jsdelivr.net/gh/marcelgerardop/venezuela-oil-news-post@main/news.json';
    var selector = opts.selector || '[data-news-grid]';
    var container = document.querySelector(selector);
    if (!container) return;
    try {
      var res = await fetch(url, { cache: 'no-store' });
      var items = await res.json();
      renderNews(container, items);
      if (typeof opts.onRendered === 'function') opts.onRendered(container, items);
    } catch (e) {
      console.error('news-loader: failed to load news', e);
    }
  }

  var api = { buildCardHTML: buildCardHTML, renderNews: renderNews, init: init };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; // Node test
  if (root) { root.SepesaNews = api; }                                       // Browser
  if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', function () {
      if (document.querySelector('[data-news-grid]')) init();
    });
  }
})(typeof window !== 'undefined' ? window : null);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test frontend/`
Expected: PASS (3 tests).

- [ ] **Step 5: Build the browser demo**

`frontend/demo.html`:
```html
<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>News loader demo</title>
<style>
  body { font: 16px/1.5 system-ui; margin: 2rem; background:#0f1115; color:#e8e8e8; }
  [data-news-grid] { display:grid; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); gap:1rem; }
  .card { background:#1a1d24; border:1px solid #2a2f3a; border-radius:12px; overflow:hidden; cursor:pointer; }
  .card-media img { width:100%; height:160px; object-fit:cover; display:block; }
  .card-body { padding:1rem; }
  .news-meta { display:flex; align-items:center; gap:.5rem; font-size:.8rem; color:#9aa4b2; }
  .dot { width:4px; height:4px; border-radius:50%; background:#9aa4b2; display:inline-block; }
  .card h3 { margin:.5rem 0; } .cta { color:#e8843a; font-size:.85rem; }
  .reader { position:fixed; inset:0; background:#0f1115; overflow:auto; padding:2rem; display:none; }
  .reader.open { display:block; } .article-hero { width:100%; max-height:340px; object-fit:cover; border-radius:12px; }
  .article-inner { max-width:720px; margin:1.5rem auto; } .src-pub { color:#9aa4b2; margin-left:.5rem; }
  .close { position:fixed; top:1rem; right:1rem; font-size:1.5rem; background:#1a1d24; border:0; color:#fff; border-radius:8px; padding:.3rem .7rem; cursor:pointer; }
</style></head>
<body>
  <h1>SEPESA newsroom — loader demo</h1>
  <p>Renders from <code>frontend/sample-news.json</code> (set in the script below).</p>
  <div data-news-grid></div>
  <div class="reader"><button class="close">×</button><div class="reader-body"></div></div>

  <script src="news-loader.js"></script>
  <script>
    // Local sample (so the demo works offline, no CDN needed).
    var sample = [{
      id:'2026-06-10-maha', category:'Acquisition', dateShort:'Jun 2026', dateFull:'June 2026',
      cardTitle:'Maha Capital acquires 24% of PetroUrdaneta',
      articleTitle:'Maha Capital exercises option for 24% stake in PetroUrdaneta oil field',
      summary:'Stockholm-listed Maha Capital paid $5M to take a 24% stake in the Lake Maracaibo field.',
      image:'https://picsum.photos/seed/oil/640/360', imageAlt:'Oil field',
      body:[{type:'p',text:'Maha Capital, controlled by Starboard, exercised its option.'},
            {type:'h4',text:'The deal'},{type:'p',text:'Paid $5M, total $10M, taking over Novonor’s stake.'}],
      sources:[{title:'Maha Capital buys stake',url:'https://brazilenergyinsight.com',publisher:'Brazil Energy Insight'}]
    }];
    var grid = document.querySelector('[data-news-grid]');
    SepesaNews.renderNews(grid, sample);

    // Minimal drawer behavior to prove the <template> content works (the real page has its own).
    var reader = document.querySelector('.reader'), rbody = document.querySelector('.reader-body');
    grid.addEventListener('click', function (e) {
      var card = e.target.closest('.card'); if (!card) return;
      var tpl = card.querySelector('template.article-tpl');
      rbody.innerHTML = ''; rbody.appendChild(tpl.content.cloneNode(true));
      reader.classList.add('open');
    });
    document.querySelector('.close').addEventListener('click', function(){ reader.classList.remove('open'); });
  </script>
</body></html>
```

- [ ] **Step 6: [OWNER] Open the demo in a browser**

Open `frontend/demo.html` (double-click). Expected: one card renders; clicking it opens a reader showing the full article (hero image, h1, "The deal" subheading, two paragraphs, numbered source). This proves the loader builds your exact template structure.

- [ ] **Step 7: Commit**

```bash
git add frontend/news-loader.js frontend/news-loader.test.js frontend/demo.html
git commit -m "feat: news-loader renders cards from news.json + browser demo"
```

---

## Task 4: Worker skeleton — webhook, auth, echo

Deploy a minimal Worker that authenticates Telegram + owner and echoes messages. No Claude/GitHub yet.

**Files:**
- Create: `worker/lib.js`, `worker/lib.test.js`, `worker/worker.js`, `worker/wrangler.toml`, `worker/DEPLOY.md`

- [ ] **Step 1: Write failing tests for lib helpers**

`worker/lib.test.js`:
```js
const test = require('node:test');
const assert = require('node:assert');
const { slugify, selectPhoto, buildNewsItem } = require('./lib.js');

test('slugify makes a dated kebab id', () => {
  assert.equal(slugify('Maha Capital Buys 24%!', '2026-06-10'),
    '2026-06-10-maha-capital-buys-24');
});

test('selectPhoto picks largest under the byte cap', () => {
  const photos = [
    { file_id: 'a', file_size: 5000, width: 90 },
    { file_id: 'b', file_size: 400000, width: 800 },
    { file_id: 'c', file_size: 1500000, width: 1280 },
  ];
  assert.equal(selectPhoto(photos, 1000000).file_id, 'b'); // c is over cap
});

test('selectPhoto falls back to smallest if all over cap', () => {
  const photos = [{ file_id: 'a', file_size: 2000000 }, { file_id: 'b', file_size: 3000000 }];
  assert.equal(selectPhoto(photos, 1000000).file_id, 'a');
});

test('buildNewsItem merges fields with id + image path', () => {
  const fields = { category:'X', dateShort:'Jun 2026', dateFull:'June 2026',
    cardTitle:'c', articleTitle:'a', summary:'s', imageAlt:'alt',
    body:[{type:'p',text:'t'}], sources:[] };
  const item = buildNewsItem(fields, '2026-06-10-x', 'images/2026-06-10-x.jpg');
  assert.equal(item.id, '2026-06-10-x');
  assert.equal(item.image, 'images/2026-06-10-x.jpg');
  assert.equal(item.cardTitle, 'c');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test worker/`
Expected: FAIL — cannot find `./lib.js`.

- [ ] **Step 3: Implement `worker/lib.js` (pure helpers)**

`worker/lib.js`:
```js
// Pure, environment-agnostic helpers for the news worker. Unit-tested with `node --test`.

function slugify(text, dateISO) {
  const base = String(text || 'post').toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')        // drop punctuation
    .trim().replace(/\s+/g, '-')
    .replace(/-+/g, '-').replace(/^-|-$/g, '')
    .split('-').slice(0, 6).join('-');   // cap length
  return dateISO + '-' + (base || 'post');
}

// Telegram photo[] is smallest→largest. Pick the largest whose file_size <= cap.
function selectPhoto(photos, capBytes) {
  if (!photos || !photos.length) return null;
  const sorted = [...photos].sort((a, b) => (a.file_size || 0) - (b.file_size || 0));
  let chosen = sorted[0]; // fallback: smallest
  for (const p of sorted) { if ((p.file_size || 0) <= capBytes) chosen = p; }
  return chosen;
}

function buildNewsItem(fields, id, imagePath) {
  return {
    id,
    category: fields.category,
    dateShort: fields.dateShort,
    dateFull: fields.dateFull,
    cardTitle: fields.cardTitle,
    articleTitle: fields.articleTitle,
    summary: fields.summary,
    image: imagePath,
    imageAlt: fields.imageAlt || fields.cardTitle,
    body: fields.body || [],
    sources: fields.sources || [],
  };
}

module.exports = { slugify, selectPhoto, buildNewsItem };
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test worker/`
Expected: PASS (4 tests).

- [ ] **Step 5: Write the Worker skeleton**

`worker/worker.js`:
```js
// Cloudflare Worker: Telegram → (Claude → preview → confirm) → GitHub. Skeleton stage: auth + echo.
const TG = (token, method) => `https://api.telegram.org/bot${token}/${method}`;

async function tgSend(env, chatId, text, extra = {}) {
  await fetch(TG(env.TELEGRAM_BOT_TOKEN, 'sendMessage'), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, ...extra }),
  });
}

export default {
  async fetch(request, env) {
    if (request.method !== 'POST') return new Response('ok'); // health check / GET in browser
    // 1. Verify the request really came from Telegram.
    const secret = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
    if (secret !== env.TELEGRAM_SECRET_TOKEN) return new Response('forbidden', { status: 401 });

    let update;
    try { update = await request.json(); } catch { return new Response('bad json', { status: 400 }); }

    const msg = update.message;
    if (msg) {
      // 2. Only the owner may use the bot.
      if (String(msg.from && msg.from.id) !== String(env.OWNER_USER_ID)) {
        return new Response('ok'); // silently ignore others
      }
      // Skeleton behavior: echo back what we got.
      const hasPhoto = Array.isArray(msg.photo) && msg.photo.length > 0;
      const text = msg.caption || msg.text || '';
      await tgSend(env, msg.chat.id, `echo: ${hasPhoto ? '[photo] ' : ''}${text}`);
    }
    return new Response('ok'); // always 200 so Telegram doesn't retry
  },
};
```

- [ ] **Step 6: Write `wrangler.toml`**

`worker/wrangler.toml`:
```toml
name = "sepesa-news-bot"
main = "worker.js"
compatibility_date = "2025-01-01"

# Plain (non-secret) vars:
[vars]
GITHUB_OWNER = "marcelgerardop"
GITHUB_REPO = "venezuela-oil-news-post"
GITHUB_BRANCH = "main"

# KV namespace for pending drafts (id filled in DEPLOY.md step).
[[kv_namespaces]]
binding = "DRAFTS"
id = "REPLACE_WITH_KV_ID"
```

- [ ] **Step 7: Write `DEPLOY.md`**

`worker/DEPLOY.md`:
````markdown
# Deploying the SEPESA news Worker

## One-time setup
1. Install Node 18+ and wrangler: `npm install -g wrangler`
2. Log in: `wrangler login` (opens browser, authorize).
3. Create the KV namespace:
   `wrangler kv namespace create DRAFTS`
   Copy the printed `id` into `wrangler.toml` → `[[kv_namespaces]] id`.
4. Set secrets (run each, paste the value when prompted — values never go in files):
   ```
   wrangler secret put TELEGRAM_BOT_TOKEN
   wrangler secret put TELEGRAM_SECRET_TOKEN
   wrangler secret put OWNER_USER_ID
   wrangler secret put ANTHROPIC_API_KEY
   wrangler secret put GITHUB_TOKEN
   ```

## Deploy
From `worker/`: `wrangler deploy`
Note the printed URL, e.g. `https://sepesa-news-bot.<subdomain>.workers.dev`.

## Register the webhook (once, and after URL changes)
POST (Postman) https://api.telegram.org/bot<BOT_TOKEN>/setWebhook
```json
{ "url": "https://sepesa-news-bot.<subdomain>.workers.dev", "secret_token": "<TELEGRAM_SECRET_TOKEN>" }
```
Check: GET .../getWebhookInfo → `url` set, `last_error_message` empty.

## Logs / debug
`wrangler tail` streams live logs while you message the bot.

## Rollback
`wrangler deployments list` then `wrangler rollback [id]`. To stop the bot entirely:
GET https://api.telegram.org/bot<BOT_TOKEN>/deleteWebhook
````

- [ ] **Step 8: [OWNER] Deploy + set secrets + webhook**

Follow `DEPLOY.md` steps 1–4, `wrangler deploy`, then `setWebhook` in Postman. (KV id is real now; `ANTHROPIC_API_KEY`/`GITHUB_TOKEN` are set even though unused this task — fine.)

- [ ] **Step 9: [OWNER] Test echo + access control**

- Message your bot any text → it replies `echo: <text>`.
- Send a photo with caption → replies `echo: [photo] <caption>`.
- (Optional) Have a friend message the bot → no reply (owner-only).
- Run `wrangler tail` to watch requests if anything misbehaves.

- [ ] **Step 10: Commit**

```bash
git add worker/lib.js worker/lib.test.js worker/worker.js worker/wrangler.toml worker/DEPLOY.md
git commit -m "feat: worker skeleton with Telegram auth + echo, KV config, deploy docs"
```

---

## Task 5: Claude formatting + preview + Confirm/Cancel buttons

Add the Claude call (strict JSON), store the draft in KV, and reply with a preview + inline keyboard. Still no GitHub write.

**Files:**
- Modify: `worker/lib.js` (add `claudeMessages`, `parseClaudeJSON`, `validateFields`, `previewText`)
- Modify: `worker/lib.test.js` (add tests)
- Modify: `worker/worker.js` (call Claude, store draft, preview)

- [ ] **Step 1: Add failing tests for the new helpers**

Append to `worker/lib.test.js`:
```js
const { parseClaudeJSON, validateFields, previewText, claudeMessages } = require('./lib.js');

test('parseClaudeJSON strips code fences and parses', () => {
  const raw = '```json\n{"category":"X","body":[]}\n```';
  assert.deepEqual(parseClaudeJSON(raw), { category: 'X', body: [] });
});

test('validateFields rejects missing required keys', () => {
  assert.throws(() => validateFields({ category: 'X' }), /missing/i);
});

test('validateFields passes a complete object', () => {
  const f = { category:'X', dateShort:'Jun 2026', dateFull:'June 2026', cardTitle:'c',
    articleTitle:'a', summary:'s', body:[{type:'p',text:'t'}], sources:[] };
  assert.equal(validateFields(f), true);
});

test('previewText summarizes the draft for Telegram', () => {
  const f = { category:'Acquisition', dateFull:'June 2026', cardTitle:'Card', articleTitle:'Art',
    summary:'Sum', body:[{type:'p',text:'a'},{type:'h4',text:'b'}], sources:[{title:'S',url:'u',publisher:'P'}] };
  const t = previewText(f);
  assert.match(t, /Acquisition/); assert.match(t, /Card/); assert.match(t, /1 source/);
});

test('claudeMessages builds a valid request body', () => {
  const body = claudeMessages('some news text');
  assert.equal(body.model, 'claude-haiku-4-5');
  assert.ok(body.max_tokens > 0);
  assert.match(JSON.stringify(body.messages), /some news text/);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test worker/`
Expected: FAIL — the new functions are undefined.

- [ ] **Step 3: Implement the helpers in `worker/lib.js`**

Append to `worker/lib.js` (before `module.exports`, then extend exports):
```js
const REQUIRED = ['category','dateShort','dateFull','cardTitle','articleTitle','summary','body'];

const CLAUDE_SYSTEM =
  'You convert a raw oil & gas news blurb (about Venezuela) into a structured news card for a ' +
  'corporate newsroom. Output ONLY valid minified JSON, no prose, no code fences. Schema: ' +
  '{"category":string (1-2 words, e.g. Acquisition, Field, Sanctions, Alliance),' +
  '"dateShort":string ("Mon YYYY"),"dateFull":string ("Month YYYY"),' +
  '"cardTitle":string (<=60 chars),"articleTitle":string,"summary":string (1-2 sentences),' +
  '"imageAlt":string,"body":[{"type":"p"|"h4","text":string}],' +
  '"sources":[{"title":string,"url":string,"publisher":string}]}. ' +
  'Use any URLs in the input as sources (publisher = the site name). Keep facts faithful; do not invent. ' +
  'If no date is given, use the current month/year provided.';

function claudeMessages(newsText, monthYear) {
  const dateHint = monthYear ? ` Current month/year if none stated: ${monthYear}.` : '';
  return {
    model: 'claude-haiku-4-5',
    max_tokens: 1500,
    system: CLAUDE_SYSTEM + dateHint,
    messages: [{ role: 'user', content: newsText }],
  };
}

function parseClaudeJSON(raw) {
  let s = String(raw || '').trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  return JSON.parse(s);
}

function validateFields(f) {
  if (!f || typeof f !== 'object') throw new Error('not an object');
  for (const k of REQUIRED) {
    if (f[k] === undefined || f[k] === null || f[k] === '') throw new Error('missing field: ' + k);
  }
  if (!Array.isArray(f.body)) throw new Error('missing field: body array');
  return true;
}

function previewText(f) {
  const n = (f.sources || []).length;
  const paras = (f.body || []).filter(b => b.type === 'p').length;
  return [
    '📰 PREVIEW — confirm to publish',
    '',
    'Category: ' + f.category,
    'Date: ' + f.dateFull,
    '',
    'Card title: ' + f.cardTitle,
    'Article title: ' + f.articleTitle,
    '',
    'Summary: ' + f.summary,
    '',
    `Body: ${paras} paragraph(s) · ${n} source${n === 1 ? '' : 's'}`,
  ].join('\n');
}
```
And change the export line to:
```js
module.exports = { slugify, selectPhoto, buildNewsItem, claudeMessages, parseClaudeJSON, validateFields, previewText };
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test worker/`
Expected: PASS (all lib tests, including Task 4's).

- [ ] **Step 5: Confirm Anthropic API call shape**

Invoke the `claude-api` skill and confirm: endpoint `POST https://api.anthropic.com/v1/messages`; headers `x-api-key`, `anthropic-version: 2023-06-01`, `content-type: application/json`; request body uses `system` + `messages`; response text is at `response.content[0].text`. Adjust `callClaude` below if the skill says otherwise.

- [ ] **Step 6: Wire Claude + KV + preview into `worker.js`**

Replace the body of the `if (msg) { … }` block in `worker/worker.js` with:
```js
    if (msg) {
      if (String(msg.from && msg.from.id) !== String(env.OWNER_USER_ID)) return new Response('ok');

      const hasPhoto = Array.isArray(msg.photo) && msg.photo.length > 0;
      const text = (msg.caption || msg.text || '').trim();

      if (!hasPhoto) { await tgSend(env, msg.chat.id, '📷 Please resend with a photo attached.'); return new Response('ok'); }
      if (!text) { await tgSend(env, msg.chat.id, '✍️ Add the news text as the photo caption.'); return new Response('ok'); }

      let fields;
      try {
        const raw = await callClaude(env, text);
        fields = parseClaudeJSON(raw);
        validateFields(fields);
      } catch (e) {
        await tgSend(env, msg.chat.id, '⚠️ Couldn’t format that, please try again.\n(' + e.message + ')');
        return new Response('ok');
      }

      // Store the draft (fields + the chosen photo file_id) in KV for the confirm step.
      const photo = selectPhoto(msg.photo, 1000000);
      const draftId = String(update.update_id);
      await env.DRAFTS.put('draft:' + draftId,
        JSON.stringify({ fields, photoFileId: photo.file_id, chatId: msg.chat.id }),
        { expirationTtl: 3600 });

      await tgSend(env, msg.chat.id, previewText(fields), {
        reply_markup: { inline_keyboard: [[
          { text: '✅ Confirm', callback_data: 'ok:' + draftId },
          { text: '❌ Cancel', callback_data: 'cancel:' + draftId },
        ]] },
      });
      return new Response('ok');
    }
```
Add imports at top of `worker.js` (Workers support ESM import from a sibling module):
```js
import { selectPhoto, parseClaudeJSON, validateFields, previewText } from './lib.js';
```
Add `claudeMessages` to the top import line:
```js
import { selectPhoto, parseClaudeJSON, validateFields, previewText, claudeMessages } from './lib.js';
```
And add the Claude caller near `tgSend`:
```js
async function callClaude(env, newsText) {
  const monthYear = new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' });
  const reqBody = claudeMessages(newsText, monthYear); // prompt/schema lives in lib.js
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify(reqBody),
  });
  if (!res.ok) throw new Error('claude ' + res.status);
  const data = await res.json();
  return data.content && data.content[0] && data.content[0].text;
}
```

- [ ] **Step 7: [OWNER] Redeploy + test preview**

`wrangler deploy`. Then in Telegram send the bot **a photo + this caption**: the Maha Capital blurb. Expected: bot replies with a PREVIEW block (category, dates, titles, summary, "N paragraphs · M sources") and two buttons. Tapping them does nothing yet (next task). Send text with **no photo** → "Please resend with a photo." Use `wrangler tail` to see Claude errors if the preview fails.

- [ ] **Step 8: Commit**

```bash
git add worker/lib.js worker/lib.test.js worker/worker.js
git commit -m "feat: Claude formatting + KV draft + preview with confirm/cancel buttons"
```

---

## Task 6: Confirm → commit image + news.json → purge jsDelivr

Handle the button tap: download photo, commit image + prepend news item (read-modify-write with 409 retry), purge jsDelivr, reply.

**Files:**
- Modify: `worker/worker.js` (handle `update.callback_query`; add GitHub helpers)

- [ ] **Step 1: Add GitHub + photo helpers to `worker.js`**

Add near the other helpers in `worker/worker.js`:
```js
const GH_API = 'https://api.github.com';
const ghHeaders = (env) => ({
  'Authorization': 'Bearer ' + env.GITHUB_TOKEN,
  'Accept': 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'sepesa-news-bot',
});

function bytesToBase64(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
const strToBase64 = (s) => btoa(unescape(encodeURIComponent(s)));
const base64ToStr = (b) => decodeURIComponent(escape(atob(b)));

async function ghGetFile(env, path) {
  const url = `${GH_API}/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${path}?ref=${env.GITHUB_BRANCH}`;
  const res = await fetch(url, { headers: ghHeaders(env) });
  if (res.status === 404) return { sha: null, content: null };
  if (!res.ok) throw new Error('gh get ' + res.status);
  const data = await res.json();
  return { sha: data.sha, content: base64ToStr(data.content.replace(/\n/g, '')) };
}

async function ghPutFile(env, path, base64Content, message, sha) {
  const url = `${GH_API}/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${path}`;
  const body = { message, content: base64Content, branch: env.GITHUB_BRANCH };
  if (sha) body.sha = sha;
  const res = await fetch(url, { method: 'PUT', headers: { ...ghHeaders(env), 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return res;
}

// Download the Telegram photo bytes via getFile → file endpoint.
async function tgDownloadPhoto(env, fileId) {
  const r = await fetch(TG(env.TELEGRAM_BOT_TOKEN, 'getFile') + '?file_id=' + encodeURIComponent(fileId));
  const j = await r.json();
  if (!j.ok) throw new Error('getFile failed');
  const filePath = j.result.file_path;
  const dl = await fetch(`https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${filePath}`);
  return await dl.arrayBuffer();
}

async function purgeJsdelivr(env, path) {
  try { await fetch(`https://purge.jsdelivr.net/gh/${env.GITHUB_OWNER}/${env.GITHUB_REPO}@${env.GITHUB_BRANCH}/${path}`); } catch (_) {}
}

// Prepend item to news.json with optimistic-concurrency retry on 409.
async function commitNewsItem(env, item) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { sha, content } = await ghGetFile(env, 'news.json');
    let arr = [];
    if (content) { try { arr = JSON.parse(content); } catch { arr = []; } }
    arr.unshift(item);
    const res = await ghPutFile(env, 'news.json', strToBase64(JSON.stringify(arr, null, 2)),
      'feat: add news ' + item.id, sha);
    if (res.ok) return true;
    if (res.status === 409) continue; // stale sha, retry
    throw new Error('news.json PUT ' + res.status);
  }
  throw new Error('news.json conflict after retries');
}
```

- [ ] **Step 2: Handle the callback query**

In `worker/worker.js`, after the `if (msg) { … }` block and before `return new Response('ok')`, add:
```js
    const cb = update.callback_query;
    if (cb) {
      if (String(cb.from && cb.from.id) !== String(env.OWNER_USER_ID)) return new Response('ok');
      // Acknowledge the tap so Telegram stops the loading spinner.
      await fetch(TG(env.TELEGRAM_BOT_TOKEN, 'answerCallbackQuery'), {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ callback_query_id: cb.id }),
      });

      const [action, draftId] = String(cb.data || '').split(':');
      const chatId = cb.message.chat.id;
      const key = 'draft:' + draftId;
      const stored = await env.DRAFTS.get(key);

      if (!stored) { await tgSend(env, chatId, '⌛ That draft expired. Please resend.'); return new Response('ok'); }
      if (action === 'cancel') { await env.DRAFTS.delete(key); await tgSend(env, chatId, '🗑️ Discarded.'); return new Response('ok'); }

      if (action === 'ok') {
        try {
          const { fields, photoFileId } = JSON.parse(stored);
          const dateISO = new Date().toISOString().slice(0, 10);
          const id = slugify(fields.cardTitle, dateISO);
          const imagePath = 'images/' + id + '.jpg';

          // 1. Commit the image.
          const imgBuf = await tgDownloadPhoto(env, photoFileId);
          const imgRes = await ghPutFile(env, imagePath, bytesToBase64(imgBuf), 'feat: image ' + id, null);
          if (!imgRes.ok && imgRes.status !== 422) throw new Error('image PUT ' + imgRes.status); // 422 = already exists

          // 2. Commit the news item.
          const item = buildNewsItem(fields, id, imagePath);
          await commitNewsItem(env, item);

          // 3. Bust the CDN cache.
          await purgeJsdelivr(env, 'news.json');
          await purgeJsdelivr(env, imagePath);

          await env.DRAFTS.delete(key);
          await tgSend(env, chatId, '✅ Published — live on the site in a few seconds.');
        } catch (e) {
          await tgSend(env, chatId, '❌ Publish failed: ' + e.message + '\nNothing was committed if this was early; check the repo.');
        }
        return new Response('ok');
      }
    }
```
Update the top import to include `slugify` and `buildNewsItem`:
```js
import { selectPhoto, parseClaudeJSON, validateFields, previewText, slugify, buildNewsItem } from './lib.js';
```

- [ ] **Step 3: [OWNER] Redeploy + full end-to-end test**

`wrangler deploy`. In Telegram: send a photo + the Maha Capital caption → get the preview → tap **✅ Confirm**. Expected: "Published ✅". Then:
- Check the repo: `news.json` has the new item at index 0; `images/<id>.jpg` exists.
- GET `https://cdn.jsdelivr.net/gh/marcelgerardop/venezuela-oil-news-post@main/news.json` (purge already triggered) → shows the item.
- Send another and tap **❌ Cancel** → "Discarded", nothing committed.
Watch `wrangler tail` if anything errors.

- [ ] **Step 4: [OWNER] Verify it renders**

Edit `frontend/demo.html` temporarily: replace the inline `sample` with a real fetch —
```js
SepesaNews.init({ url: 'https://cdn.jsdelivr.net/gh/marcelgerardop/venezuela-oil-news-post@main/news.json', selector: '[data-news-grid]' });
```
Open in browser → your published card appears and opens. Revert the demo edit after (keep the offline sample for repeatable tests).

- [ ] **Step 5: Commit**

```bash
git add worker/worker.js
git commit -m "feat: confirm flow commits image + news.json with retry, purges jsDelivr"
```

---

## Task 7: Connect to the real newsroom page (handoff)

**Files:**
- Create: `frontend/INTEGRATION.md`

- [ ] **Step 1: Write integration instructions**

`frontend/INTEGRATION.md`:
````markdown
# Wiring the loader into the real newsroom page

When the newsroom page (built in claude.ai/design) is ready:

1. Copy `news-loader.js` into the site's `js/` folder (next to `site.js`).
2. In the newsroom page, give the cards grid container the attribute `data-news-grid`
   and REMOVE the hardcoded `<article class="card">` examples (the loader fills them in).
3. Before `</body>`, add: `<script src="js/news-loader.js"></script>`
   (auto-inits when it sees `[data-news-grid]`).
4. Ensure the page's existing card CSS classes match the template: `.card`, `.card-media`,
   `.card-body`, `.news-meta`, `.dot`, `.date`, `.cta`, `.article-tpl`, `.article-hero`,
   `.article-inner`, `.article-meta`, `.article-title`, `.article-prose`,
   `.article-sources-wrap`, `.article-sources`, `.src-pub`. (The loader outputs exactly your
   pasted structure, so existing styles apply unchanged.)
5. The page's existing "click card → open drawer" and "View more after 6" logic keeps working,
   because the loader produces the same DOM your design already expects.

That's it — after this, every Telegram post appears automatically with no site edits.
````

- [ ] **Step 2: Commit**

```bash
git add frontend/INTEGRATION.md
git commit -m "docs: how to connect news-loader to the live newsroom page"
```

- [ ] **Step 3: [OWNER] Final smoke test (full loop)**

Send 2–3 real news items (photo + text), confirming each. Verify all appear in `news.json`, render in the demo, sources are clickable, and a bad/empty message is handled gracefully. Rotate the Anthropic key now (set the new value via `wrangler secret put ANTHROPIC_API_KEY` and redeploy) since the old one was shared in chat.

---

## Notes & risks

- **API shape confirmation:** Task 5 Step 5 verifies the Anthropic call against the `claude-api` skill before relying on it. If structured outputs (`output_config`) are preferred over prompt-enforced JSON, swap `claudeMessages`/`parseClaudeJSON` accordingly — the rest is unaffected.
- **Image size:** Telegram-compressed photos are normally <1 MB, fine for the Contents API. `selectPhoto` caps at 1 MB; if a photo is bigger across all sizes, the smallest is used. If real photos ever exceed the limit, add server-side resize or the Git Data blob API (out of scope now).
- **jsDelivr branch cache:** purge is best-effort; first load after purge may lag a few seconds. For instant guarantees, pin to commit sha (out of scope; purge is sufficient here).
- **Secrets:** the Anthropic key shared in chat must be rotated (Task 7 Step 3). No key/token appears in any committed file.
```
