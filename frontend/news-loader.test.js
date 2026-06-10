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

test('relative image paths resolve to the jsDelivr CDN', () => {
  const html = buildCardHTML({ ...item, image: 'images/maha.jpg' });
  assert.match(html, /src="https:\/\/cdn\.jsdelivr\.net\/gh\/marcelgerardop\/venezuela-oil-news-post@main\/images\/maha\.jpg"/);
});

test('absolute image URLs pass through unchanged', () => {
  const html = buildCardHTML({ ...item, image: 'https://example.com/p.jpg' });
  assert.match(html, /src="https:\/\/example\.com\/p\.jpg"/);
  assert.doesNotMatch(html, /jsdelivr.*example\.com/);
});
