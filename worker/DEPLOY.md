# Deploying the SEPESA news Worker

All commands run from this `worker/` folder. Secrets are typed when prompted — they
never go into any file.

## One-time setup
1. Install Node 18+ and wrangler: `npm install -g wrangler`
2. Log in to Cloudflare: `wrangler login` (opens a browser, authorize). Free account is fine.
3. Create the KV namespace (stores pending drafts between preview and confirm):
   ```
   wrangler kv namespace create DRAFTS
   ```
   Copy the printed `id` into `wrangler.toml` → `[[kv_namespaces]] id`.
4. Set the 5 secrets. **Easiest — one command from a gitignored file:**
   ```
   copy secrets.example.json secrets.json     # Windows (or: cp on bash)
   # open secrets.json, paste your REAL values, save
   wrangler secret bulk secrets.json          # uploads all 5 at once
   ```
   `secrets.json` is gitignored, so it never gets committed. Delete it after if you like.

   **Or one at a time (no file):**
   ```
   wrangler secret put TELEGRAM_BOT_TOKEN     # from BotFather
   wrangler secret put TELEGRAM_SECRET_TOKEN  # the random string you chose
   wrangler secret put OWNER_USER_ID          # your numeric Telegram id (from @userinfobot)
   wrangler secret put ANTHROPIC_API_KEY      # FRESH Anthropic key (rotate the chat one)
   wrangler secret put GITHUB_TOKEN           # FRESH fine-grained PAT, Contents: read+write
   ```

## Deploy
```
wrangler deploy
```
Note the printed URL, e.g. `https://sepesa-news-bot.<your-subdomain>.workers.dev`.

## Register the Telegram webhook (once, and whenever the URL changes)
In Postman: `POST https://api.telegram.org/bot<BOT_TOKEN>/setWebhook`
Body (JSON):
```json
{ "url": "https://sepesa-news-bot.<your-subdomain>.workers.dev", "secret_token": "<TELEGRAM_SECRET_TOKEN>" }
```
Verify: `GET https://api.telegram.org/bot<BOT_TOKEN>/getWebhookInfo` → `url` is set, `last_error_message` empty.

## Watch logs while testing
```
wrangler tail
```
Streams live requests/errors as you message the bot.

## Rollback / stop
- Roll back a bad deploy: `wrangler deployments list` then `wrangler rollback <id>`.
- Stop the bot entirely: `GET https://api.telegram.org/bot<BOT_TOKEN>/deleteWebhook`.
