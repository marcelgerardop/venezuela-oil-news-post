// Pure, environment-agnostic helpers for the SEPESA news worker.
// No Cloudflare/Telegram/GitHub APIs here so this file is unit-testable with `node --test`.

// --- id + photo + item shaping ---------------------------------------------

function slugify(text, dateISO) {
  const base = String(text || 'post').toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')        // drop punctuation
    .trim().replace(/\s+/g, '-')
    .replace(/-+/g, '-').replace(/^-|-$/g, '')
    .split('-').slice(0, 6).join('-');   // cap length
  return dateISO + '-' + (base || 'post');
}

// Telegram photo[] is ordered smallest -> largest. Pick the largest whose
// file_size is within the cap (GitHub Contents API is happy up to ~1MB).
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

// --- Claude (Anthropic Messages API, structured outputs) --------------------

const REQUIRED = ['category', 'dateShort', 'dateFull', 'cardTitle', 'articleTitle', 'summary', 'body'];

// JSON schema the model must fill. Structured-output rules: every object needs
// additionalProperties:false and a required[] listing all its properties.
const NEWS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    category: { type: 'string' },
    dateShort: { type: 'string' },
    dateFull: { type: 'string' },
    cardTitle: { type: 'string' },
    articleTitle: { type: 'string' },
    summary: { type: 'string' },
    imageAlt: { type: 'string' },
    body: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          type: { type: 'string', enum: ['p', 'h4'] },
          text: { type: 'string' },
        },
        required: ['type', 'text'],
      },
    },
    sources: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string' },
          url: { type: 'string' },
          publisher: { type: 'string' },
        },
        required: ['title', 'url', 'publisher'],
      },
    },
  },
  required: ['category', 'dateShort', 'dateFull', 'cardTitle', 'articleTitle', 'summary', 'imageAlt', 'body', 'sources'],
};

const CLAUDE_SYSTEM =
  'You turn a raw oil & gas news blurb about Venezuela into a structured news card for the SEPESA ' +
  'corporate newsroom. Be faithful to the facts in the input; do not invent figures, names, or events. ' +
  'category: 1-2 words (e.g. Acquisition, Field, Sanctions, Alliance, Operations). ' +
  'dateShort: "Mon YYYY"; dateFull: "Month YYYY". ' +
  'cardTitle: <=60 chars, punchy. articleTitle: full headline. summary: 1-2 sentences for the card. ' +
  'imageAlt: short description of the news photo. ' +
  'body: the article split into {type:"p"|"h4", text} blocks (use h4 for short subheadings like "The deal"). ' +
  'sources: one entry per URL in the input; publisher = the site name, title = the article headline.';

function claudeRequestBody(newsText, monthYear) {
  const dateHint = monthYear ? ` If the input states no date, use ${monthYear}.` : '';
  return {
    model: 'claude-opus-4-8',
    max_tokens: 4000,
    system: CLAUDE_SYSTEM + dateHint,
    messages: [{ role: 'user', content: newsText }],
    output_config: { format: { type: 'json_schema', schema: NEWS_SCHEMA } },
  };
}

// Structured outputs returns clean JSON, but strip code fences defensively.
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

module.exports = {
  slugify, selectPhoto, buildNewsItem,
  claudeRequestBody, parseClaudeJSON, validateFields, previewText,
  NEWS_SCHEMA,
};
