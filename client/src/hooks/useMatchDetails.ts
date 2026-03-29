import { useState, useEffect } from 'react';
import type { FoulMatchup, PlayerPosition, CardInfo } from '@/types';
import { getMatchComments, getMatchAveragePositions, getMatchLineups } from '@/api/sofascore';
import { extractFoulsForPlayer, extractSubstitutionInfo, extractCardInfo } from '@/utils/foulPairing';

export interface CachedMatchDetails {
  fouls: FoulMatchup[];
  positions: { home: PlayerPosition[]; away: PlayerPosition[] } | null;
  substituteInMinute?: number;
  substituteOutMinute?: number;
  cardInfo: CardInfo | null;
  didNotPlay: boolean;
}

interface MatchDetailsResult extends CachedMatchDetails {
  loading: boolean;
  error: string | null;
}

// Shared module-level cache — used by both useMatchDetails and useMatchTimeline
export const matchDetailsCache = new Map<string, CachedMatchDetails>();

// Standalone fetch function — checks cache, fetches if needed, stores result
export async function fetchMatchDetails(
  eventId: number,
  playerId: number,
): Promise<CachedMatchDetails> {
  const key = `${eventId}-${playerId}`;

  const cached = matchDetailsCache.get(key);
  if (cached) return cached;

  const [comments, avgPos, lineups] = await Promise.all([
    getMatchComments(eventId),
    getMatchAveragePositions(eventId),
    getMatchLineups(eventId),
  ]);

  const matchFouls = extractFoulsForPlayer(comments, playerId);
  const subInfo = extractSubstitutionInfo(comments, playerId);
  const cardInfo = extractCardInfo(comments, playerId);

  let didNotPlay = false;
  if (lineups && comments.length > 0) {
    const allPlayers = [...lineups.home.players, ...lineups.away.players];
    const inLineup = allPlayers.find((lp) => lp.player.id === playerId);
    const appearsInComments = comments.some(
      (c) => c.player?.id === playerId || c.playerIn?.id === playerId || c.playerOut?.id === playerId
    );
    if (inLineup && inLineup.substitute === true && !appearsInComments) {
      didNotPlay = true;
    }
  }

  const result: CachedMatchDetails = {
    fouls: matchFouls,
    positions: avgPos,
    substituteInMinute: subInfo.inMinute,
    substituteOutMinute: subInfo.outMinute,
    cardInfo,
    didNotPlay,
  };
  matchDetailsCache.set(key, result);
  return result;
}

export function useMatchDetails(
  eventId: number | null,
  playerId: number | null,
  enabled: boolean = true
): MatchDetailsResult {
  const [fouls, setFouls] = useState<FoulMatchup[]>([]);
  const [positions, setPositions] = useState<{ home: PlayerPosition[]; away: PlayerPosition[] } | null>(null);
  const [subIn, setSubIn] = useState<number | undefined>();
  const [subOut, setSubOut] = useState<number | undefined>();
  const [cardInfo, setCardInfo] = useState<CardInfo | null>(null);
  const [didNotPlay, setDidNotPlay] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!eventId || !playerId || !enabled) return;

    const key = `${eventId}-${playerId}`;

    if (matchDetailsCache.has(key)) {
      const cached = matchDetailsCache.get(key)!;
      setFouls(cached.fouls);
      setPositions(cached.positions);
      setSubIn(cached.substituteInMinute);
      setSubOut(cached.substituteOutMinute);
      setCardInfo(cached.cardInfo);
      setDidNotPlay(cached.didNotPlay);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchMatchDetails(eventId, playerId)
      .then((result) => {
        if (cancelled) return;
        setFouls(result.fouls);
        setPositions(result.positions);
        setSubIn(result.substituteInMinute);
        setSubOut(result.substituteOutMinute);
        setCardInfo(result.cardInfo);
        setDidNotPlay(result.didNotPlay);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [eventId, playerId, enabled]);

  return {
    fouls,
    positions,
    substituteInMinute: subIn,
    substituteOutMinute: subOut,
    cardInfo,
    didNotPlay,
    loading,
    error,
  };
}