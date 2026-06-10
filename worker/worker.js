// Cloudflare Worker: Telegram -> Claude -> preview -> confirm -> GitHub commit -> jsDelivr purge.
// Pure logic lives in lib.js (unit-tested). This file wires the external APIs.
import {
  slugify, selectPhoto, buildNewsItem,
  claudeRequestBody, parseClaudeJSON, validateFields, previewText,
} from './lib.js';

const PHOTO_CAP_BYTES = 1000000; // GitHub Contents API is comfortable up to ~1MB
const TG = (token, method) => `https://api.telegram.org/bot${token}/${method}`;
const GH_API = 'https://api.github.com';

// --- Telegram ---------------------------------------------------------------

async function tgSend(env, chatId, text, extra = {}) {
  await fetch(TG(env.TELEGRAM_BOT_TOKEN, 'sendMessage'), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, ...extra }),
  });
}

async function tgAnswerCallback(env, callbackId) {
  await fetch(TG(env.TELEGRAM_BOT_TOKEN, 'answerCallbackQuery'), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackId }),
  });
}

// getFile -> download the photo bytes.
async function tgDownloadPhoto(env, fileId) {
  const r = await fetch(TG(env.TELEGRAM_BOT_TOKEN, 'getFile') + '?file_id=' + encodeURIComponent(fileId));
  const j = await r.json();
  if (!j.ok) throw new Error('getFile failed');
  const dl = await fetch(`https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${j.result.file_path}`);
  return await dl.arrayBuffer();
}

// --- Claude -----------------------------------------------------------------

async function callClaude(env, newsText) {
  const monthYear = new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' });
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify(claudeRequestBody(newsText, monthYear)),
  });
  if (!res.ok) throw new Error('claude ' + res.status);
  const data = await res.json();
  const block = (data.content || []).find(b => b.type === 'text');
  return block && block.text;
}

// --- GitHub Contents API ----------------------------------------------------

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
  return fetch(url, {
    method: 'PUT',
    headers: { ...ghHeaders(env), 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// Prepend the item to news.json with optimistic-concurrency retry on 409.
async function commitNewsItem(env, item) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { sha, content } = await ghGetFile(env, 'news.json');
    let arr = [];
    if (content) { try { arr = JSON.parse(content); } catch { arr = []; } }
    arr.unshift(item);
    const res = await ghPutFile(env, 'news.json', strToBase64(JSON.stringify(arr, null, 2)),
      'feat: add news ' + item.id, sha);
    if (res.ok) return true;
    if (res.status === 409) continue; // stale sha, re-read and retry
    throw new Error('news.json PUT ' + res.status);
  }
  throw new Error('news.json conflict after retries');
}

async function purgeJsdelivr(env, path) {
  try {
    await fetch(`https://purge.jsdelivr.net/gh/${env.GITHUB_OWNER}/${env.GITHUB_REPO}@${env.GITHUB_BRANCH}/${path}`);
  } catch (_) { /* best effort */ }
}

// --- Webhook handler --------------------------------------------------------

export default {
  async fetch(request, env) {
    if (request.method !== 'POST') return new Response('ok'); // health check / browser GET

    // Verify the request really came from Telegram.
    if (request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.TELEGRAM_SECRET_TOKEN) {
      return new Response('forbidden', { status: 401 });
    }

    let update;
    try { update = await request.json(); } catch { return new Response('bad json', { status: 400 }); }

    // --- new message: format + preview ---
    const msg = update.message;
    if (msg) {
      if (String(msg.from && msg.from.id) !== String(env.OWNER_USER_ID)) return new Response('ok'); // owner only

      const hasPhoto = Array.isArray(msg.photo) && msg.photo.length > 0;
      const text = (msg.caption || msg.text || '').trim();

      if (!hasPhoto) { await tgSend(env, msg.chat.id, '📷 Please resend with a photo attached.'); return new Response('ok'); }
      if (!text) { await tgSend(env, msg.chat.id, '✍️ Add the news text as the photo caption.'); return new Response('ok'); }

      let fields;
      try {
        fields = parseClaudeJSON(await callClaude(env, text));
        validateFields(fields);
      } catch (e) {
        await tgSend(env, msg.chat.id, '⚠️ Couldn’t format that, please try again.\n(' + e.message + ')');
        return new Response('ok');
      }

      const photo = selectPhoto(msg.photo, PHOTO_CAP_BYTES);
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

    // --- button tap: confirm / cancel ---
    const cb = update.callback_query;
    if (cb) {
      if (String(cb.from && cb.from.id) !== String(env.OWNER_USER_ID)) return new Response('ok');
      await tgAnswerCallback(env, cb.id); // stop the loading spinner

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
          await commitNewsItem(env, buildNewsItem(fields, id, imagePath));

          // 3. Bust the CDN cache.
          await purgeJsdelivr(env, 'news.json');
          await purgeJsdelivr(env, imagePath);

          await env.DRAFTS.delete(key);
          await tgSend(env, chatId, '✅ Published — live on the site in a few seconds.');
        } catch (e) {
          await tgSend(env, chatId, '❌ Publish failed: ' + e.message);
        }
        return new Response('ok');
      }
    }

    return new Response('ok'); // always 200 so Telegram doesn't retry
  },
};
