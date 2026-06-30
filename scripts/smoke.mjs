#!/usr/bin/env node
import { loadEnv } from '../lib/env.mjs';
import { POTD_SUBREDDIT } from '../lib/config.mjs';
import { redditCredentialsConfigured } from '../lib/redditAuth.mjs';
import { findPotdFlairId, getLinkFlairs, getRedditMe, submitSelfPost } from '../lib/redditSubmit.mjs';

async function main() {
  loadEnv();
  if (!redditCredentialsConfigured()) {
    console.log('[smoke] skip — Reddit creds not set');
    return;
  }

  const me = await getRedditMe();
  if (!me?.name) {
    throw new Error('/api/v1/me failed — run npm run reddit:reauth with submit+identity+flair scopes');
  }
  console.log(`[smoke] u/${me.name}`);

  const flairs = await getLinkFlairs(POTD_SUBREDDIT);
  const flairId = findPotdFlairId(flairs);
  console.log(`[smoke] flairs=${flairs.length} potd=${flairId ?? 'none'}`);

  const validation = await submitSelfPost({
    subreddit: POTD_SUBREDDIT,
    title: 'POTD smoke (do not publish)',
    text: 'validation only',
    flairId,
    validateOnly: true,
  });
  if (!validation.ok) {
    throw new Error(`submit validate failed: ${JSON.stringify(validation.errors)}`);
  }
  console.log('[smoke] ok');
}

main().catch((err) => {
  console.error('[smoke] failed:', err?.message ?? err);
  process.exit(1);
});
