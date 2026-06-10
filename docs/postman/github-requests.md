# GitHub Contents API — Postman tests

Use these to prove the data layer works before deploying the bot.

Common headers (every request):
```
Authorization: Bearer github_pat_YOUR_TOKEN
Accept: application/vnd.github+json
X-GitHub-Api-Version: 2022-11-28
```

## 1. GET current news.json (read content + sha)
```
GET https://api.github.com/repos/marcelgerardop/venezuela-oil-news-post/contents/news.json
```
Response `.content` is base64 of `[]`. Copy `.sha` for the next request.

## 2. PUT a sample item into news.json
```
PUT https://api.github.com/repos/marcelgerardop/venezuela-oil-news-post/contents/news.json
Content-Type: application/json
```
Body:
```json
{
  "message": "test: add sample news item",
  "content": "BASE64_OF_THE_ARRAY_BELOW",
  "sha": "SHA_FROM_REQUEST_1",
  "branch": "main"
}
```
The decoded array to base64-encode for `content`:
```json
[{"id":"2026-06-10-sample","category":"Test","dateShort":"Jun 2026","dateFull":"June 2026","cardTitle":"Sample card","articleTitle":"Sample article title","summary":"This is a sample summary.","image":"images/placeholder.jpg","imageAlt":"placeholder","body":[{"type":"p","text":"Body paragraph."}],"sources":[{"title":"Example","url":"https://example.com","publisher":"Example"}]}]
```
(Encode it with any base64 tool.) Expect **200 OK**.

## 3. Verify jsDelivr serves it
```
GET https://cdn.jsdelivr.net/gh/marcelgerardop/venezuela-oil-news-post@main/news.json
```
To force a refresh after a later commit:
```
GET https://purge.jsdelivr.net/gh/marcelgerardop/venezuela-oil-news-post@main/news.json
```

## 4. Reset news.json back to `[]`
Re-run request 2 with `content` = base64 of `[]` and the new `sha` returned by request 2.
This confirms the read-modify-write loop both ways. Then GET the purge URL.
