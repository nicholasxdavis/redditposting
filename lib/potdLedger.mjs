import { POTD_SUBREDDIT } from './config.mjs';

export const DEFAULT_TIMEZONE = 'America/New_York';
export { POTD_SUBREDDIT };
export const LEDGER_VERSION = 1;
export const POTD_MAX_PICKS = 5;
export const POTD_MIN_VERIFIED = 1;
export const POTD_MAX_VERIFIED = 2;

const VERIFIED_SOURCE_KINDS = new Set(['verified_curated', 'daily_pick']);

const GAME_END_BUFFER_MS = 6 * 60 * 60 * 1000;
const STALE_NO_START_MS = 48 * 60 * 60 * 1000;

const SOURCE_WEIGHT = {
  model_edge: 25,
  verified_curated: 15,
  daily_pick: 10,
};

export function etDateKey(date = new Date(), timeZone = DEFAULT_TIMEZONE) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/** True during 11:00 AM–12:59 PM ET — scheduled POTD post window. */
export function isPotdPostWindow(now = new Date(), timeZone = DEFAULT_TIMEZONE) {
  const hour = Number(new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    hour12: false,
  }).format(now));
  return hour >= 11 && hour < 13;
}

export function yesterdayEtDateKey(now = new Date(), timeZone = DEFAULT_TIMEZONE) {
  const todayKey = etDateKey(now, timeZone);
  const [y, m, d] = todayKey.split('-').map(Number);
  const ref = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  ref.setUTCDate(ref.getUTCDate() - 1);
  return etDateKey(ref, timeZone);
}

/** Pick was on the ledger at some point during sourceDayKey (ET calendar day). */
export function pickActiveOnEtDay(entry, sourceDayKey, timeZone = DEFAULT_TIMEZONE) {
  if (!entry?.firstSeenAt || !entry?.lastSeenAt) return false;
  const firstDay = etDateKey(new Date(entry.firstSeenAt), timeZone);
  const lastDay = etDateKey(new Date(entry.lastSeenAt), timeZone);
  return firstDay <= sourceDayKey && lastDay >= sourceDayKey;
}

export function emptyLedger() {
  return {
    version: LEDGER_VERSION,
    updatedAt: new Date().toISOString(),
    picks: {},
    posts: {},
  };
}

export function parseLedger(raw) {
  if (!raw || typeof raw !== 'object') return emptyLedger();
  const picks = raw.picks && typeof raw.picks === 'object' ? raw.picks : {};
  const posts = raw.posts && typeof raw.posts === 'object' ? raw.posts : {};
  return {
    version: typeof raw.version === 'number' ? raw.version : LEDGER_VERSION,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString(),
    picks: { ...picks },
    posts: { ...posts },
  };
}

export function pickToLedgerEntry(pick, now = new Date()) {
  const iso = now.toISOString();
  const parsed = pick.parsed ?? {};
  const qualityScore = typeof pick.qualityScore === 'number' ? pick.qualityScore : 0;

  return {
    id: String(pick.id),
    sourceKind: pick.sourceKind,
    sport: parsed.sport,
    event: parsed.event,
    pickText: parsed.pickText,
    startsAt: parsed.startsAt,
    marketType: parsed.marketType,
    marketLabel: parsed.marketLabel,
    qualityScore,
    expertRoi: parsed.expertRoi ?? null,
    edge: parsed.edge ?? null,
    awayTeam: parsed.awayTeam,
    homeTeam: parsed.homeTeam,
    oddsHint: parsed.oddsHint,
    firstSeenAt: iso,
    lastSeenAt: iso,
    seenCount: 1,
    peakQualityScore: qualityScore,
  };
}

export function mergePicksIntoLedger(ledger, picks, now = new Date()) {
  const iso = now.toISOString();

  for (const pick of picks) {
    if (!pick?.id) continue;
    const existing = ledger.picks[pick.id];
    const parsed = pick.parsed ?? {};

    if (!existing) {
      ledger.picks[pick.id] = pickToLedgerEntry(pick, now);
      continue;
    }

    existing.lastSeenAt = iso;
    existing.seenCount += 1;
    const qualityScore = typeof pick.qualityScore === 'number' ? pick.qualityScore : 0;
    existing.peakQualityScore = Math.max(existing.peakQualityScore ?? 0, qualityScore);
    existing.qualityScore = qualityScore;

    if (parsed.sport) existing.sport = parsed.sport;
    if (parsed.event) existing.event = parsed.event;
    if (parsed.pickText) existing.pickText = parsed.pickText;
    if (parsed.startsAt) existing.startsAt = parsed.startsAt;
    if (parsed.marketType) existing.marketType = parsed.marketType;
    if (parsed.marketLabel) existing.marketLabel = parsed.marketLabel;
    if (parsed.awayTeam) existing.awayTeam = parsed.awayTeam;
    if (parsed.homeTeam) existing.homeTeam = parsed.homeTeam;
    if (parsed.oddsHint) existing.oddsHint = parsed.oddsHint;
    if (parsed.expertRoi != null) existing.expertRoi = parsed.expertRoi;
    if (parsed.edge != null) existing.edge = parsed.edge;
  }

  ledger.updatedAt = iso;
  return ledger;
}

export function pruneLedger(ledger, now = new Date()) {
  const nowMs = now.getTime();

  for (const [id, entry] of Object.entries(ledger.picks)) {
    if (entry.startsAt) {
      const startMs = new Date(entry.startsAt).getTime();
      if (Number.isFinite(startMs) && nowMs > startMs + GAME_END_BUFFER_MS) {
        delete ledger.picks[id];
        continue;
      }
    }

    const lastMs = new Date(entry.lastSeenAt).getTime();
    if (!entry.startsAt && Number.isFinite(lastMs) && nowMs - lastMs > STALE_NO_START_MS) {
      delete ledger.picks[id];
    }
  }

  return ledger;
}

