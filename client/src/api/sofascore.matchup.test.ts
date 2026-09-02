import { describe, expect, it } from 'vitest';

import { resolveMatchupFromSummaries } from '@/api/sofascore';
import type { TeamNextMatchSummary } from '@/types';

const summary: TeamNextMatchSummary = {
  eventId: 9999,
  startTimestamp: 1_800_000_000,
  homeTeamId: 1,
  homeTeamName: 'Cagliari',
  awayTeamId: 2,
  awayTeamName: 'Inter',
  leagueId: 23,
  leagueName: 'Serie A',
  seasonId: 2026,
  seasonYear: '2026/27',
};

describe('matchup target resolution', () => {
  it('preserva il kickoff dello snapshot condiviso', () => {
    expect(resolveMatchupFromSummaries(summary, { ...summary })).toMatchObject({
      eventId: summary.eventId,
      startTimestamp: summary.startTimestamp,
      seasonId: summary.seasonId,
      seasonYear: summary.seasonYear,
    });
  });
});
