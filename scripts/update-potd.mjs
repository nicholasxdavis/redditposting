#!/usr/bin/env node
/**
 * Edit an existing POTD self-post body (e.g. after selection/format changes).
 * Usage: node scripts/update-potd.mjs [--bootstrap] [--post-id ID]
 */
import fs from 'node:fs';
import { loadEnv, repoPath } from '../lib/env.mjs';
import { formatPotdBody } from '../lib/formatPotdPost.mjs';
import { readJsonFile } from '../lib/potdIo.mjs';
import {
  DEFAULT_TIMEZONE,
  emptyLedger,
  etDateKey,
  parseLedger,
  selectPotdPicks,
} from '../lib/potdLedger.mjs';
import { assertRedditCredentials, redditCredentialsConfigured } from '../lib/redditAuth.mjs';
import { editSelfPost } from '../lib/redditSubmit.mjs';

const LEDGER_PATH = repoPath('data', 'hourly-ledger.json');

function argValue(flag) {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 ? process.argv[idx + 1] : null;
}

async function main() {
  loadEnv();
  const bootstrap = process.argv.includes('--bootstrap');
  const dryRun = process.argv.includes('--dry-run');
  const now = new Date();
  const targetDayKey = etDateKey(now, DEFAULT_TIMEZONE);

  if (!fs.existsSync(LEDGER_PATH)) throw new Error(`Ledger not found: ${LEDGER_PATH}`);
  const ledger = parseLedger(readJsonFile(LEDGER_PATH, emptyLedger));

  const postId = argValue('--post-id') ?? ledger.posts?.lastPotdPostId;
  if (!postId) throw new Error('No post id — pass --post-id or post first');

  const picks = selectPotdPicks(ledger, {
    now,
    postedForDate: null,
    sourceDayKey: bootstrap ? targetDayKey : undefined,
  });
  if (!picks.length) throw new Error('No eligible picks to format');

  const text = formatPotdBody(picks, { now });
  console.log('[potd-update] body:\n');
  console.log(text);

  if (dryRun) {
    console.log('[potd-update] dry-run — not editing');
    return;
  }

  if (!redditCredentialsConfigured()) throw new Error('Reddit credentials missing');
  assertRedditCredentials();

  const result = await editSelfPost({ postId, text });
  if (!result.ok) throw new Error(`Edit failed: ${JSON.stringify(result.errors)}`);

  ledger.posts = {
    ...ledger.posts,
    pickIds: picks.map((p) => p.id),
    lastPotdUpdatedAt: now.toISOString(),
  };
  const { writeJsonAtomic } = await import('../lib/potdIo.mjs');
  writeJsonAtomic(LEDGER_PATH, ledger);

  console.log(`[potd-update] edited ${postId}`);
}

main().catch((err) => {
  console.error('[potd-update] failed:', err?.message ?? err);
  process.exit(1);
});
