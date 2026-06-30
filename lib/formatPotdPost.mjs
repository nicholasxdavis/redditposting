import { DEFAULT_SITE_URL } from './config.mjs';
import { DEFAULT_TIMEZONE } from './potdLedger.mjs';

const SITE_URL = (process.env.SIYF_SITE_URL || DEFAULT_SITE_URL).replace(/\/$/, '');

export function sanitizePotdText(text) {
  return String(text ?? '')
    .replace(/\u2014/g, ' · ')
    .replace(/\u2013/g, ' · ')
    .replace(/\s--\s/g, ' · ')
    .replace(/\s-\s/g, ' · ')
    .trim();
}

export function formatTimeEt(iso, timeZone = DEFAULT_TIMEZONE) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(date);
}

export function formatTitleDate(now = new Date(), timeZone = DEFAULT_TIMEZONE) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(now);
}

export function buildSportMixLabel(picks) {
  const sports = [...new Set(picks.map((p) => String(p.sport ?? '').trim()).filter(Boolean))];
  if (!sports.length) return 'Sports';
  if (sports.length === 1) return sports[0];
  if (sports.length === 2) return `${sports[0]} and ${sports[1]}`;
  return `${sports.slice(0, -1).join(', ')}, and ${sports[sports.length - 1]}`;
}

function formatSupportLine(entry) {
  const edge = entry.edge != null ? Number(entry.edge) : null;
  const expertRoi = entry.expertRoi != null ? Number(entry.expertRoi) : null;
  const ranking = entry.peakQualityScore != null ? Number(entry.peakQualityScore) : null;

  if (edge != null && Number.isFinite(edge) && entry.sourceKind === 'model_edge') {
    const sign = edge > 0 ? '+' : '';
    return `Model edge ${sign}${Math.round(edge * 10) / 10}%`;
  }
  if (expertRoi != null && Number.isFinite(expertRoi) && expertRoi > 0) {
    return `Expert ROI +${Math.round(expertRoi * 10) / 10}%`;
  }
  if (ranking != null && Number.isFinite(ranking) && ranking > 0 && entry.sourceKind === 'daily_pick') {
    const pct = Math.min(100, Math.round(ranking * 3 * 10) / 10);
    return `Community ranking +${pct}%`;
  }
  return null;
}

function formatMatchupLine(entry) {
  const away = entry.awayTeam;
  const home = entry.homeTeam;
  if (away && home) return `${away} @ ${home}`;
  return sanitizePotdText(entry.event ?? '');
}

export function formatPotdTitle(picks, opts = {}) {
  const now = opts.now ?? new Date();
  const mix = buildSportMixLabel(picks);
  const dateLabel = formatTitleDate(now, opts.timeZone);
  return sanitizePotdText(`${mix} Picks of the Day | ${dateLabel}`);
}

export function formatPotdBody(picks, opts = {}) {
  const timeZone = opts.timeZone ?? DEFAULT_TIMEZONE;
  const lines = ["Top plays for today's slate from the Siyf! hourly picks board.", ''];

  for (const entry of picks) {
    const matchup = formatMatchupLine(entry);
    const sport = sanitizePotdText(entry.sport ?? 'Sports');
    const time = formatTimeEt(entry.startsAt, timeZone);
    const pickText = sanitizePotdText(entry.pickText ?? '');
    const support = formatSupportLine(entry);

    lines.push(`**${matchup}** · ${sport} · ${time}`);
    if (pickText) lines.push(`Pick: ${pickText}`);
    if (support) lines.push(support);
    lines.push('');
  }

  lines.push(`Full board: ${SITE_URL}/best-picks`);
  return sanitizePotdText(lines.join('\n'));
}
