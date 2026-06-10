# Wiring the loader into the real newsroom page

When the newsroom page (built in claude.ai/design) is ready, connect it to the automation:

1. Copy `news-loader.js` into the site's `js/` folder (next to `site.js`).
2. On the cards grid container, add the attribute `data-news-grid`, and REMOVE the
   hardcoded `<article class="card">` examples — the loader fills them in from `news.json`.
3. Before `</body>`, add: `<script src="js/news-loader.js"></script>`
   (it auto-initialises when it sees `[data-news-grid]`).
4. Make sure the page's card CSS uses the same class names the loader outputs:
   `.card`, `.card-media`, `.card-body`, `.news-meta`, `.dot`, `.date`, `.cta`,
   `.article-tpl`, `.article-hero`, `.article-inner`, `.article-meta`, `.article-title`,
   `.article-prose`, `.article-sources-wrap`, `.article-sources`, `.src-pub`.
   (The loader emits exactly the structure you pasted, so existing styles apply unchanged.)
5. The page's existing "click card → open drawer" and "View more after 6" logic keeps working,
   because the loader produces the same DOM your design already expects.

After this, every Telegram post appears on the site automatically — no manual cPanel edits.

The loader fetches from jsDelivr by default:
`https://cdn.jsdelivr.net/gh/marcelgerardop/venezuela-oil-news-post@main/news.json`
To point elsewhere, init it manually instead of relying on auto-init:
`SepesaNews.init({ url: '...', selector: '[data-news-grid]' });`
