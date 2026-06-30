import { REDDIT_USER_AGENT } from './config.mjs';
import { getRedditAccessToken } from './redditAuth.mjs';

const OAUTH_BASE = 'https://oauth.reddit.com';

async function oauthFetch(path, { method = 'GET', form } = {}) {
  const token = await getRedditAccessToken();
  const headers = {
    Authorization: `Bearer ${token}`,
    'User-Agent': REDDIT_USER_AGENT,
  };

  const init = { method, headers, signal: AbortSignal.timeout(30_000) };
  if (form) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    init.body = new URLSearchParams(form);
  }

  const res = await fetch(`${OAUTH_BASE}${path}`, init);
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

export async function getRedditMe() {
  const { ok, data } = await oauthFetch('/api/v1/me');
  return ok ? data : null;
}

export async function getLinkFlairs(subreddit) {
  const { ok, data } = await oauthFetch(`/r/${subreddit}/api/link_flair_v2`);
  if (!ok || !Array.isArray(data)) return [];

  return data
    .map((row) => ({
      id: String(row.id ?? row.flair_template_id ?? ''),
      text: String(row.text ?? row.flair_text ?? '').trim(),
    }))
    .filter((row) => row.id && row.text);
}

export function findPotdFlairId(flairs, { label = 'POTD' } = {}) {
  const needle = label.toUpperCase();
  for (const flair of flairs) {
    if (flair.text.toUpperCase().includes(needle)) return flair.id;
  }
  return null;
}

export async function submitSelfPost({
  subreddit,
  title,
  text,
  flairId = null,
  validateOnly = false,
}) {
  const form = {
    sr: subreddit,
    kind: 'self',
    title: title.slice(0, 300),
    text,
    api_type: 'json',
    sendreplies: 'true',
  };

  if (flairId) form.flair_id = flairId;
  if (validateOnly) form.validate_on_submit = 'true';

  const { ok, status, data } = await oauthFetch('/api/submit', { method: 'POST', form });
  const errors = data?.json?.errors ?? data?.errors ?? [];

  return {
    ok: ok && errors.length === 0,
    status,
    errors,
    postId: data?.json?.data?.id ?? data?.json?.data?.name ?? null,
    url: data?.json?.data?.url ?? null,
  };
}
