# Siyf! Reddit POTD

Hourly accumulation of [Siyf! best picks](https://www.siyfsports.com/best-picks) and a once-daily **Picks of the Day** post to [r/sportsinyourface](https://www.reddit.com/r/sportsinyourface/) with POTD flair.

## Architecture

| Schedule | Workflow | Action |
|----------|----------|--------|
| `:05` every hour UTC | `hourly-ledger.yml` | Fetch merged feed → update `data/hourly-ledger.json` |
| `16:00` UTC daily | `potd-daily.yml` | Top 5 picks → Reddit post |

Posting failures do **not** block the hourly ledger. Ledger failures do **not** affect the Siyf! site or Appwrite scrape.

## Setup

1. Copy `.env.example` → `.env` (or rely on `../siyf-web/.development/secrets.local.env` for local runs)
2. Reddit OAuth with scopes `read submit identity flair`:
   ```bash
   npm run reddit:reauth
   ```
3. Push GitHub Actions secrets:
   ```bash
   npm run secrets:push
   ```

### GitHub secrets

| Secret | Purpose |
|--------|---------|
| `SIYF_API_URL` | Worker URL (`https://siyf-web-api.nic-58f.workers.dev`) |
| `SIYF_INTERNAL_API_KEY` | `GET /auth/internal/best-picks-feed` |
| `REDDIT_CLIENT_ID` | Reddit app |
| `REDDIT_CLIENT_SECRET` | Reddit app |
| `REDDIT_REFRESH_TOKEN` | Posting token (submit scopes) |

## Commands

```bash
npm test
npm run ledger:update
npm run ledger:dry-run
npm run potd:dry-run
npm run potd:post
npm run reddit:smoke
```

## Raw ledger

https://raw.githubusercontent.com/nicholasxdavis/redditposting/main/data/hourly-ledger.json
