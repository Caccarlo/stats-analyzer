import { useEffect, useState } from 'react';
import { getSeasonStandings, getTournamentSeasonEvents, getTournamentSeasons } from '@/api/sofascore';
import type { StandingRow, TournamentPhase } from '@/types';
import { buildTournamentPhases, isPhaseBasedCompetition } from '@/utils/tournamentPhases';

type CompetitionMode = 'standings' | 'phases';

interface TournamentViewData {
  tournamentId: number;
  seasonId: number | null;
  mode: CompetitionMode;
  teams: StandingRow[];
  phases: TournamentPhase[];
}

interface TournamentViewCacheEntry {
  data: TournamentViewData;
  timestamp: number;
}

interface UseTournamentViewDataResult {
  seasonId: number | null;
  mode: CompetitionMode;
  teams: StandingRow[];
  phases: TournamentPhase[];
  loading: boolean;
  error: string | null;
}

const TOURNAMENT_VIEW_CACHE_TTL = 5 * 60 * 1000;
const tournamentViewDataCache = new Map<string, TournamentViewCacheEntry>();
const latestTournamentViewDataCache = new Map<number, TournamentViewCacheEntry>();
const tournamentViewDataInFlight = new Map<string, Promise<TournamentViewData>>();

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Errore nel caricamento delle squadre';
}

function buildSeasonCacheKey(tournamentId: number, seasonId: number): string {
  return `${tournamentId}:${seasonId}`;
}

function getFreshCacheEntry(entry: TournamentViewCacheEntry | undefined): TournamentViewData | null {
  if (!entry) return null;
  if (Date.now() - entry.timestamp > TOURNAMENT_VIEW_CACHE_TTL) return null;
  return entry.data;
}

function getCachedTournamentViewData(
  tournamentId: number,
  preferredSeasonId?: number,
): TournamentViewData | null {
  if (preferredSeasonId != null) {
    const cachedBySeason = getFreshCacheEntry(
      tournamentViewDataCache.get(buildSeasonCacheKey(tournamentId, preferredSeasonId)),
    );
    if (cachedBySeason) return cachedBySeason;
  }

  const latestCached = getFreshCacheEntry(latestTournamentViewDataCache.get(tournamentId));
  if (!latestCached) return null;
  if (preferredSeasonId != null && latestCached.seasonId !== preferredSeasonId) return null;
  return latestCached;
}

function setCachedTournamentViewData(data: TournamentViewData): void {
  if (data.seasonId == null) return;

  const entry = { data, timestamp: Date.now() };
  tournamentViewDataCache.set(buildSeasonCacheKey(data.tournamentId, data.seasonId), entry);
  latestTournamentViewDataCache.set(data.tournamentId, entry);
}

async function fetchTournamentViewData(
  tournamentId: number,
  preferredSeasonId?: number,
): Promise<TournamentViewData> {
  const cached = getCachedTournamentViewData(tournamentId, preferredSeasonId);
  if (cached) return cached;

  const inFlightKey = preferredSeasonId != null
    ? buildSeasonCacheKey(tournamentId, preferredSeasonId)
    : `latest:${tournamentId}`;
  const existingRequest = tournamentViewDataInFlight.get(inFlightKey);
  if (existingRequest) return existingRequest;

  const request = (async () => {
    const seasons = await getTournamentSeasons(tournamentId);
    if (!seasons.length) {
      const emptyData: TournamentViewData = {
        tournamentId,
        seasonId: null,
        mode: 'standings',
        teams: [],
        phases: [],
      };
      return emptyData;
    }

    const currentSeason = seasons.find((season) => season.id === preferredSeasonId) ?? seasons[0];
    const resolvedCache = getFreshCacheEntry(
      tournamentViewDataCache.get(buildSeasonCacheKey(tournamentId, currentSeason.id)),
    );
    if (resolvedCache) return resolvedCache;

    const events = await getTournamentSeasonEvents(tournamentId, currentSeason.id);
    const derivedPhases = buildTournamentPhases(events);

    if (isPhaseBasedCompetition(derivedPhases)) {
      const data: TournamentViewData = {
        tournamentId,
        seasonId: currentSeason.id,
        mode: 'phases',
        teams: [],
        phases: derivedPhases,
      };
      setCachedTournamentViewData(data);
      return data;
    }

    try {
      const standings = await getSeasonStandings(tournamentId, currentSeason.id);
      const data: TournamentViewData = {
        tournamentId,
        seasonId: currentSeason.id,
        mode: 'standings',
        teams: standings,
        phases: [],
      };
      setCachedTournamentViewData(data);
      return data;
    } catch (error) {
      if (derivedPhases.length > 0) {
        const data: TournamentViewData = {
          tournamentId,
          seasonId: currentSeason.id,
          mode: 'phases',
          teams: [],
          phases: derivedPhases,
        };
        setCachedTournamentViewData(data);
        return data;
      }
      throw error;
    }
  })();

  tournamentViewDataInFlight.set(inFlightKey, request);
  try {
    return await request;
  } finally {
    tournamentViewDataInFlight.delete(inFlightKey);
  }
}

export function useTournamentViewData(
  tournamentId: number,
  preferredSeasonId?: number,
): UseTournamentViewDataResult {
  const requestKey = `${tournamentId}:${preferredSeasonId ?? 'latest'}`;
  const [loadedData, setLoadedData] = useState<TournamentViewData | null>(
    () => getCachedTournamentViewData(tournamentId, preferredSeasonId),
  );
  const [errorState, setErrorState] = useState<{ key: string; message: string } | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetchTournamentViewData(tournamentId, preferredSeasonId)
      .then((data) => {
        if (cancelled) return;
        setLoadedData(data);
        setErrorState(null);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setErrorState({ key: requestKey, message: getErrorMessage(error) });
      });

    return () => { cancelled = true; };
  }, [tournamentId, preferredSeasonId, requestKey]);

  const cachedData = getCachedTournamentViewData(tournamentId, preferredSeasonId);
  const resolvedData = cachedData ?? (
    loadedData
    && loadedData.tournamentId === tournamentId
    && (preferredSeasonId == null || loadedData.seasonId === preferredSeasonId)
      ? loadedData
      : null
  );
  const error = errorState?.key === requestKey ? errorState.message : null;
  const loading = resolvedData == null && error == null;

  return {
    seasonId: resolvedData?.seasonId ?? null,
    mode: resolvedData?.mode ?? 'standings',
    teams: resolvedData?.teams ?? [],
    phases: resolvedData?.phases ?? [],
    loading,
    error,
  };
}
