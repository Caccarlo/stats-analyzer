import { useState, useEffect } from 'react';
import type {
  FoulMatchup,
  PlayerPosition,
  CardInfo,
  MatchComment,
  MatchLineups,
  PlayerMatchStatistics,
  PlayerEventIncidents,
  DataAvailability,
} from '@/types';
import {
  getMatchComments,
  getMatchLineups,
  getPlayerMatchStatistics,
} from '@/api/sofascore';
import { extractFoulsForPlayer, extractSubstitutionInfo, extractCardInfo } from '@/utils/foulPairing';

export interface MatchDetailsSeed {
  officialStats?: PlayerMatchStatistics | null;
  incidents?: PlayerEventIncidents | null;
  onBench?: boolean;
}

export interface CachedMatchDetails {
  officialStats: PlayerMatchStatistics | null;
  officialStatsStatus: DataAvailability;
  fouls: FoulMatchup[];
  commentsStatus: DataAvailability;
  commentsAvailable: boolean;
  positions: { home: PlayerPosition[]; away: PlayerPosition[] } | null;
  positionsStatus: DataAvailability;
  substituteInMinute?: number;
  substituteOutMinute?: number;
  cardInfo: CardInfo | null;
  cardInfoStatus: DataAvailability;
  didNotPlay: boolean;
  isStarter?: boolean;
  playerSide: 'home' | 'away' | undefined;
  lineupsStatus: DataAvailability;
  jerseyMap: Map<number, string>;
  onBench: boolean;
}

interface MatchDetailsResult extends CachedMatchDetails {
  loading: boolean;
  error: string | null;
}

export const matchDetailsCache = new Map<string, CachedMatchDetails>();
export const matchCommentsCache = new Map<number, MatchComment[]>();
export const matchLineupsCache = new Map<number, MatchLineups | null>();
export const matchPlayerStatsCache = new Map<string, PlayerMatchStatistics | null>();

function deriveCardInfo(
  incidents?: PlayerEventIncidents | null,
  commentCardInfo?: CardInfo | null,
): CardInfo | null {
  if (incidents?.yellowRedCards && incidents.yellowRedCards > 0) {
    return { type: 'yellowRed' };
  }
  if (incidents?.redCards && incidents.redCards > 0) {
    return { type: 'red' };
  }
  if (incidents?.yellowCards && incidents.yellowCards > 0) {
    return { type: 'yellow' };
  }
  return commentCardInfo ?? null;
}

function deriveCardStatus(
  incidents?: PlayerEventIncidents | null,
  commentCardInfo?: CardInfo | null,
  commentsStatus: DataAvailability = 'idle',
): DataAvailability {
  if (incidents || commentCardInfo) return 'loaded';
  if (commentsStatus === 'loading') return 'loading';
  if (commentsStatus === 'error') return 'error';
  if (commentsStatus === 'loaded' || commentsStatus === 'unavailable') return 'unavailable';
  return 'idle';
}

function deriveDidNotPlay(
  playerId: number,
  lineups: MatchLineups | null,
  onBench: boolean,
  officialStats: PlayerMatchStatistics | null,
  substituteInMinute?: number,
): boolean {
  const minutes = officialStats?.minutesPlayed;
  if (typeof minutes === 'number' && minutes > 0) return false;
  if (typeof substituteInMinute === 'number') return false;

  if (lineups) {
    const allPlayers = [...lineups.home.players, ...lineups.away.players];
    const inLineup = allPlayers.find((lp) => lp.player.id === playerId);
    if (inLineup?.substitute === true) return true;
  }

  return onBench && (minutes == null || minutes === 0);
}

function buildJerseyMap(lineups: MatchLineups | null): Map<number, string> {
  const jerseyMap = new Map<number, string>();
  if (!lineups) return jerseyMap;

  [...lineups.home.players, ...lineups.away.players].forEach((lp) => {
    if (lp.player.jerseyNumber) jerseyMap.set(lp.player.id, lp.player.jerseyNumber);
  });

  return jerseyMap;
}

