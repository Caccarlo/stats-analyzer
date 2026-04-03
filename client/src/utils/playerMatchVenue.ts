import type { MatchEvent } from '@/types';
import type { CachedMatchDetails } from '@/hooks/useMatchDetails';

export function resolvePlayerMatchSide(
  event: MatchEvent,
  details: CachedMatchDetails | undefined,
  playerTeamId?: number,
): 'home' | 'away' | undefined {
  const side = details?.playerSide;
  if (side !== undefined) return side;

  if (playerTeamId != null) {
    if (event.homeTeam.id === playerTeamId) return 'home';
    if (event.awayTeam.id === playerTeamId) return 'away';
  }

  return undefined;
}

export function getPlayerMatchIsHome(
  event: MatchEvent,
  details: CachedMatchDetails | undefined,
  playerTeamId?: number,
): boolean | null {
  const side = resolvePlayerMatchSide(event, details, playerTeamId);
  if (side === 'home') return true;
  if (side === 'away') return false;
  return null;
}
