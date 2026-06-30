#!/usr/bin/env node
import fs from 'node:fs';
import { POTD_SUBREDDIT } from '../lib/config.mjs';
import { loadEnv, repoPath } from '../lib/env.mjs';
import { formatPotdBody, formatPotdTitle } from '../lib/formatPotdPost.mjs';
import { readJsonFile, writeJsonAtomic } from '../lib/potdIo.mjs';
import {
  DEFAULT_TIMEZONE,
  emptyLedger,
  etDateKey,
  parseLedger,
  selectPotdPicks,
} from '../lib/potdLedger.mjs';
import { assertRedditCredentials, redditCredentialsConfigured } from '../lib/redditAuth.mjs';
import { findPotdFlairId, findRecentPotdPost, getLinkFlairs, getRedditMe, submitSelfPost } from '../lib/redditSubmit.mjs';

const LEDGER_PATH = repoPath('data', 'hourly-ledger.json');

function loadLedger() {
  if (!fs.existsSync(LEDGER_PATH)) return emptyLedger();
  return parseLedger(readJsonFile(LEDGER_PATH, emptyLedger));
}

async function main() {
  loadEnv();
  const dryRun = process.argv.includes('--dry-run');
  const force = process.argv.includes('--force');
  const now = new Date();
  const targetDayKey = etDateKey(now, DEFAULT_TIMEZONE);

  if (!dryRun && !fs.existsSync(LEDGER_PATH)) {
    throw new Error(`Ledger not found: ${LEDGER_PATH}`);
  }

  const ledger = loadLedger();

  if (!force && ledger.posts?.postedForDate === targetDayKey) {
    console.log(`[potd] already posted for ${targetDayKey} — skip`);
    return;
  }

  const picks = selectPotdPicks(ledger, {
    now,
    postedForDate: force ? null : ledger.posts?.postedForDate,
  });

  if (!picks.length) {
    console.log(`[potd] no eligible picks for ${targetDayKey} — skip`);
    return;
  }

  const title = formatPotdTitle(picks, { now });
  const text = formatPotdBody(picks, { now });

  console.log('[potd] title:', title);
  console.log('[potd] body:\n');
  console.log(text);
  console.log('');

  if (dryRun) {
    console.log('[potd] dry-run — not posting');
    return;
  }

  if (!redditCredentialsConfigured()) {
    throw new Error('Reddit credentials missing — run npm run reddit:reauth');
  }
  assertRedditCredentials();

  const me = await getRedditMe();
  if (!me?.name) {
    throw new Error('GET /api/v1/me failed — token needs submit+identity scopes (npm run reddit:reauth)');
  }
  console.log(`[potd] posting as u/${me.name}`);

  const existingPost = !force ? await findRecentPotdPost(POTD_SUBREDDIT, { targetDayKey }) : null;
  if (existingPost) {
    console.log(`[potd] recent Reddit post found (${existingPost.id}) — healing ledger, skip submit`);
    ledger.posts = {
      ...ledger.posts,
      lastPotdPostAt: now.toISOString(),
      lastPotdPostId: existingPost.id,
      postedForDate: targetDayKey,
      pickIds: picks.map((p) => p.id),
    };
    writeJsonAtomic(LEDGER_PATH, ledger);
    if (existingPost.url) console.log('[potd] url:', existingPost.url);
    return;
  }

  const flairId = findPotdFlairId(await getLinkFlairs(POTD_SUBREDDIT));
  if (flairId) console.log(`[potd] flair ${flairId}`);
  else console.warn('[potd] POTD flair not found — posting without flair');

  const validation = await submitSelfPost({
    subreddit: POTD_SUBREDDIT,
    title,
    text,
    flairId,
    validateOnly: true,
  });
  if (!validation.ok) {
    throw new Error(`Validation failed: ${JSON.stringify(validation.errors)}`);
  }

  const result = await submitSelfPost({
    subreddit: POTD_SUBREDDIT,
    title,
    text,
    flairId,
    validateOnly: false,
  });
  if (!result.ok) {
    throw new Error(`Submit failed: ${JSON.stringify(result.errors)}`);
  }

  ledger.posts = {
    ...ledger.posts,
    lastPotdPostAt: now.toISOString(),
    lastPotdPostId: result.postId,
    postedForDate: targetDayKey,
    pickIds: picks.map((p) => p.id),
  };
  writeJsonAtomic(LEDGER_PATH, ledger);

  console.log('[potd] posted', result.postId ?? '(unknown)');
  if (result.url) console.log('[potd] url:', result.url);
}

main().catch((err) => {
  console.error('[potd] failed:', err?.message ?? err);
  console.error('[potd] ledger unchanged unless a successful post completed');
  process.exit(1);
});
