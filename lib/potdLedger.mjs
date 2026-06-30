import { POTD_SUBREDDIT } from './config.mjs';

export const DEFAULT_TIMEZONE = 'America/New_York';
export { POTD_SUBREDDIT };
export const LEDGER_VERSION = 1;
export const POTD_MAX_PICKS = 5;

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

export function yesterdayEtDateKey(now = new Date(), timeZone = DEFAULT_TIMEZONE) {
  const copy = new Date(now);
  copy.setDate(copy.getDate() - 1);
  return etDateKey(copy, timeZone);
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

export function selectPotdPicks(ledger, opts = {}) {
  const now = opts.now ?? new Date();
  const timeZone = opts.timeZone ?? DEFAULT_TIMEZONE;
  const maxPicks = opts.maxPicks ?? POTD_MAX_PICKS;
  const sourceDayKey = opts.sourceDayKey ?? yesterdayEtDateKey(now, timeZone);
  const targetDayKey = opts.targetDayKey ?? etDateKey(now, timeZone);
  const postedForDate = opts.postedForDate ?? ledger.posts?.postedForDate ?? null;

  if (postedForDate === targetDayKey) return [];

  const nowMs = now.getTime();
  const pool = Object.values(ledger.picks).filter((entry) => {
    if (!entry?.startsAt) return false;
    if (etDateKey(new Date(entry.lastSeenAt), timeZone) !== sourceDayKey) return false;
    if (etDateKey(new Date(entry.startsAt), timeZone) !== targetDayKey) return false;
    const startMs = new Date(entry.startsAt).getTime();
    if (!Number.isFinite(startMs) || startMs <= nowMs) return false;
    return true;
  });

  const ranked = pool
    .map((entry) => ({ entry, score: computeRankScore(entry) }))
    .sort((a, b) => b.score - a.score);

  const selected = [];
  const seenEvents = new Set();

  for (const { entry } of ranked) {
    if (selected.length >= maxPicks) break;
    const key = eventDedupeKey(entry);
    if (key !== '::' && seenEvents.has(key)) continue;
    if (key !== '::') seenEvents.add(key);
    selected.push(entry);
  }

  return selected;
}