function deriveStarterFlag(
  playerId: number,
  lineups: MatchLineups | null,
): boolean | undefined {
  if (!lineups) return undefined;

  const allPlayers = [...lineups.home.players, ...lineups.away.players];
  const lineupPlayer = allPlayers.find((lp) => lp.player.id === playerId);
  if (!lineupPlayer) return undefined;

  return lineupPlayer.substitute !== true;
}

function derivePlayerSide(
  playerId: number,
  lineups: MatchLineups | null,
): 'home' | 'away' | undefined {
  if (!lineups) return undefined;
  if (lineups.home.players.some((lp) => lp.player.id === playerId)) return 'home';
  if (lineups.away.players.some((lp) => lp.player.id === playerId)) return 'away';
  return undefined;
}

export function createSeededMatchDetails(seed?: MatchDetailsSeed): CachedMatchDetails {
  return {
    officialStats: seed?.officialStats ?? null,
    officialStatsStatus: seed?.officialStats ? 'loaded' : 'idle',
    fouls: [],
    commentsStatus: 'idle',
    commentsAvailable: false,
    positions: null,
    positionsStatus: 'idle',
    substituteInMinute: undefined,
    substituteOutMinute: undefined,
    cardInfo: deriveCardInfo(seed?.incidents ?? null, null),
    cardInfoStatus: seed?.incidents ? 'loaded' : 'idle',
    didNotPlay: Boolean(
      seed?.onBench &&
      (seed?.officialStats?.minutesPlayed == null || seed.officialStats.minutesPlayed === 0)
    ),
    isStarter: undefined,
    playerSide: undefined,
    lineupsStatus: 'idle',
    jerseyMap: new Map<number, string>(),
    onBench: seed?.onBench ?? false,
  };
}

function mergeWithSeed(cached: CachedMatchDetails, seed?: MatchDetailsSeed): CachedMatchDetails {
  if (!seed) return cached;
  return {
    ...cached,
    officialStats: cached.officialStats ?? seed.officialStats ?? null,
    officialStatsStatus:
      cached.officialStatsStatus === 'loaded' || !seed.officialStats ? cached.officialStatsStatus : 'loaded',
    cardInfo: cached.cardInfo ?? deriveCardInfo(seed.incidents ?? null, null),
    cardInfoStatus:
      cached.cardInfoStatus === 'loaded' || !seed.incidents ? cached.cardInfoStatus : 'loaded',
    didNotPlay:
      cached.didNotPlay ||
      Boolean(seed.onBench && (cached.officialStats?.minutesPlayed == null || cached.officialStats.minutesPlayed === 0)),
    onBench: cached.onBench || Boolean(seed.onBench),
  };
}

// ── Fetch solo officialStats per una partita specifica ──
export async function fetchMatchOfficialStats(
  eventId: number,
  playerId: number,
  seedStats: PlayerMatchStatistics | null,
): Promise<{
  officialStats: PlayerMatchStatistics | null;
  officialStatsStatus: DataAvailability;
}> {
  const key = `${eventId}-${playerId}`;

  if (matchPlayerStatsCache.has(key)) {
    const stats = matchPlayerStatsCache.get(key) ?? null;
    return {
      officialStats: stats,
      officialStatsStatus: stats ? 'loaded' : 'unavailable',
    };
  }

  try {
    const stats = await getPlayerMatchStatistics(eventId, playerId);
    matchPlayerStatsCache.set(key, stats);
    const resolved = stats ?? seedStats;
    return {
      officialStats: resolved,
      officialStatsStatus: resolved ? 'loaded' : 'unavailable',
    };
  } catch {
    return {
      officialStats: seedStats,
      officialStatsStatus: seedStats ? 'loaded' : 'error',
    };
  }
}

// ── Patch helper: aggiorna parzialmente la cache senza sovrascrivere tutti i campi ──
export function patchMatchDetailsCache(
  eventId: number,
  playerId: number,
  patch: Partial<CachedMatchDetails>,
): void {
  const key = `${eventId}-${playerId}`;
  const existing = matchDetailsCache.get(key);
  if (existing) {
    matchDetailsCache.set(key, { ...existing, ...patch });
  }
}

