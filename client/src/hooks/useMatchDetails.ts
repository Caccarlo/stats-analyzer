import { useState, useEffect } from 'react';
import type { FoulMatchup, PlayerPosition, CardInfo } from '@/types';
import { getMatchComments, getMatchAveragePositions } from '@/api/sofascore';
import { extractFoulsForPlayer, extractSubstitutionInfo, extractCardInfo } from '@/utils/foulPairing';

export interface CachedMatchDetails {
  fouls: FoulMatchup[];
  positions: { home: PlayerPosition[]; away: PlayerPosition[] } | null;
  substituteInMinute?: number;
  substituteOutMinute?: number;
  cardInfo: CardInfo | null;
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

  const [comments, avgPos] = await Promise.all([
    getMatchComments(eventId),
    getMatchAveragePositions(eventId),
  ]);

  const matchFouls = extractFoulsForPlayer(comments, playerId);
  const subInfo = extractSubstitutionInfo(comments, playerId);
  const cardInfo = extractCardInfo(comments, playerId);

  const result: CachedMatchDetails = {
    fouls: matchFouls,
    positions: avgPos,
    substituteInMinute: subInfo.inMinute,
    substituteOutMinute: subInfo.outMinute,
    cardInfo,
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
    loading,
    error,
  };
}