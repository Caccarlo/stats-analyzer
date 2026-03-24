import { useState, useEffect, useRef } from 'react';
import type { FoulMatchup, PlayerPosition } from '@/types';
import { getMatchComments, getMatchAveragePositions } from '@/api/sofascore';
import { extractFoulsForPlayer, extractSubstitutionInfo } from '@/utils/foulPairing';

interface MatchDetailsResult {
  fouls: FoulMatchup[];
  positions: { home: PlayerPosition[]; away: PlayerPosition[] } | null;
  substituteInMinute?: number;
  substituteOutMinute?: number;
  loading: boolean;
  error: string | null;
}

interface CachedResult {
  fouls: FoulMatchup[];
  positions: { home: PlayerPosition[]; away: PlayerPosition[] } | null;
  substituteInMinute?: number;
  substituteOutMinute?: number;
}

const cache = new Map<string, CachedResult>();

export function useMatchDetails(
  eventId: number | null,
  playerId: number | null,
  enabled: boolean = true
): MatchDetailsResult {
  const [fouls, setFouls] = useState<FoulMatchup[]>([]);
  const [positions, setPositions] = useState<{ home: PlayerPosition[]; away: PlayerPosition[] } | null>(null);
  const [subIn, setSubIn] = useState<number | undefined>();
  const [subOut, setSubOut] = useState<number | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!eventId || !playerId || !enabled) return;

    const key = `${eventId}-${playerId}`;

    // Check cache
    if (cache.has(key)) {
      const cached = cache.get(key)!;
      setFouls(cached.fouls);
      setPositions(cached.positions);
      setSubIn(cached.substituteInMinute);
      setSubOut(cached.substituteOutMinute);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([
      getMatchComments(eventId),
      getMatchAveragePositions(eventId),
    ])
      .then(([comments, avgPos]) => {
        if (cancelled) return;

        const matchFouls = extractFoulsForPlayer(comments, playerId);
        const subInfo = extractSubstitutionInfo(comments, playerId);

        const result: CachedResult = {
          fouls: matchFouls,
          positions: avgPos,
          substituteInMinute: subInfo.inMinute,
          substituteOutMinute: subInfo.outMinute,
        };
        cache.set(key, result);

        setFouls(matchFouls);
        setPositions(avgPos);
        setSubIn(subInfo.inMinute);
        setSubOut(subInfo.outMinute);
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
    loading,
    error,
  };
}
