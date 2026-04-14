import type {
  Player,
  Tournament,
  Season,
  TournamentSeason,
  PlayerSeasonStats,
  NationalTeamStat,
  PlayerMatchStatistics,
  PlayerEventIncidents,
  MatchEvent,
  MatchDurationMetadata,
  MatchComment,
  MatchLineups,
  PlayerPosition,
  HeatmapPoint,
  StandingGroup,
  StandingRow,
  SearchResult,
  PlayerSearchResult,
  TeamSearchResult,
} from '@/types';

// === Cache ===

type CacheEntry =
  | { kind: 'data'; data: unknown; timestamp: number }
  | { kind: 'absence'; data: unknown; timestamp: number }
  | { kind: 'error'; error: { message: string; status?: number }; timestamp: number };

interface ApiFetchOptions<T> {
  useCache?: boolean;
  notFoundValue?: T;
}

class ApiFetchError extends Error {
  status?: number;
  isTerminal: boolean;

  constructor(message: string, status?: number, isTerminal = false) {
    super(message);
    this.name = 'ApiFetchError';
    this.status = status;
    this.isTerminal = isTerminal;
  }
}

const cache = new Map<string, CacheEntry>();
const inFlightRequests = new Map<string, Promise<unknown>>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minuti

function isTerminalHttpStatus(status: number): boolean {
  return status >= 400 && status < 500 && status !== 429;
}

function getCached(key: string): CacheEntry | null {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.timestamp < CACHE_TTL) {
    return entry;
  }
  cache.delete(key);
  return null;
}

function setDataCache(key: string, data: unknown) {
  cache.set(key, { kind: 'data', data, timestamp: Date.now() });
}

function setAbsenceCache(key: string, data: unknown) {
  cache.set(key, { kind: 'absence', data, timestamp: Date.now() });
}

function setErrorCache(key: string, error: ApiFetchError) {
  cache.set(key, {
    kind: 'error',
    error: { message: error.message, status: error.status },
    timestamp: Date.now(),
  });
}

// === Helper con retry e cache ===

async function apiFetch<T>(path: string, useCacheOrOptions: boolean | ApiFetchOptions<T> = true): Promise<T> {
  const options = typeof useCacheOrOptions === 'boolean'
    ? { useCache: useCacheOrOptions }
    : useCacheOrOptions;
  const useCache = options.useCache ?? true;

  if (useCache) {
    const cached = getCached(path);
    if (cached) {
      if (cached.kind === 'error') {
        throw new ApiFetchError(cached.error.message, cached.error.status, true);
      }
      return cached.data as T;
    }
  }

  const inFlight = inFlightRequests.get(path);
  if (inFlight) {
    return inFlight as Promise<T>;
  }

  const request = (async () => {
    let lastError: Error | null = null;
    const delays = [0, 1000, 2000]; // retry con backoff

    for (let attempt = 0; attempt < delays.length; attempt++) {
      if (delays[attempt] > 0) {
        await new Promise((r) => setTimeout(r, delays[attempt]));
      }
      try {
        const res = await fetch(`/api/sofascore/${path}`);
        if (!res.ok) {
          if (res.status === 404 && options.notFoundValue !== undefined) {
            if (useCache) setAbsenceCache(path, options.notFoundValue);
            return options.notFoundValue;
          }

          const error = new ApiFetchError(
            `API error ${res.status}: ${path}`,
            res.status,
            isTerminalHttpStatus(res.status),
          );

          if (error.isTerminal) {
            if (useCache) setErrorCache(path, error);
            throw error;
          }

          lastError = error;
          continue;
        }
        const data: T = await res.json();
        if (useCache) setDataCache(path, data);
        return data;
      } catch (e: unknown) {
        const error = e instanceof ApiFetchError
          ? e
          : new ApiFetchError(String(e));
        if (error.isTerminal) throw error;
        lastError = error;
      }
    }

    throw lastError ?? new Error(`Failed after retries: ${path}`);
  })();

  inFlightRequests.set(path, request);
  try {
    return await request;
  } finally {
    inFlightRequests.delete(path);
  }
}

// === Ricerca ===

export async function searchAll(query: string): Promise<SearchResult[]> {
  const data = await apiFetch<{ results?: SearchResult[] }>(
    `search/all?q=${encodeURIComponent(query)}&page=0`
  );
  return (data.results ?? []).filter((r): r is SearchResult => {
    if (r.type === 'player') {
      const entity = (r as PlayerSearchResult).entity;
      const playerSport = entity.sport;
      const teamSport = (entity.team as unknown as { sport?: { slug: string } } | undefined)?.sport;
      const sport = playerSport ?? teamSport;
      return !sport || sport.slug === 'football';
    }
    if (r.type === 'team') return (r as TeamSearchResult).entity.sport?.slug === 'football';
    if (r.type === 'uniqueTournament') return true;
    return false;
  });
}

