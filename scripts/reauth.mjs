#!/usr/bin/env node
import { loadEnv } from '../lib/env.mjs';
import { runRedditOAuth } from '../lib/redditOAuth.mjs';

async function main() {
  const loaded = loadEnv();
  const clientId = process.env.REDDIT_CLIENT_ID?.trim();
  const clientSecret = process.env.REDDIT_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error('Set REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET in .env first');
  }
  if (loaded) console.log(`[reauth] loaded env from ${loaded}`);

  const noOpen = process.argv.includes('--no-open');
  const refreshToken = await runRedditOAuth({
    clientId,
    clientSecret,
    openBrowser: !noOpen,
  });

  console.log('\n[reauth] add to .env and GitHub secrets:\n');
  console.log(`REDDIT_REFRESH_TOKEN=${refreshToken}`);
  console.log('\nThen: npm run secrets:push');
}

main().catch((err) => {
  console.error('[reauth] failed:', err?.message ?? err);
  process.exit(1);
});
