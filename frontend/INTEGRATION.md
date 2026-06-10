# Wiring the loader into the real newsroom page

The page needs: (1) an empty cards container, (2) the loader, (3) a reader/drawer + view-more.
The loader fetches `news.json` from jsDelivr and builds the cards.

## Recommended: EMBED the loader in the page (no CDN cache headaches)

Linking the loader from jsDelivr works, but jsDelivr serves scripts with a ~7-day cache header,
so a loader change can keep showing the old version in the browser for days. Embedding the loader
in the page avoids that entirely — only the *data* (`news.json`) comes from the CDN.

1. Add an empty grid container where the cards go (remove any hardcoded cards):
   `<div class="news-grid" data-news-grid></div>`
2. Just before `</body>`, paste the **full contents of `news-loader.js`** wrapped in a
   `<script> … </script>` tag (do NOT use an external `src`). That's the whole renderer inline.
3. Build the reader/drawer + "View more" with event delegation (cards are inserted dynamically) —
   see the snippets in the project brief / below.

The loader resolves relative image paths (`images/x.jpg`) to the jsDelivr CDN automatically, so
images display correctly even though the page is on cPanel and images live in the GitHub repo.

## Interaction snippets

Drawer (delegate on the grid so it works for dynamically-added cards):
```js
const grid = document.querySelector('[data-news-grid]');
grid.addEventListener('click', (e) => {
  const card = e.target.closest('.card'); if (!card) return;
  const tpl = card.querySelector('template.article-tpl'); if (!tpl) return;
  document.querySelector('[data-news-reader-body]').replaceChildren(tpl.content.cloneNode(true));
  document.querySelector('[data-news-reader]').hidden = false;
});
```
Reader shell: `<div data-news-reader hidden><button data-news-reader-close>×</button><div data-news-reader-body></div></div>`
(close button + Escape set `[data-news-reader].hidden = true`).

View-more after 6 (CSS + a MutationObserver so the button shows only when needed):
```css
[data-news-grid] .card:nth-child(n+7){ display:none; }
[data-news-grid].show-all .card:nth-child(n+7){ display:block; }
```
```js
const g = document.querySelector('[data-news-grid]'), more = document.querySelector('[data-news-more]');
more.addEventListener('click', () => { g.classList.add('show-all'); more.hidden = true; });
new MutationObserver(() => { more.hidden = g.querySelectorAll('.card').length <= 6; }).observe(g, { childList: true });
```

## Alternative: link from the CDN (simpler, but cache-prone)
`<script src="https://cdn.jsdelivr.net/gh/marcelgerardop/venezuela-oil-news-post@main/frontend/news-loader.js"></script>`
Only use this if you accept that loader changes may take days to propagate (or require a CDN purge
+ browser cache-bypass). For production, prefer embedding (above).

## Deploy
Upload the finished page into `public_html` (one time). No `js/` upload, no config — the loader is
inline and the feed/images are on the CDN. After this, new posts appear automatically.
