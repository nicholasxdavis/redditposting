import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatPotdBody, formatPotdTitle, sanitizePotdText } from '../lib/formatPotdPost.mjs';
import {
  computeRankScore,
  emptyLedger,
  etDateKey,
  mergePicksIntoLedger,
  parseLedger,
  pickActiveOnEtDay,
  pruneLedger,
  selectPotdPicks,
  yesterdayEtDateKey,
} from '../lib/potdLedger.mjs';

const TZ = 'America/New_York';

function makePick(id, overrides = {}) {
  return {
    id,
    sourceKind: 'model_edge',
    qualityScore: 40,
    parsed: {
      sport: 'NBA',
      event: 'Lakers @ Celtics',
      pickText: 'Lakers ML +145',
      startsAt: '2026-06-30T23:00:00.000Z',
      marketType: 'h2h',
      edge: 4.2,
      awayTeam: 'Lakers',
      homeTeam: 'Celtics',
      ...overrides.parsed,
    },
    ...overrides,
  };
}

describe('potdLedger', () => {
  it('merges seenCount', () => {
    const ledger = emptyLedger();
    mergePicksIntoLedger(ledger, [makePick('m1')], new Date('2026-06-29T13:00:00.000Z'));
    mergePicksIntoLedger(ledger, [makePick('m1')], new Date('2026-06-29T14:00:00.000Z'));
    assert.equal(ledger.picks.m1.seenCount, 2);
  });

  it('prunes ended games', () => {
    const ledger = emptyLedger();
    mergePicksIntoLedger(ledger, [makePick('old', { parsed: { startsAt: '2026-06-30T10:00:00.000Z' } })], new Date('2026-06-30T20:00:00.000Z'));
    pruneLedger(ledger, new Date('2026-06-30T20:00:00.000Z'));
    assert.equal(ledger.picks.old, undefined);
  });

  it('selects yesterday pool for today slate', () => {
    const ledger = emptyLedger();
    mergePicksIntoLedger(ledger, [makePick('today')], new Date('2026-06-29T20:00:00.000Z'));
    assert.equal(selectPotdPicks(ledger, { now: new Date('2026-06-30T16:00:00.000Z'), timeZone: TZ }).length, 1);
  });

  it('includes picks still merged after source day ends', () => {
    const ledger = emptyLedger();
    mergePicksIntoLedger(ledger, [makePick('carry')], new Date('2026-06-29T22:00:00.000Z'));
    mergePicksIntoLedger(ledger, [makePick('carry')], new Date('2026-06-30T05:00:00.000Z'));
    assert.equal(selectPotdPicks(ledger, { now: new Date('2026-06-30T16:00:00.000Z'), timeZone: TZ }).length, 1);
  });

  it('pickActiveOnEtDay uses first/last seen overlap', () => {
    const entry = { firstSeenAt: '2026-06-28T12:00:00.000Z', lastSeenAt: '2026-06-30T05:00:00.000Z' };
    assert.equal(pickActiveOnEtDay(entry, '2026-06-29', TZ), true);
    assert.equal(pickActiveOnEtDay(entry, '2026-06-27', TZ), false);
  });

  it('yesterdayEtDateKey follows ET calendar', () => {
    const now = new Date('2026-06-30T04:00:00.000Z');
    assert.equal(yesterdayEtDateKey(now, TZ), '2026-06-29');
  });

  it('parseLedger tolerates partial rows', () => {
    const ledger = parseLedger({ picks: { a: { id: 'a', seenCount: 1 } } });
    assert.equal(ledger.picks.a.id, 'a');
  });

  it('ranks persistence and edge', () => {
    assert.ok(
      computeRankScore({ seenCount: 10, peakQualityScore: 10, edge: 5, sourceKind: 'model_edge', id: 'b' })
      > computeRankScore({ seenCount: 1, peakQualityScore: 10, edge: 1, sourceKind: 'daily_pick', id: 'a' }),
    );
  });

  it('reserves verified picks alongside model edges', () => {
    const ledger = emptyLedger();
    const now = new Date('2026-06-30T16:00:00.000Z');
    mergePicksIntoLedger(ledger, [makePick('model-a')], now);
    mergePicksIntoLedger(ledger, [{
      id: 'potd:1',
      sourceKind: 'daily_pick',
      qualityScore: 200,
      parsed: {
        sport: 'Tennis',
        event: 'Ann Li vs Sonmez',
        pickText: 'Sonmez ML @ 1.80',
        awayTeam: 'Ann Li',
        homeTeam: 'Sonmez',
      },
    }], now);
    const selected = selectPotdPicks(ledger, { now, timeZone: TZ, sourceDayKey: '2026-06-30' });
    assert.ok(selected.some((p) => p.sourceKind === 'daily_pick'));
    assert.ok(selected.some((p) => p.sourceKind === 'model_edge'));
  });
});

describe('formatPotdPost', () => {
  it('strips em dashes', () => {
    assert.ok(!sanitizePotdText('A — B').includes('—'));
  });

  it('formats post copy', () => {
    const picks = [{
      sport: 'NBA',
      pickText: 'Lakers ML +145',
      startsAt: '2026-06-30T23:00:00.000Z',
      awayTeam: 'Lakers',
      homeTeam: 'Celtics',
      sourceKind: 'model_edge',
      edge: 4.2,
    }];
    assert.match(formatPotdTitle(picks, { now: new Date('2026-06-30T16:00:00.000Z'), timeZone: TZ }), /Picks of the Day/);
    assert.match(formatPotdBody(picks, { timeZone: TZ }), /best-picks/);
  });

  it('labels verified and model support lines', () => {
    const body = formatPotdBody([
      { sport: 'Tennis', pickText: 'Sonmez ML', sourceKind: 'daily_pick', peakQualityScore: 80, awayTeam: 'A', homeTeam: 'B' },
      { sport: 'NBA', pickText: 'Lakers ML', sourceKind: 'model_edge', edge: 4.2, awayTeam: 'Lakers', homeTeam: 'Celtics', startsAt: '2026-06-30T23:00:00.000Z' },
    ], { timeZone: TZ });
    assert.match(body, /Verified community pick/);
    assert.match(body, /Model edge/);
  });
});