/** @deprecated Use searchAll instead */
export async function searchPlayers(query: string): Promise<PlayerSearchResult[]> {
  const results = await searchAll(query);
  return results.filter((r): r is PlayerSearchResult => r.type === 'player');
}

// === Categorie / Paesi ===

export async function getCategories(): Promise<{ id: number; name: string; slug: string; alpha2?: string }[]> {
  const data = await apiFetch<{ categories: { id: number; name: string; slug: string; alpha2?: string }[] }>(
    'sport/football/categories'
  );
  return data.categories ?? [];
}

// === Tornei ===

export async function getCategoryTournaments(categoryId: number): Promise<Tournament[]> {
  const data = await apiFetch<{
    groups?: Array<{ uniqueTournaments?: Tournament[] }>;
    uniqueTournaments?: Tournament[];
  }>(`category/${categoryId}/unique-tournaments`);

  const tournaments = [
    ...(data.uniqueTournaments ?? []),
    ...(data.groups?.flatMap((group) => group.uniqueTournaments ?? []) ?? []),
  ];

  const deduped = new Map<number, Tournament>();
  tournaments.forEach((tournament) => {
    if (!deduped.has(tournament.id)) {
      deduped.set(tournament.id, tournament);
    }
  });

  return [...deduped.values()];
}

export async function getTournamentSeasons(tournamentId: number): Promise<Season[]> {
  const data = await apiFetch<{ seasons: Season[] }>(
    `unique-tournament/${tournamentId}/seasons`
  );
  return data.seasons ?? [];
}

export async function getSeasonStandings(tournamentId: number, seasonId: number): Promise<StandingRow[]> {
  const data = await apiFetch<{ standings: StandingGroup[] }>(
    `unique-tournament/${tournamentId}/season/${seasonId}/standings/total`
  );
  return data.standings?.[0]?.rows ?? [];
}

export async function getSeasonStandingGroups(tournamentId: number, seasonId: number): Promise<StandingGroup[]> {
  const data = await apiFetch<{ standings: StandingGroup[] }>(
    `unique-tournament/${tournamentId}/season/${seasonId}/standings/total`
  );
  return data.standings ?? [];
}

async function getTournamentSeasonEventsByDirection(
  tournamentId: number,
  seasonId: number,
  direction: 'last' | 'next',
): Promise<MatchEvent[]> {
  const events: MatchEvent[] = [];

  for (let page = 0; page < 20; page++) {
    try {
      const data = await apiFetch<{ events?: MatchEvent[]; hasNextPage?: boolean }>(
        `unique-tournament/${tournamentId}/season/${seasonId}/events/${direction}/${page}`,
        { notFoundValue: { events: [], hasNextPage: false } },
      );
      events.push(...(data.events ?? []));
      if (!data.hasNextPage) break;
    } catch (error) {
      if (page === 0) return [];
      throw error;
    }
  }

  return events;
}

export async function getTournamentSeasonEvents(
  tournamentId: number,
  seasonId: number,
): Promise<MatchEvent[]> {
  const [lastEvents, nextEvents] = await Promise.all([
    getTournamentSeasonEventsByDirection(tournamentId, seasonId, 'last'),
    getTournamentSeasonEventsByDirection(tournamentId, seasonId, 'next'),
  ]);

  const deduped = new Map<number, MatchEvent>();
  [...lastEvents, ...nextEvents].forEach((event) => {
    if (!deduped.has(event.id)) {
      deduped.set(event.id, event);
    }
  });

  return [...deduped.values()];
}

// === Squadra ===

export async function getTeamPlayers(teamId: number): Promise<{ player: Player }[]> {
  const data = await apiFetch<{ players: { player: Player }[] }>(
    `team/${teamId}/players`
  );
  return data.players ?? [];
}

export async function getTeamNextEvent(teamId: number): Promise<MatchEvent | null> {
  const data = await apiFetch<{ events: MatchEvent[] }>(
    `team/${teamId}/events/next/0`
  );
  return data.events?.[0] ?? null;
}

export async function getTeamEventsByDirection(
  teamId: number,
  direction: 'last' | 'next',
  page: number
): Promise<MatchEvent[]> {
  const data = await apiFetch<{ events: MatchEvent[] }>(
    `team/${teamId}/events/${direction}/${page}`
  );
  return data.events ?? [];
}

// === Giocatore ===

export async function getPlayerInfo(playerId: number): Promise<Player | null> {
  try {
    const data = await apiFetch<{ player: Player }>(`player/${playerId}`);
    return data.player ?? null;
  } catch {
    return null;
  }
}

export async function getPlayerSeasons(playerId: number): Promise<TournamentSeason[]> {
  const data = await apiFetch<{ uniqueTournamentSeasons: TournamentSeason[] }>(
    `player/${playerId}/statistics/seasons`
  );
  return data.uniqueTournamentSeasons ?? [];
}

