import type { PlayerMatchStatistics, PlayerSeasonStats } from '@/types';

type StatsLike = PlayerMatchStatistics | PlayerSeasonStats | null | undefined;

function getNumericStat(stats: StatsLike, keys: string[]): number | null {
  if (!stats) return null;
  const record = stats as Record<string, unknown>;

  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  }

  return null;
}

const SHOTS_KEYS = [
  'totalShots',
  'shots',
  'shotTotal',
  'shotsTotal',
  'scoringAttempt',
] as const;

const SHOTS_ON_TARGET_KEYS = [
  'shotsOnTarget',
  'shotOnTarget',
  'onTargetScoringAttempt',
  'shotsOnGoal',
  'shotsOnTargetTotal',
] as const;

export function getShotsCount(stats: StatsLike): number | null {
  return getNumericStat(stats, [...SHOTS_KEYS]);
}

export function getShotsOnTargetCount(stats: StatsLike): number | null {
  return getNumericStat(stats, [...SHOTS_ON_TARGET_KEYS]);
}
