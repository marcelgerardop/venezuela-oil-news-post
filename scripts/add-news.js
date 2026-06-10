#!/usr/bin/env node
// Local publishing helper. Given a fields JSON (the structured news, as Claude produces it)
// and a source image, it copies the image into images/, builds the news item, and prepends
// it to news.json. Then you `git push` and the page picks it up via jsDelivr.
//
// Usage:  node scripts/add-news.js <fields.json> <image-source-path>
//
// Reuses the SAME logic as the (deferred) Telegram worker via worker/lib.js — no duplication.

const fs = require('fs');
const path = require('path');
const { slugify, buildNewsItem, validateFields } = require('../worker/lib.js');

const [, , fieldsPath, imageSrc] = process.argv;
if (!fieldsPath || !imageSrc) {
  console.error('Usage: node scripts/add-news.js <fields.json> <image-source-path>');
  process.exit(1);
}

const repoRoot = path.resolve(__dirname, '..');
const fields = JSON.parse(fs.readFileSync(fieldsPath, 'utf8'));
validateFields(fields);

const dateISO = new Date().toISOString().slice(0, 10);
const id = slugify(fields.cardTitle, dateISO);
const ext = path.extname(imageSrc) || '.jpg';
const imageRel = 'images/' + id + ext;

// 1. Copy the image into the repo.
fs.copyFileSync(imageSrc, path.join(repoRoot, imageRel));

// 2. Prepend the item to news.json.
const newsPath = path.join(repoRoot, 'news.json');
let arr = [];
try { arr = JSON.parse(fs.readFileSync(newsPath, 'utf8')); } catch { arr = []; }
if (!Array.isArray(arr)) arr = [];
arr = arr.filter(it => it.id !== id); // replace if same id already exists
arr.unshift(buildNewsItem(fields, id, imageRel));
fs.writeFileSync(newsPath, JSON.stringify(arr, null, 2) + '\n');

console.log('Added news item:');
console.log('  id    :', id);
console.log('  image :', imageRel);
console.log('  total :', arr.length, 'item(s) in news.json');
console.log('\nNext: git add -A && git commit -m "news: ' + id + '" && git push');
