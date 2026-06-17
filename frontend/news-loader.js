// Renders SEPESA newsroom cards from news.json.
// buildCardHTML(item) is pure (unit-tested in Node) and reused by the browser renderer.
(function (root) {
  // Images live in the GitHub repo, served by jsDelivr. The page may be hosted anywhere
  // (cPanel), so resolve relative image paths to the CDN; absolute URLs pass through.
  var CDN_BASE = 'https://cdn.jsdelivr.net/gh/marcelgerardop/venezuela-oil-news-post@main/';
  function resolveImg(src) {
    src = String(src == null ? '' : src);
    return /^https?:\/\//i.test(src) ? src : CDN_BASE + src.replace(/^\//, '');
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  var escAttr = esc;

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
'    <img src="' + escAttr(resolveImg(item.image)) + '" alt="' + escAttr(item.imageAlt) + '">\n' +
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
'    <img class="article-hero" src="' + escAttr(resolveImg(item.image)) + '" alt="' + escAttr(item.imageAlt) + '">\n' +
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

  function renderNews(container, items) {
    container.innerHTML = (items || []).map(buildCardHTML).join('\n');
  }

  async function init(opts) {
    opts = opts || {};
    // The FEED is fetched from raw.githubusercontent (refreshes within ~5 min on its own, and a
    // unique ?v= query makes it instant on every page load — no CDN purge needed). IMAGES are
    // served from jsDelivr (CDN_BASE above): they have unique filenames so they're never stale.
    var url = opts.url || 'https://raw.githubusercontent.com/marcelgerardop/venezuela-oil-news-post/main/news.json';
    var selector = opts.selector || '[data-news-grid]';
    var container = document.querySelector(selector);
    if (!container) return;
    try {
      // Cache-buster: force a fresh copy each load so a new post shows immediately.
      var sep = url.indexOf('?') === -1 ? '?' : '&';
      var res = await fetch(url + sep + 'v=' + Date.now(), { cache: 'no-store' });
      var items = await res.json();
      renderNews(container, items);
      if (typeof opts.onRendered === 'function') opts.onRendered(container, items);
    } catch (e) {
      console.error('news-loader: failed to load news', e);
    }
  }

  var api = { buildCardHTML: buildCardHTML, renderNews: renderNews, init: init };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; // Node test
  if (root) root.SepesaNews = api;                                           // Browser
  if (typeof document !== 'undefined') {
    var autostart = function () { if (document.querySelector('[data-news-grid]')) init(); };
    // If the script loaded after the DOM was ready (common when served from a CDN
    // or with defer/async), DOMContentLoaded already fired — start immediately.
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', autostart);
    else autostart();
  }
})(typeof window !== 'undefined' ? window : null);
