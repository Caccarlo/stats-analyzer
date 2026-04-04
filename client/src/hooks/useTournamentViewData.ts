import { useEffect, useState } from 'react';
import {
  getSeasonStandingGroups,
  getSeasonStandings,
  getTournamentSeasonEvents,
  getTournamentSeasons,
} from '@/api/sofascore';
import type { Season, StandingGroup, StandingRow, TournamentPhase } from '@/types';
import { buildTournamentPhases, isPhaseBasedCompetition } from '@/utils/tournamentPhases';

type CompetitionMode = 'standings' | 'phases';

interface TournamentViewData {
  tournamentId: number;
  seasonId: number | null;
  seasons: Season[];
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
  seasons: Season[];
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
const GROUP_SECTION_PATTERN = /\b(group|gruppo)\s+([a-z]|\d{1,2})\b/i;

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
}

function setLatestCachedTournamentViewData(data: TournamentViewData): void {
  if (data.seasonId == null) return;
  latestTournamentViewDataCache.set(data.tournamentId, { data, timestamp: Date.now() });
}

function hasDisplayableTournamentContent(data: TournamentViewData): boolean {
  if (data.mode === 'phases') return data.phases.length > 0;
  return data.teams.length > 0;
}

function normalizeStandingLabel(value: string | null | undefined): string {
  return (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getGroupSectionCode(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = value.trim().match(GROUP_SECTION_PATTERN);
  return match?.[2]?.toUpperCase() ?? null;
}

function attachStandingsToPhases(
  phases: TournamentPhase[],
  standingGroups: StandingGroup[],
): TournamentPhase[] {
  if (!standingGroups.length) return phases;

  const normalizedStandingGroups = standingGroups.map((group) => ({
    rows: group.rows ?? [],
    normalizedName: normalizeStandingLabel(group.name),
    groupCode: getGroupSectionCode(group.name),
  }));
  const singleStandingRows = normalizedStandingGroups.length === 1
    ? normalizedStandingGroups[0].rows
    : [];

  return phases.map((phase) => {
    const phaseNormalizedName = normalizeStandingLabel(phase.name);
    const phaseNormalizedKey = normalizeStandingLabel(phase.key);
    const sections = phase.sections.map((section) => {
      const sectionNormalizedLabel = normalizeStandingLabel(section.label);
      const sectionGroupCode = getGroupSectionCode(section.label);
      const matchingStanding = normalizedStandingGroups.find((group) => (
        (sectionNormalizedLabel.length > 0 && group.normalizedName === sectionNormalizedLabel)
        || (sectionGroupCode != null && group.groupCode === sectionGroupCode)
      ));

      return {
        ...section,
        standings: matchingStanding?.rows ?? [],
      };
    });

    const hasSectionStandings = sections.some((section) => section.standings.length > 0);
    const exactPhaseStanding = normalizedStandingGroups.find((group) => (
      (phaseNormalizedName.length > 0 && group.normalizedName === phaseNormalizedName)
      || (phaseNormalizedKey.length > 0 && group.normalizedName === phaseNormalizedKey)
    ));
    const shouldUseSingleStandingForPhase = !hasSectionStandings
      && singleStandingRows.length > 0
      && (
        phase.key === 'league-phase'
        || phaseNormalizedName.includes('league phase')
        || phaseNormalizedName.includes('group stage')
        || phases.length === 1
      );

    return {
      ...phase,
      standings: exactPhaseStanding?.rows ?? (shouldUseSingleStandingForPhase ? singleStandingRows : []),
      sections,
    };
  });
}

function hasVisiblePhaseContent(phase: TournamentPhase): boolean {
  if (phase.teams.length > 0 || phase.standings.length > 0) return true;
  return phase.sections.some((section) => section.teams.length > 0 || section.standings.length > 0);
}

async function fetchTournamentSeasonViewData(
  tournamentId: number,
  season: Season,
  seasons: Season[],
): Promise<TournamentViewData> {
  const resolvedCache = getFreshCacheEntry(
    tournamentViewDataCache.get(buildSeasonCacheKey(tournamentId, season.id)),
  );
  if (resolvedCache) {
    if (resolvedCache.seasons === seasons) return resolvedCache;
    return { ...resolvedCache, seasons };
  }

  const events = await getTournamentSeasonEvents(tournamentId, season.id);
  const derivedPhases = buildTournamentPhases(events);
  let standingGroups: StandingGroup[] = [];
  try {
    standingGroups = await getSeasonStandingGroups(tournamentId, season.id);
  } catch {
    standingGroups = [];
  }

  const enrichedPhases = attachStandingsToPhases(derivedPhases, standingGroups);
  const visiblePhases = enrichedPhases.filter(hasVisiblePhaseContent);

  if (isPhaseBasedCompetition(derivedPhases)) {
    const data: TournamentViewData = {
      tournamentId,
      seasonId: season.id,
      seasons,
      mode: 'phases',
      teams: [],
      phases: visiblePhases,
    };
    setCachedTournamentViewData(data);
    return data;
  }

  try {
    const standings = standingGroups[0]?.rows?.length
      ? standingGroups[0].rows
      : await getSeasonStandings(tournamentId, season.id);
    const data: TournamentViewData = {
      tournamentId,
      seasonId: season.id,
      seasons,
      mode: 'standings',
      teams: standings,
      phases: [],
    };
    setCachedTournamentViewData(data);
    return data;
  } catch (error) {
    if (enrichedPhases.length > 0) {
      const data: TournamentViewData = {
        tournamentId,
        seasonId: season.id,
        seasons,
        mode: 'phases',
        teams: [],
        phases: visiblePhases,
      };
      setCachedTournamentViewData(data);
      return data;
    }
    throw error;
  }
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
        seasons: [],
        mode: 'standings',
        teams: [],
        phases: [],
      };
      return emptyData;
    }

    if (preferredSeasonId != null) {
      const currentSeason = seasons.find((season) => season.id === preferredSeasonId) ?? seasons[0];
      return fetchTournamentSeasonViewData(tournamentId, currentSeason, seasons);
    }

    let fallbackData: TournamentViewData | null = null;

    for (const season of seasons) {
      const data = await fetchTournamentSeasonViewData(tournamentId, season, seasons);
      if (!fallbackData) fallbackData = data;
      if (hasDisplayableTournamentContent(data)) {
        setLatestCachedTournamentViewData(data);
        return data;
      }
    }

    if (fallbackData) {
      setLatestCachedTournamentViewData(fallbackData);
      return fallbackData;
    }

    const firstSeason = seasons[0];
    if (!firstSeason) {
      const emptyData: TournamentViewData = {
        tournamentId,
        seasonId: null,
        seasons,
        mode: 'standings',
        teams: [],
        phases: [],
      };
      return emptyData;
    }
    return fetchTournamentSeasonViewData(tournamentId, firstSeason, seasons);
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
    seasons: resolvedData?.seasons ?? [],
    mode: resolvedData?.mode ?? 'standings',
    teams: resolvedData?.teams ?? [],
    phases: resolvedData?.phases ?? [],
    loading,
    error,
  };
}
