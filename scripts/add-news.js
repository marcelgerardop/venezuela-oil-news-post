#!/usr/bin/env node
// Local publishing helper for the SEPESA newsroom feed.
// Given a fields JSON (the structured news, as Claude produces it) and a source image,
// it copies the image into images/, builds the news item, prepends it to news.json,
// and (with --publish) commits, pushes, and purges the jsDelivr CDN so the post goes live.
//
// Usage:
//   node scripts/add-news.js <fields.json> <image> [--publish] [--dry-run]
//
//   --publish   after updating news.json, run: git add/commit/push + jsDelivr purge
//   --dry-run   validate and print what WOULD happen; write/commit nothing
//
// An image is REQUIRED. The script refuses to run without an existing image file —
// every card needs a picture, and a missing one produces a broken card on the live site.
//
// Reuses the SAME logic as the (deferred) Telegram worker via worker/lib.js — no duplication.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { slugify, buildNewsItem, validateFields } = require('../worker/lib.js');

const REPO = { owner: 'marcelgerardop', name: 'venezuela-oil-news-post', branch: 'main' };
const args = process.argv.slice(2);
const flags = new Set(args.filter(a => a.startsWith('--')));
const positional = args.filter(a => !a.startsWith('--'));
const [fieldsPath, imageSrc] = positional;
const PUBLISH = flags.has('--publish');
const DRY = flags.has('--dry-run');

function die(msg) { console.error('\n✖ ' + msg + '\n'); process.exit(1); }

// --- Hard gates -------------------------------------------------------------
if (!fieldsPath) die('Missing the fields JSON.\nUsage: node scripts/add-news.js <fields.json> <image> [--publish] [--dry-run]');
if (!imageSrc) {
  die('IMAGE REQUIRED — no image was provided.\n' +
      'Every news card must have a picture. Ask the user to attach/point to an image, then re-run with:\n' +
      '  node scripts/add-news.js <fields.json> <image> --publish');
}
if (!fs.existsSync(imageSrc)) {
  die('IMAGE REQUIRED — the image path does not exist:\n  ' + imageSrc + '\n' +
      'Confirm the file path with the user (or save the attached image first), then re-run.');
}

const repoRoot = path.resolve(__dirname, '..');
const fields = JSON.parse(fs.readFileSync(fieldsPath, 'utf8'));
validateFields(fields); // throws on any missing required field

const dateISO = new Date().toISOString().slice(0, 10);
const id = slugify(fields.cardTitle, dateISO);
const ext = (path.extname(imageSrc) || '.jpg').toLowerCase();
const imageRel = 'images/' + id + ext;
const item = buildNewsItem(fields, id, imageRel);

if (DRY) {
  console.log('DRY RUN — nothing written. Would publish:');
  console.log('  id    :', id);
  console.log('  image :', imageRel, '(from ' + imageSrc + ')');
  console.log('  title :', item.cardTitle);
  console.log('  body  :', (item.body || []).length, 'block(s),', (item.sources || []).length, 'source(s)');
  process.exit(0);
}

// --- Write the post ---------------------------------------------------------
// 1. Copy the image into the repo.
fs.copyFileSync(imageSrc, path.join(repoRoot, imageRel));

// 2. Prepend the item to news.json (replace if an item with the same id exists).
const newsPath = path.join(repoRoot, 'news.json');
let arr = [];
try { arr = JSON.parse(fs.readFileSync(newsPath, 'utf8')); } catch { arr = []; }
if (!Array.isArray(arr)) arr = [];
arr = arr.filter(it => it.id !== id);
arr.unshift(item);
fs.writeFileSync(newsPath, JSON.stringify(arr, null, 2) + '\n');

console.log('Added news item:');
console.log('  id    :', id);
console.log('  image :', imageRel);
console.log('  total :', arr.length, 'item(s) in news.json');

if (!PUBLISH) {
  console.log('\nWritten locally (not pushed). To go live, re-run with --publish, or run:');
  console.log('  git add -A && git commit -m "news: ' + id + '" && git push');
  process.exit(0);
}

// --- Publish: commit, push, purge ------------------------------------------
const git = (...a) => execFileSync('git', a, { cwd: repoRoot, stdio: 'pipe' }).toString().trim();
try {
  git('add', '-A');
  git('commit', '-m', 'news: ' + id);
  console.log('\nCommitted.');
} catch (e) {
  die('git commit failed: ' + (e.stderr ? e.stderr.toString() : e.message));
}
try {
  git('push');
  console.log('Pushed to GitHub.');
} catch (e) {
  console.error('\n⚠ git push failed (the commit is saved locally). ' +
    'Push it yourself with `git push`, or check your GitHub auth.\n' +
    (e.stderr ? e.stderr.toString() : e.message));
  process.exit(1);
}

// No CDN purge needed: the page reads news.json from raw.githubusercontent (refreshes on its
// own, and the loader's ?v= cache-buster makes it instant per page load), and the image has a
// unique filename so jsDelivr serves it fresh on first request.
console.log('\n✅ Published. The page shows it on the next load.');