export function computeRankScore(entry) {
  const seenCount = Number(entry.seenCount) || 0;
  const peakQualityScore = Number(entry.peakQualityScore) || 0;
  const expertRoi = entry.expertRoi != null ? Number(entry.expertRoi) : 0;
  const edge = entry.edge != null ? Number(entry.edge) : 0;
  const kind = String(entry.sourceKind ?? '');
  const id = String(entry.id ?? '');
  let sourceWeight = SOURCE_WEIGHT[kind] ?? 10;
  if (kind === 'verified_curated' && id.startsWith('an:')) sourceWeight = 15;

  return seenCount * 3 + peakQualityScore * 0.5 + expertRoi * 2 + edge * 4 + sourceWeight;
}

function eventDedupeKey(entry) {
  const event = String(entry.event ?? '').trim().toLowerCase();
  const market = String(entry.marketType ?? entry.marketLabel ?? '').trim().toLowerCase();
  return `${event}::${market}`;
}

/** @param {string} kind */
export function isVerifiedSourceKind(kind) {
  return VERIFIED_SOURCE_KINDS.has(kind);
}

export function isModelSourceKind(kind) {
  return kind === 'model_edge';
}

/** Skip model rows with missing matchup labels or placeholder pick copy. */
export function isPotdEligibleEntry(entry) {
  const event = String(entry.event ?? '').trim();
  if (!event || event.toLowerCase() === 'upcoming match') return false;
  const pickText = String(entry.pickText ?? '').trim();
  if (isVerifiedSourceKind(entry.sourceKind)) {
    return Boolean(pickText || (entry.awayTeam && entry.homeTeam));
  }
  if (!pickText || /^(home|away) line\b/i.test(pickText)) return false;
  return true;
}

function passesPotdSlateFilter(entry, { nowMs, targetDayKey, timeZone }) {
  if (isModelSourceKind(entry.sourceKind)) {
    if (!entry.startsAt) return false;
    if (etDateKey(new Date(entry.startsAt), timeZone) !== targetDayKey) return false;
    const startMs = new Date(entry.startsAt).getTime();
    return Number.isFinite(startMs) && startMs > nowMs;
  }
  if (isVerifiedSourceKind(entry.sourceKind)) {
    if (!entry.startsAt) return true;
    const startMs = new Date(entry.startsAt).getTime();
    if (Number.isFinite(startMs) && startMs <= nowMs) return false;
    return etDateKey(new Date(entry.startsAt), timeZone) === targetDayKey;
  }
  return false;
}

function rankPool(entries) {
  return entries
    .map((entry) => ({ entry, score: computeRankScore(entry) }))
    .sort((a, b) => b.score - a.score);
}

function sortPotdDisplayOrder(selected) {
  return [...selected].sort((a, b) => {
    const av = isVerifiedSourceKind(a.sourceKind) ? 0 : 1;
    const bv = isVerifiedSourceKind(b.sourceKind) ? 0 : 1;
    if (av !== bv) return av - bv;
    const as = a.startsAt ? new Date(a.startsAt).getTime() : Number.POSITIVE_INFINITY;
    const bs = b.startsAt ? new Date(b.startsAt).getTime() : Number.POSITIVE_INFINITY;
    return as - bs;
  });
}

export function selectPotdPicks(ledger, opts = {}) {
  const now = opts.now ?? new Date();
  const timeZone = opts.timeZone ?? DEFAULT_TIMEZONE;
  const maxPicks = opts.maxPicks ?? POTD_MAX_PICKS;
  const minVerified = opts.minVerified ?? POTD_MIN_VERIFIED;
  const maxVerified = opts.maxVerified ?? POTD_MAX_VERIFIED;
  const sourceDayKey = opts.sourceDayKey ?? yesterdayEtDateKey(now, timeZone);
  const targetDayKey = opts.targetDayKey ?? etDateKey(now, timeZone);
  const postedForDate = Object.hasOwn(opts, 'postedForDate')
    ? opts.postedForDate
    : (ledger.posts?.postedForDate ?? null);

  if (postedForDate === targetDayKey) return [];

  const nowMs = now.getTime();
  const pool = Object.values(ledger.picks).filter((entry) => {
    if (!isPotdEligibleEntry(entry)) return false;
    if (!pickActiveOnEtDay(entry, sourceDayKey, timeZone)) return false;
    return passesPotdSlateFilter(entry, { nowMs, targetDayKey, timeZone });
  });

  const verifiedRanked = rankPool(pool.filter((entry) => isVerifiedSourceKind(entry.sourceKind)));
  const modelRanked = rankPool(pool.filter((entry) => isModelSourceKind(entry.sourceKind)));

  const selected = [];
  const seenEvents = new Set();

  function tryAdd(entry) {
    if (selected.length >= maxPicks) return false;
    const key = eventDedupeKey(entry);
    if (key !== '::' && seenEvents.has(key)) return false;
    if (key !== '::') seenEvents.add(key);
    selected.push(entry);
    return true;
  }

  let verifiedCount = 0;
  for (const { entry } of verifiedRanked) {
    if (verifiedCount >= maxVerified) break;
    if (tryAdd(entry)) verifiedCount += 1;
  }

  for (const { entry } of modelRanked) {
    if (selected.length >= maxPicks) break;
    tryAdd(entry);
  }

  if (verifiedCount < minVerified) {
    for (const { entry } of verifiedRanked) {
      if (verifiedCount >= minVerified || selected.length >= maxPicks) break;
      if (selected.includes(entry)) continue;
      if (tryAdd(entry)) verifiedCount += 1;
    }
  }

  return sortPotdDisplayOrder(selected);
}
