import type { PlayerSeasonStats, AggregatedStats } from '@/types';
import { getShotsCount, getShotsOnTargetCount } from '@/utils/playerStats';

export function calculateStats(statsByTournament: PlayerSeasonStats[]): AggregatedStats {
  const totals = statsByTournament.reduce(
    (acc, s) => ({
      fouls: acc.fouls + (s.fouls ?? 0),
      wasFouled: acc.wasFouled + (s.wasFouled ?? 0),
      shots: acc.shots + (getShotsCount(s) ?? 0),
      shotsOnTarget: acc.shotsOnTarget + (getShotsOnTargetCount(s) ?? 0),
      minutesPlayed: acc.minutesPlayed + (s.minutesPlayed ?? 0),
      appearances: acc.appearances + (s.appearances ?? 0),
      yellowCards: acc.yellowCards + (s.yellowCards ?? 0),
      redCards: acc.redCards + (s.redCards ?? 0),
    }),
    { fouls: 0, wasFouled: 0, shots: 0, shotsOnTarget: 0, minutesPlayed: 0, appearances: 0, yellowCards: 0, redCards: 0 }
  );

  const safeDiv = (a: number, b: number) => (b > 0 ? (a / b).toFixed(2) : '0.00');

  return {
    totalFoulsCommitted: totals.fouls,
    totalFoulsSuffered: totals.wasFouled,
    totalShots: totals.shots,
    totalShotsOnTarget: totals.shotsOnTarget,
    totalMinutesPlayed: totals.minutesPlayed,
    totalAppearances: totals.appearances,
    avgFoulsCommittedPerMatch: safeDiv(totals.fouls, totals.appearances),
    avgFoulsCommittedPer90: safeDiv(totals.fouls * 90, totals.minutesPlayed),
    avgFoulsSufferedPerMatch: safeDiv(totals.wasFouled, totals.appearances),
    avgFoulsSufferedPer90: safeDiv(totals.wasFouled * 90, totals.minutesPlayed),
    avgShotsPerMatch: safeDiv(totals.shots, totals.appearances),
    avgShotsPer90: safeDiv(totals.shots * 90, totals.minutesPlayed),
    avgShotsOnTargetPerMatch: safeDiv(totals.shotsOnTarget, totals.appearances),
    avgShotsOnTargetPer90: safeDiv(totals.shotsOnTarget * 90, totals.minutesPlayed),
    totalYellowCards: totals.yellowCards,
    totalRedCards: totals.redCards,
    avgYellowCardsPerMatch: safeDiv(totals.yellowCards, totals.appearances),
    avgRedCardsPerMatch: safeDiv(totals.redCards, totals.appearances),
  };
}
