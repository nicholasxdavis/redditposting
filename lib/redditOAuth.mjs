import http from 'node:http';
import { spawn } from 'node:child_process';
import { REDDIT_USER_AGENT, POTD_SUBREDDIT } from './config.mjs';

export const REDIRECT_URI = 'http://localhost:8080';
export const REDDIT_SCOPES_POSTING = 'read submit edit identity flair modposts';

export function buildRedditAuthorizeUrl(clientId, scopes = REDDIT_SCOPES_POSTING, state = String(Math.floor(Math.random() * 1_000_000))) {
  const authorizeUrl = new URL('https://www.reddit.com/api/v1/authorize');
  authorizeUrl.searchParams.set('client_id', clientId);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('state', state);
  authorizeUrl.searchParams.set('redirect_uri', REDIRECT_URI);
  authorizeUrl.searchParams.set('duration', 'permanent');
  authorizeUrl.searchParams.set('scope', scopes);
  return { authorizeUrl, state };
}

export function openAuthorizeUrl(url) {
  const target = url.toString();
  if (process.platform === 'win32') {
    spawn('rundll32', ['url.dll,FileProtocolHandler', target], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    }).unref();
    return;
  }
  const opener = process.platform === 'darwin' ? 'open' : 'xdg-open';
  spawn(opener, [target], { detached: true, stdio: 'ignore' }).unref();
}

export async function verifyRedditAppCredentials(clientId, clientSecret) {
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const res = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': REDDIT_USER_AGENT,
    },
    body: new URLSearchParams({ grant_type: 'client_credentials' }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    throw new Error(`Reddit app credentials rejected (${res.status})`);
  }
}

function waitForAuthCode(expectedState) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', REDIRECT_URI);
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');
      const state = url.searchParams.get('state');

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<h1>Reddit auth complete. Close this tab.</h1>');

      server.close();
      if (error) reject(new Error(`Reddit auth denied: ${error}`));
      else if (state && state !== expectedState) reject(new Error('Reddit auth state mismatch'));
      else if (!code) reject(new Error('No authorization code in redirect'));
      else resolve(code);
    });

    server.listen(8080, '127.0.0.1', () => {
      console.log('[reddit-auth] listening on http://localhost:8080');
    });

    server.on('error', (err) => {
      if (err?.code === 'EADDRINUSE') {
        reject(new Error('Port 8080 in use — close the other process and retry'));
        return;
      }
      reject(err);
    });
  });
}

async function exchangeCodeForTokens(clientId, clientSecret, code) {
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const res = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': REDDIT_USER_AGENT,
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Token exchange failed (${res.status}): ${JSON.stringify(data)}`);
  }
  return data;
}

async function verifyAccessToken(accessToken) {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'User-Agent': REDDIT_USER_AGENT,
  };
  const meRes = await fetch('https://oauth.reddit.com/api/v1/me', { headers });
  const me = meRes.ok ? await meRes.json().catch(() => ({})) : null;

  const submitRes = await fetch('https://oauth.reddit.com/api/submit', {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      sr: POTD_SUBREDDIT,
      kind: 'self',
      title: 'POTD auth check (do not publish)',
      text: 'validation only',
      validate_on_submit: 'true',
      api_type: 'json',
    }),
  });
  const submitBody = await submitRes.json().catch(() => ({}));
  const submitOk = submitRes.ok && !submitBody?.json?.errors?.length;

  return { me, submitOk, meStatus: meRes.status };
}

export async function runRedditOAuth({ clientId, clientSecret, openBrowser = true, log = console.log } = {}) {
  await verifyRedditAppCredentials(clientId, clientSecret);
  const { authorizeUrl, state } = buildRedditAuthorizeUrl(clientId);

  log('\n[reddit-auth] scopes:', REDDIT_SCOPES_POSTING);
  log('[reddit-auth] URL:\n', authorizeUrl.toString(), '\n');

  if (openBrowser) {
    openAuthorizeUrl(authorizeUrl);
  }

  const code = await waitForAuthCode(state);
  const tokens = await exchangeCodeForTokens(clientId, clientSecret, code);

  if (!tokens.refresh_token) {
    throw new Error('No refresh_token — approve all scopes with duration=permanent');
  }

  if (tokens.access_token) {
    const { me, submitOk, meStatus } = await verifyAccessToken(tokens.access_token);
    if (me?.name) log(`[reddit-auth] account u/${me.name}`);
    else log(`[reddit-auth] warning: /me returned ${meStatus}`);
    log(submitOk ? '[reddit-auth] submit scope ok' : '[reddit-auth] submit validation failed');
  }

  return tokens.refresh_token;
}
