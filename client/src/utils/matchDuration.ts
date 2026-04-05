import type { MatchDurationMetadata } from '@/types';

function hasExplicitOvertime(score: MatchDurationMetadata['homeScore'] | undefined): boolean {
  return Boolean(
    score &&
    (
      typeof score.period3 === 'number' ||
      typeof score.period4 === 'number' ||
      typeof score.extra1 === 'number' ||
      typeof score.extra2 === 'number'
    )
  );
}

export function getBaseDuration(metadata: MatchDurationMetadata | null | undefined): number {
  if (
    typeof metadata?.defaultPeriodCount === 'number' &&
    typeof metadata.defaultPeriodLength === 'number' &&
    metadata.defaultPeriodCount > 0 &&
    metadata.defaultPeriodLength > 0
  ) {
    return metadata.defaultPeriodCount * metadata.defaultPeriodLength;
  }

  return 90;
}

export function getOvertimeDuration(metadata: MatchDurationMetadata | null | undefined): number {
  if (
    typeof metadata?.defaultOvertimeLength === 'number' &&
    metadata.defaultOvertimeLength > 0 &&
    (hasExplicitOvertime(metadata?.homeScore) || hasExplicitOvertime(metadata?.awayScore))
  ) {
    return metadata.defaultOvertimeLength * 2;
  }

  return 0;
}

export function getNominalMatchDuration(metadata: MatchDurationMetadata | null | undefined): number {
  return Math.max(1, getBaseDuration(metadata) + getOvertimeDuration(metadata));
}

export function getMatchDuration(metadata: MatchDurationMetadata | null | undefined): number {
  return getNominalMatchDuration(metadata);
}

export function clampMinute(value: number, max: number): number {
  return Math.min(max, Math.max(0, value));
}

export function isLikelyFullMatch(
  minutesPlayed: number,
  nominalMatchDuration: number,
): boolean {
  return minutesPlayed >= Math.max(1, nominalMatchDuration - 1);
}
