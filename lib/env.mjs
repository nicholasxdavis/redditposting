import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

const ENV_CANDIDATES = [
  path.join(REPO_ROOT, '.env'),
  path.join(REPO_ROOT, '..', 'siyf-web', '.development', 'secrets.local.env'),
];

/** Load first existing env file into process.env (does not override set vars). */
export function loadEnv() {
  for (const filePath of ENV_CANDIDATES) {
    if (!existsSync(filePath)) continue;
    for (const line of readFileSync(filePath, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (key && process.env[key] == null) process.env[key] = value;
    }
    return filePath;
  }
  return null;
}

export function repoPath(...segments) {
  return path.join(REPO_ROOT, ...segments);
}