// ── Fetch solo lineups (per filtro Titolare, senza bloccare il caricamento principale) ──
export async function fetchMatchLineupsOnly(
  eventId: number,
  playerId: number,
  onBench: boolean,
  officialStats: PlayerMatchStatistics | null,
): Promise<{
  lineupsStatus: DataAvailability;
  jerseyMap: Map<number, string>;
  didNotPlay: boolean;
  isStarter: boolean | undefined;
  playerSide: 'home' | 'away' | undefined;
}> {
  if (matchLineupsCache.has(eventId)) {
    const lineups = matchLineupsCache.get(eventId) ?? null;
    const lineupsStatus: DataAvailability = lineups ? 'loaded' : 'unavailable';
    return {
      lineupsStatus,
      jerseyMap: buildJerseyMap(lineups),
      didNotPlay: deriveDidNotPlay(playerId, lineups, onBench, officialStats, undefined),
      isStarter: deriveStarterFlag(playerId, lineups),
      playerSide: derivePlayerSide(playerId, lineups),
    };
  }

  try {
    const lineups = await getMatchLineups(eventId);
    matchLineupsCache.set(eventId, lineups);
    const lineupsStatus: DataAvailability = lineups ? 'loaded' : 'unavailable';
    return {
      lineupsStatus,
      jerseyMap: buildJerseyMap(lineups),
      didNotPlay: deriveDidNotPlay(playerId, lineups, onBench, officialStats, undefined),
      isStarter: deriveStarterFlag(playerId, lineups),
      playerSide: derivePlayerSide(playerId, lineups),
    };
  } catch {
    return {
      lineupsStatus: 'error',
      jerseyMap: new Map(),
      didNotPlay: onBench && (officialStats?.minutesPlayed == null || officialStats.minutesPlayed === 0),
      isStarter: undefined,
      playerSide: undefined,
    };
  }
}

// ── Fetch solo rich data: comments + derivati (fouls, cardInfo, subInfo) ──
// Non tocca lineups né officialStats.
export async function fetchMatchRichData(
  eventId: number,
  playerId: number,
  incidents: PlayerEventIncidents | null,
): Promise<{
  fouls: FoulMatchup[];
  commentsStatus: DataAvailability;
  commentsAvailable: boolean;
  substituteInMinute: number | undefined;
  substituteOutMinute: number | undefined;
  cardInfo: CardInfo | null;
  cardInfoStatus: DataAvailability;
}> {
  let comments: MatchComment[];
  let commentsStatus: DataAvailability;

  if (matchCommentsCache.has(eventId)) {
    comments = matchCommentsCache.get(eventId)!;
    commentsStatus = comments.length > 0 ? 'loaded' : 'unavailable';
  } else {
    try {
      comments = await getMatchComments(eventId);
      matchCommentsCache.set(eventId, comments);
      commentsStatus = comments.length > 0 ? 'loaded' : 'unavailable';
    } catch {
      comments = [];
      commentsStatus = 'error';
    }
  }

  const fouls = commentsStatus === 'loaded' ? extractFoulsForPlayer(comments, playerId) : [];
  const subInfo = commentsStatus === 'loaded'
    ? extractSubstitutionInfo(comments, playerId)
    : { inMinute: undefined, outMinute: undefined };
  const commentCardInfo = commentsStatus === 'loaded' ? extractCardInfo(comments, playerId) : null;
  const cardInfo = deriveCardInfo(incidents, commentCardInfo);
  const cardInfoStatus = deriveCardStatus(incidents, commentCardInfo, commentsStatus);

  return {
    fouls,
    commentsStatus,
    commentsAvailable: comments.length > 0,
    substituteInMinute: subInfo.inMinute,
    substituteOutMinute: subInfo.outMinute,
    cardInfo,
    cardInfoStatus,
  };
}

