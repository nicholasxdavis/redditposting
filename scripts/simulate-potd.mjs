#!/usr/bin/env node
/**
 * Publish a visible [PREVIEW] POTD post (does not update ledger post state).
 * Usage: npm run potd:simulate
 */
import fs from 'node:fs';
import { POTD_SUBREDDIT } from '../lib/config.mjs';
import { loadEnv, repoPath } from '../lib/env.mjs';
import { formatPotdBody, formatPotdTitle } from '../lib/formatPotdPost.mjs';
import { readJsonFile } from '../lib/potdIo.mjs';
import {
  DEFAULT_TIMEZONE,
  emptyLedger,
  etDateKey,
  parseLedger,
  selectPotdPicks,
} from '../lib/potdLedger.mjs';
import { assertRedditCredentials, redditCredentialsConfigured } from '../lib/redditAuth.mjs';
import {
  approveModeratorPost,
  findPotdFlairId,
  getLinkFlairs,
  getRedditMe,
  submitSelfPost,
} from '../lib/redditSubmit.mjs';

const LEDGER_PATH = repoPath('data', 'hourly-ledger.json');

async function main() {
  loadEnv();
  const bootstrap = !process.argv.includes('--no-bootstrap');
  const now = new Date();
  const targetDayKey = etDateKey(now, DEFAULT_TIMEZONE);

  if (!fs.existsSync(LEDGER_PATH)) throw new Error(`Ledger not found: ${LEDGER_PATH}`);
  const ledger = parseLedger(readJsonFile(LEDGER_PATH, emptyLedger));

  const picks = selectPotdPicks(ledger, {
    now,
    postedForDate: null,
    sourceDayKey: bootstrap ? targetDayKey : undefined,
  });
  if (!picks.length) throw new Error('No eligible picks for preview');

  const title = `[PREVIEW] ${formatPotdTitle(picks, { now })}`;
  const text = `${formatPotdBody(picks, { now })}\n\n---\n*Preview only — delete after review.*`;

  console.log('[potd-sim] title:', title);
  console.log('[potd-sim] body:\n');
  console.log(text);
  console.log('');

  if (!redditCredentialsConfigured()) throw new Error('Reddit credentials missing');
  assertRedditCredentials();

  const me = await getRedditMe();
  if (!me?.name) throw new Error('GET /api/v1/me failed');
  console.log(`[potd-sim] posting as u/${me.name}`);

  const flairId = findPotdFlairId(await getLinkFlairs(POTD_SUBREDDIT));

  const validation = await submitSelfPost({
    subreddit: POTD_SUBREDDIT,
    title,
    text,
    flairId,
    validateOnly: true,
  });
  if (!validation.ok) throw new Error(`Validation failed: ${JSON.stringify(validation.errors)}`);

  const result = await submitSelfPost({
    subreddit: POTD_SUBREDDIT,
    title,
    text,
    flairId,
    validateOnly: false,
  });
  if (!result.ok) throw new Error(`Submit failed: ${JSON.stringify(result.errors)}`);

  const approval = await approveModeratorPost(result.postId);
  if (approval.ok) console.log('[potd-sim] mod-approved');
  else console.warn('[potd-sim] auto-approve skipped');

  console.log('[potd-sim] posted', result.postId ?? '(unknown)');
  if (result.url) console.log('[potd-sim] url:', result.url);
}

main().catch((err) => {
  console.error('[potd-sim] failed:', err?.message ?? err);
  process.exit(1);
});
