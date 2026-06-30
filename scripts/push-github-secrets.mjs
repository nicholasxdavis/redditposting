#!/usr/bin/env node
/**
 * Push secrets to GitHub Actions for nicholasxdavis/redditposting.
 * Reads .env or ../siyf-web/.development/secrets.local.env
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv, repoPath } from '../lib/env.mjs';

const REPO = process.env.GITHUB_REPO || 'nicholasxdavis/redditposting';

const SECRET_KEYS = [
  'SIYF_API_URL',
  'SIYF_INTERNAL_API_KEY',
  'REDDIT_CLIENT_ID',
  'REDDIT_CLIENT_SECRET',
  'REDDIT_REFRESH_TOKEN',
];

function parseEnvFile(filePath) {
  const out = {};
  for (const line of readFileSync(filePath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return out;
}

function ghSecretSet(key, value) {
  const result = spawnSync(
    'gh',
    ['secret', 'set', key, '--body', value, '--repo', REPO],
    { encoding: 'utf8', shell: true },
  );
  if (result.status !== 0) {
    console.error(`[secrets] failed ${key}:`, result.stderr?.trim() || result.stdout?.trim());
    process.exit(result.status ?? 1);
  }
  console.log(`[secrets] set ${key}`);
}

async function main() {
  loadEnv();
  const envPath = existsSync(repoPath('.env'))
    ? repoPath('.env')
    : repoPath('..', 'siyf-web', '.development', 'secrets.local.env');

  if (!existsSync(envPath)) {
    throw new Error(`No env file at ${envPath}`);
  }

  const secrets = parseEnvFile(envPath);
  const defaults = {
    SIYF_API_URL: 'https://siyf-web-api.nic-58f.workers.dev',
  };

  for (const key of SECRET_KEYS) {
    const value = secrets[key] || defaults[key];
    if (!value) {
      console.warn(`[secrets] skip ${key} (missing)`);
      continue;
    }
    ghSecretSet(key, value);
  }

  // Sync local .env for repo (without printing values)
  const localEnv = repoPath('.env');
  const lines = ['# Auto-synced by secrets:push — do not commit'];
  for (const key of SECRET_KEYS) {
    const value = secrets[key] || defaults[key];
    if (value) lines.push(`${key}=${value}`);
  }
  lines.push('SIYF_SITE_URL=https://www.siyfsports.com');
  writeFileSync(localEnv, `${lines.join('\n')}\n`, 'utf8');
  console.log(`[secrets] wrote ${localEnv} (gitignored)`);
  console.log(`[secrets] done for ${REPO}`);
}

main().catch((err) => {
  console.error('[secrets] failed:', err?.message ?? err);
  process.exit(1);
});