export async function fetchMatchDetails(
  eventId: number,
  playerId: number,
  seed?: MatchDetailsSeed,
): Promise<CachedMatchDetails> {
  const key = `${eventId}-${playerId}`;
  const cached = matchDetailsCache.get(key);
  if (cached) return mergeWithSeed(cached, seed);

  const commentsPromise = matchCommentsCache.has(eventId)
    ? Promise.resolve(matchCommentsCache.get(eventId)!)
    : getMatchComments(eventId).then((comments) => {
        matchCommentsCache.set(eventId, comments);
        return comments;
      });

  const lineupsPromise = matchLineupsCache.has(eventId)
    ? Promise.resolve(matchLineupsCache.get(eventId)!)
    : getMatchLineups(eventId).then((lineups) => {
        matchLineupsCache.set(eventId, lineups);
        return lineups;
      });

  const statsPromise = matchPlayerStatsCache.has(key)
    ? Promise.resolve(matchPlayerStatsCache.get(key)!)
    : getPlayerMatchStatistics(eventId, playerId).then((stats) => {
        matchPlayerStatsCache.set(key, stats);
        return stats;
      });

  const [commentsResult, lineupsResult, statsResult] = await Promise.allSettled([
    commentsPromise,
    lineupsPromise,
    statsPromise,
  ]);

  const comments = commentsResult.status === 'fulfilled' ? commentsResult.value : [];
  const lineups = lineupsResult.status === 'fulfilled' ? lineupsResult.value : null;
  const officialStats = statsResult.status === 'fulfilled'
    ? (statsResult.value ?? seed?.officialStats ?? null)
    : (seed?.officialStats ?? null);

  const commentsStatus: DataAvailability =
    commentsResult.status === 'rejected'
      ? 'error'
      : comments.length > 0
        ? 'loaded'
        : 'unavailable';

  const lineupsStatus: DataAvailability =
    lineupsResult.status === 'rejected'
      ? 'error'
      : lineups
        ? 'loaded'
        : 'unavailable';

  const officialStatsStatus: DataAvailability =
    officialStats
      ? 'loaded'
      : statsResult.status === 'rejected'
        ? 'error'
        : 'unavailable';

  const commentFouls = commentsStatus === 'loaded' ? extractFoulsForPlayer(comments, playerId) : [];
  const subInfo = commentsStatus === 'loaded'
    ? extractSubstitutionInfo(comments, playerId)
    : { inMinute: undefined, outMinute: undefined };
  const commentCardInfo = commentsStatus === 'loaded' ? extractCardInfo(comments, playerId) : null;
  const cardInfo = deriveCardInfo(seed?.incidents ?? null, commentCardInfo);

  const result: CachedMatchDetails = {
    officialStats,
    officialStatsStatus,
    fouls: commentFouls,
    commentsStatus,
    commentsAvailable: comments.length > 0,
    positions: null,
    positionsStatus: 'idle',
    substituteInMinute: subInfo.inMinute,
    substituteOutMinute: subInfo.outMinute,
    cardInfo,
    cardInfoStatus: deriveCardStatus(seed?.incidents ?? null, commentCardInfo, commentsStatus),
    didNotPlay: deriveDidNotPlay(
      playerId,
      lineups,
      Boolean(seed?.onBench),
      officialStats,
      subInfo.inMinute,
    ),
    isStarter: deriveStarterFlag(playerId, lineups),
    playerSide: derivePlayerSide(playerId, lineups),
    lineupsStatus,
    jerseyMap: buildJerseyMap(lineups),
    onBench: Boolean(seed?.onBench),
  };

  matchDetailsCache.set(key, result);
  return result;
}

export function useMatchDetails(
  eventId: number | null,
  playerId: number | null,
  enabled: boolean = true,
  seed?: MatchDetailsSeed,
): MatchDetailsResult {
  const [details, setDetails] = useState<CachedMatchDetails>(() => createSeededMatchDetails(seed));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!eventId || !playerId || !enabled) return;

    const key = `${eventId}-${playerId}`;
    const cached = matchDetailsCache.get(key);
    if (cached) {
      setDetails(mergeWithSeed(cached, seed));
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setDetails(createSeededMatchDetails(seed));

    fetchMatchDetails(eventId, playerId, seed)
      .then((result) => {
        if (cancelled) return;
        setDetails(result);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [enabled, eventId, playerId, seed?.incidents, seed?.officialStats, seed?.onBench]);

  return {
    ...details,
    loading,
    error,
  };
}
