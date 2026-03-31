import type { PlayerSeasonStats, AggregatedStats } from '@/types';

export function calculateStats(statsByTournament: PlayerSeasonStats[]): AggregatedStats {
  const totals = statsByTournament.reduce(
    (acc, s) => ({
      fouls: acc.fouls + (s.fouls ?? 0),
      wasFouled: acc.wasFouled + (s.wasFouled ?? 0),
      minutesPlayed: acc.minutesPlayed + (s.minutesPlayed ?? 0),
      appearances: acc.appearances + (s.appearances ?? 0),
      yellowCards: acc.yellowCards + (s.yellowCards ?? 0),
      redCards: acc.redCards + (s.redCards ?? 0),
    }),
    { fouls: 0, wasFouled: 0, minutesPlayed: 0, appearances: 0, yellowCards: 0, redCards: 0 }
  );

  const safeDiv = (a: number, b: number) => (b > 0 ? (a / b).toFixed(2) : '0.00');

  return {
    totalFoulsCommitted: totals.fouls,
    totalFoulsSuffered: totals.wasFouled,
    totalMinutesPlayed: totals.minutesPlayed,
    totalAppearances: totals.appearances,
    avgFoulsCommittedPerMatch: safeDiv(totals.fouls, totals.appearances),
    avgFoulsCommittedPer90: safeDiv(totals.fouls * 90, totals.minutesPlayed),
    avgFoulsSufferedPerMatch: safeDiv(totals.wasFouled, totals.appearances),
    avgFoulsSufferedPer90: safeDiv(totals.wasFouled * 90, totals.minutesPlayed),
    totalYellowCards: totals.yellowCards,
    totalRedCards: totals.redCards,
    avgYellowCardsPerMatch: safeDiv(totals.yellowCards, totals.appearances),
    avgRedCardsPerMatch: safeDiv(totals.redCards, totals.appearances),
  };
}
