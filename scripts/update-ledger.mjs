#!/usr/bin/env node
import fs from 'node:fs';
import { DEFAULT_API_URL } from '../lib/config.mjs';
import { loadEnv, repoPath } from '../lib/env.mjs';
import { readJsonFile, writeJsonAtomic } from '../lib/potdIo.mjs';
import { emptyLedger, mergePicksIntoLedger, parseLedger, pruneLedger } from '../lib/potdLedger.mjs';

const LEDGER_PATH = repoPath('data', 'hourly-ledger.json');

async function fetchInternalFeed() {
  const apiUrl = (process.env.SIYF_API_URL || DEFAULT_API_URL).replace(/\/$/, '');
  const internalKey = process.env.SIYF_INTERNAL_API_KEY?.trim();
  if (!internalKey) throw new Error('SIYF_INTERNAL_API_KEY is required');

  const res = await fetch(`${apiUrl}/auth/internal/best-picks-feed`, {
    headers: { Accept: 'application/json', 'X-Internal-Key': internalKey },
    signal: AbortSignal.timeout(60_000),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = typeof data?.error === 'string' ? data.error : JSON.stringify(data).slice(0, 240);
    throw new Error(`Feed fetch failed (${res.status}): ${detail}`);
  }
  if (!Array.isArray(data.picks)) throw new Error('Internal feed response missing picks array');
  return data;
}

function loadLedger() {
  if (!fs.existsSync(LEDGER_PATH)) return emptyLedger();
  return parseLedger(readJsonFile(LEDGER_PATH, emptyLedger));
}

async function main() {
  loadEnv();
  const dryRun = process.argv.includes('--dry-run');
  const now = new Date();

  const feed = await fetchInternalFeed();
  if (!feed.picks.length) {
    console.warn('[ledger] feed empty — ledger unchanged');
    return;
  }

  const before = Object.keys(loadLedger().picks).length;
  const ledger = loadLedger();
  mergePicksIntoLedger(ledger, feed.picks, now);
  pruneLedger(ledger, now);
  const after = Object.keys(ledger.picks).length;

  console.log(`[ledger] merged ${feed.picks.length} picks · ${before} → ${after} entries`);
  if (feed.generatedAt) console.log(`[ledger] feed generatedAt: ${feed.generatedAt}`);

  if (dryRun) {
    console.log('[ledger] dry-run — not writing');
    return;
  }

  writeJsonAtomic(LEDGER_PATH, ledger);
  console.log(`[ledger] wrote ${LEDGER_PATH}`);
}

main().catch((err) => {
  console.error('[ledger] failed:', err?.message ?? err);
  process.exit(1);
});
