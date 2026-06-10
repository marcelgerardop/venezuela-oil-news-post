const test = require('node:test');
const assert = require('node:assert');
const {
  slugify, selectPhoto, buildNewsItem,
  claudeRequestBody, parseClaudeJSON, validateFields, previewText,
} = require('./lib.js');

test('slugify makes a dated kebab id', () => {
  assert.equal(slugify('Maha Capital Buys 24%!', '2026-06-10'), '2026-06-10-maha-capital-buys-24');
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
  const fields = { category: 'X', dateShort: 'Jun 2026', dateFull: 'June 2026',
    cardTitle: 'c', articleTitle: 'a', summary: 's', imageAlt: 'alt',
    body: [{ type: 'p', text: 't' }], sources: [] };
  const item = buildNewsItem(fields, '2026-06-10-x', 'images/2026-06-10-x.jpg');
  assert.equal(item.id, '2026-06-10-x');
  assert.equal(item.image, 'images/2026-06-10-x.jpg');
  assert.equal(item.cardTitle, 'c');
});

test('buildNewsItem defaults imageAlt to cardTitle', () => {
  const item = buildNewsItem({ cardTitle: 'Hello', body: [] }, 'id', 'images/x.jpg');
  assert.equal(item.imageAlt, 'Hello');
});

test('claudeRequestBody targets opus with a json schema', () => {
  const body = claudeRequestBody('some news text', 'June 2026');
  assert.equal(body.model, 'claude-opus-4-8');
  assert.equal(body.output_config.format.type, 'json_schema');
  assert.ok(body.output_config.format.schema.properties.cardTitle);
  assert.match(JSON.stringify(body.messages), /some news text/);
  assert.match(body.system, /June 2026/);
});

test('parseClaudeJSON strips code fences and parses', () => {
  assert.deepEqual(parseClaudeJSON('```json\n{"category":"X","body":[]}\n```'), { category: 'X', body: [] });
});

test('validateFields rejects missing required keys', () => {
  assert.throws(() => validateFields({ category: 'X' }), /missing/i);
});

test('validateFields passes a complete object', () => {
  const f = { category: 'X', dateShort: 'Jun 2026', dateFull: 'June 2026', cardTitle: 'c',
    articleTitle: 'a', summary: 's', body: [{ type: 'p', text: 't' }], sources: [] };
  assert.equal(validateFields(f), true);
});

test('previewText summarizes the draft for Telegram', () => {
  const f = { category: 'Acquisition', dateFull: 'June 2026', cardTitle: 'Card', articleTitle: 'Art',
    summary: 'Sum', body: [{ type: 'p', text: 'a' }, { type: 'h4', text: 'b' }], sources: [{ title: 'S', url: 'u', publisher: 'P' }] };
  const t = previewText(f);
  assert.match(t, /Acquisition/);
  assert.match(t, /Card/);
  assert.match(t, /1 source/);
});
