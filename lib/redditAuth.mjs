import { REDDIT_USER_AGENT } from './config.mjs';

const TOKEN_URL = 'https://www.reddit.com/api/v1/access_token';

let tokenCache = null;

export function redditCredentialsConfigured() {
  return Boolean(
    process.env.REDDIT_CLIENT_ID?.trim()
    && process.env.REDDIT_CLIENT_SECRET?.trim()
    && process.env.REDDIT_REFRESH_TOKEN?.trim(),
  );
}

export function assertRedditCredentials() {
  if (!redditCredentialsConfigured()) {
    throw new Error(
      'Set REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, and REDDIT_REFRESH_TOKEN '
      + '(run: npm run reddit:reauth)',
    );
  }
}

export async function getRedditAccessToken() {
  assertRedditCredentials();

  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) {
    return tokenCache.accessToken;
  }

  const clientId = process.env.REDDIT_CLIENT_ID.trim();
  const clientSecret = process.env.REDDIT_CLIENT_SECRET.trim();
  const refreshToken = process.env.REDDIT_REFRESH_TOKEN.trim();
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': REDDIT_USER_AGENT,
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
    signal: AbortSignal.timeout(20_000),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Reddit token exchange failed (${res.status}): ${detail.slice(0, 240)}`);
  }

  const data = await res.json();
  if (!data?.access_token) {
    throw new Error('Reddit token exchange returned no access_token');
  }

  tokenCache = {
    accessToken: data.access_token,
    expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000,
  };

  return tokenCache.accessToken;
}

export function resetRedditTokenCacheForTests() {
  tokenCache = null;
}
