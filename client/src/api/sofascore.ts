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
  StandingRow,
  SearchResult,
} from '@/types';

// === Cache ===

const cache = new Map<string, { data: unknown; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minuti

function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.timestamp < CACHE_TTL) {
    return entry.data as T;
  }
  cache.delete(key);
  return null;
}

function setCache(key: string, data: unknown) {
  cache.set(key, { data, timestamp: Date.now() });
}

// === Helper con retry e cache ===

async function apiFetch<T>(path: string, useCache = true): Promise<T> {
  if (useCache) {
    const cached = getCached<T>(path);
    if (cached) return cached;
  }

  let lastError: Error | null = null;
  const delays = [0, 1000, 2000]; // retry con backoff

  for (let attempt = 0; attempt < delays.length; attempt++) {
    if (delays[attempt] > 0) {
      await new Promise((r) => setTimeout(r, delays[attempt]));
    }
    try {
      const res = await fetch(`/api/sofascore/${path}`);
      if (!res.ok) {
        throw new Error(`API error ${res.status}: ${path}`);
      }
      const data: T = await res.json();
      if (useCache) setCache(path, data);
      return data;
    } catch (e: unknown) {
      lastError = e instanceof Error ? e : new Error(String(e));
    }
  }

  throw lastError ?? new Error(`Failed after retries: ${path}`);
}

// === Ricerca ===

export async function searchPlayers(query: string): Promise<SearchResult[]> {
  const data = await apiFetch<{ results?: SearchResult[] }>(
    `search/all?q=${encodeURIComponent(query)}&page=0`
  );
  return (data.results ?? []).filter((r) => r.type === 'player');
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
  const data = await apiFetch<{ standings: { rows: StandingRow[] }[] }>(
    `unique-tournament/${tournamentId}/season/${seasonId}/standings/total`
  );
  return data.standings?.[0]?.rows ?? [];
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
        `unique-tournament/${tournamentId}/season/${seasonId}/events/${direction}/${page}`
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