export async function getPlayerNationalStats(playerId: number): Promise<NationalTeamStat[]> {
  try {
    const data = await apiFetch<{ statistics?: NationalTeamStat[] }>(
      `player/${playerId}/national-team-statistics`
    );
    return [...(data.statistics ?? [])].sort((a, b) => a.debutTimestamp - b.debutTimestamp);
  } catch {
    return [];
  }
}

export async function getPlayerSeasonStats(
  playerId: number,
  tournamentId: number,
  seasonId: number
): Promise<PlayerSeasonStats | null> {
  try {
    const data = await apiFetch<{ statistics: PlayerSeasonStats }>(
      `player/${playerId}/unique-tournament/${tournamentId}/season/${seasonId}/statistics/overall`
    );
    return data.statistics ?? null;
  } catch {
    return null;
  }
}

export async function getPlayerEvents(
  playerId: number,
  page: number = 0
): Promise<{
  events: MatchEvent[];
  hasNextPage: boolean;
  statisticsMap: Record<string, PlayerMatchStatistics>;
  incidentsMap: Record<string, PlayerEventIncidents>;
  onBenchMap: Record<string, boolean>;
}> {
  const data = await apiFetch<{
    events: MatchEvent[];
    hasNextPage: boolean;
    statisticsMap?: Record<string, PlayerMatchStatistics>;
    incidentsMap?: Record<string, PlayerEventIncidents>;
    onBenchMap?: Record<string, boolean>;
  }>(
    `player/${playerId}/events/last/${page}`
  );
  return {
    events: data.events ?? [],
    hasNextPage: data.hasNextPage ?? false,
    statisticsMap: data.statisticsMap ?? {},
    incidentsMap: data.incidentsMap ?? {},
    onBenchMap: data.onBenchMap ?? {},
  };
}

// === Partita ===

export async function getMatchComments(eventId: number): Promise<MatchComment[]> {
  const data = await apiFetch<{ comments: MatchComment[] }>(
    `event/${eventId}/comments`
  );
  return data.comments ?? [];
}

export async function getPlayerMatchStatistics(
  eventId: number,
  playerId: number
): Promise<PlayerMatchStatistics | null> {
  try {
    const data = await apiFetch<{ statistics: PlayerMatchStatistics }>(
      `event/${eventId}/player/${playerId}/statistics`
    );
    return data.statistics ?? null;
  } catch {
    return null;
  }
}

export async function getMatchLineups(eventId: number): Promise<MatchLineups | null> {
  try {
    const data = await apiFetch<MatchLineups>(
      `event/${eventId}/lineups`
    );
    return data;
  } catch {
    return null;
  }
}

export async function getMatchDurationMetadata(
  eventId: number
): Promise<MatchDurationMetadata | null> {
  try {
    const data = await apiFetch<{ event?: MatchDurationMetadata }>(
      `event/${eventId}`
    );
    if (!data.event) return null;
    return {
      defaultPeriodCount: data.event.defaultPeriodCount,
      defaultPeriodLength: data.event.defaultPeriodLength,
      defaultOvertimeLength: data.event.defaultOvertimeLength,
      time: data.event.time,
      homeScore: data.event.homeScore,
      awayScore: data.event.awayScore,
    };
  } catch {
    return null;
  }
}

export async function getMatchAveragePositions(
  eventId: number
): Promise<{ home: PlayerPosition[]; away: PlayerPosition[] } | null> {
  try {
    const data = await apiFetch<{ home: PlayerPosition[]; away: PlayerPosition[] }>(
      `event/${eventId}/average-positions`
    );
    return data;
  } catch {
    return null;
  }
}

export async function getPlayerMatchHeatmap(
  eventId: number,
  playerId: number
): Promise<HeatmapPoint[]> {
  try {
    const data = await apiFetch<{ heatmap: HeatmapPoint[] }>(
      `event/${eventId}/player/${playerId}/heatmap`
    );
    return data.heatmap ?? [];
  } catch {
    return [];
  }
}

// === Immagini (restituiscono URL, non fetch) ===

export function getTeamImageUrl(teamId: number): string {
  return `/api/img/team/${teamId}/image`;
}

export function getPlayerImageUrl(playerId: number): string {
  return `/api/img/player/${playerId}/image`;
}

export function getTournamentImageUrl(tournamentId: number): string {
  return `/api/img/unique-tournament/${tournamentId}/image`;
}

export function getCategoryImageUrl(categoryId: number): string {
  return `/api/img/category/${categoryId}/image`;
}

// === Calendario giornaliero ===

export async function getScheduledEvents(date: string, skipCache = false): Promise<MatchEvent[]> {
  const data = await apiFetch<{ events?: MatchEvent[] }>(
    `sport/football/scheduled-events/${date}`,
    { useCache: !skipCache }
  );
  return data.events ?? [];
}
