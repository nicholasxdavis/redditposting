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

export async function getRecentUserSubmissions(username, { limit = 25 } = {}) {
  const { ok, data } = await oauthFetch(`/user/${encodeURIComponent(username)}/submitted?limit=${limit}`);
  if (!ok) return [];
  return (data?.data?.children ?? [])
    .map((child) => child?.data)
    .filter(Boolean);
}

/** Returns matching post if user already submitted a POTD-style post for targetDayKey (ET). */
export async function findRecentPotdPost(
  subreddit,
  { titleNeedle = 'Picks of the Day', targetDayKey = null, timeZone = 'America/New_York', maxAgeHours = 48 } = {},
) {
  const me = await getRedditMe();
  if (!me?.name) return null;

  const cutoff = Date.now() - maxAgeHours * 3_600_000;
  const needle = titleNeedle.toLowerCase();
  const sub = subreddit.toLowerCase();

  for (const post of await getRecentUserSubmissions(me.name)) {
    if (String(post.subreddit ?? '').toLowerCase() !== sub) continue;
    if ((post.created_utc ?? 0) * 1000 < cutoff) continue;
    if (!String(post.title ?? '').toLowerCase().includes(needle)) continue;
    if (targetDayKey) {
      const postDay = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date((post.created_utc ?? 0) * 1000));
      if (postDay !== targetDayKey) continue;
    }
    return { id: post.id ?? post.name, title: post.title, url: post.url };
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
