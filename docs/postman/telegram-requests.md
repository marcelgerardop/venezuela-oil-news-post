# Telegram Bot API — Postman tests

Base: `https://api.telegram.org/bot<BOT_TOKEN>/<METHOD>`

## getMe — verify the token
```
GET https://api.telegram.org/bot<BOT_TOKEN>/getMe
```
→ `{ "ok": true, "result": { "username": "..." } }`

## sendMessage — send yourself a message
```
POST https://api.telegram.org/bot<BOT_TOKEN>/sendMessage
Content-Type: application/json
{ "chat_id": <OWNER_USER_ID>, "text": "Test from Postman" }
```
→ you receive the message in Telegram.

## setWebhook — run AFTER the Worker is deployed
```
POST https://api.telegram.org/bot<BOT_TOKEN>/setWebhook
Content-Type: application/json
{ "url": "https://sepesa-news-bot.<your-subdomain>.workers.dev", "secret_token": "<TELEGRAM_SECRET_TOKEN>" }
```

## getWebhookInfo — debug
```
GET https://api.telegram.org/bot<BOT_TOKEN>/getWebhookInfo
```
Check `url` is set and `last_error_message` is empty.

## deleteWebhook — stop the bot
```
GET https://api.telegram.org/bot<BOT_TOKEN>/deleteWebhook
```

## How to get your values
- **BOT_TOKEN**: message @BotFather → `/newbot`.
- **OWNER_USER_ID**: message @userinfobot → it replies with your numeric `Id`.
- **TELEGRAM_SECRET_TOKEN**: invent a random string, 16–64 chars, only `A-Za-z0-9_-`.
