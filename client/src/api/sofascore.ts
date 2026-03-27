import type {
  Player,
  Team,
  Tournament,
  Season,
  TournamentSeason,
  PlayerSeasonStats,
  MatchEvent,
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
    } catch (e: any) {
      lastError = e;
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
): Promise<{ events: MatchEvent[]; hasNextPage: boolean }> {
  const data = await apiFetch<{ events: MatchEvent[]; hasNextPage: boolean }>(
    `player/${playerId}/events/last/${page}`
  );
  return {
    events: data.events ?? [],
    hasNextPage: data.hasNextPage ?? false,
  };
}

// === Partita ===

export async function getMatchComments(eventId: number): Promise<MatchComment[]> {
  const data = await apiFetch<{ comments: MatchComment[] }>(
    `event/${eventId}/comments`
  );
  return data.comments ?? [];
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
