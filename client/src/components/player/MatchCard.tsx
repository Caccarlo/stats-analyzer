import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigation } from '@/context/NavigationContext';
import type { MatchEvent, Player, Team, FoulMatchup, PlayerPosition, PlayerSeasonStats, CardType } from '@/types';
import type { CachedMatchDetails } from '@/hooks/useMatchDetails';
import { fetchMatchDetails, matchDetailsCache } from '@/hooks/useMatchDetails';
import { getPlayerSeasonStats, getMatchAveragePositions, getTeamImageUrl } from '@/api/sofascore';
import { COUNTRIES } from '@/components/navigation/CountryList';
import { getMatchRoundLabel } from '@/utils/matchRoundLabel';
import FieldMap from './FieldMap';
import HeatmapField from './HeatmapField';

interface TournamentFilter {
  tournamentId: number;
  seasonId: number;
}

interface MatchCardProps {
  event: MatchEvent;
  playerId: number;
  playerTeamId?: number;
  showCommitted: boolean;
  showSuffered: boolean;
  panelIndex?: number;
  detailsMap: Map<number, CachedMatchDetails>;
  selectedTournaments: TournamentFilter[];
  onDeselect: (eventId: number) => void;
  cardCount: number;
  onRequestRichDetails?: (eventId: number) => void;
}

type CardLayout = 'single' | 'double' | 'multi';
type PositionsStatus = 'idle' | 'loading' | 'loaded' | 'unavailable';
type PlayerStatsStatus = 'idle' | 'loading' | 'loaded' | 'unavailable';
type PlayerStatsResolvedStatus = Exclude<PlayerStatsStatus, 'idle' | 'loading'>;

interface CachedAggregatedSeasonStats {
  status: PlayerStatsResolvedStatus;
  stats: PlayerSeasonStats | null;
}

const aggregatedSeasonStatsCache = new Map<string, CachedAggregatedSeasonStats>();
const aggregatedSeasonStatsInFlight = new Map<string, Promise<CachedAggregatedSeasonStats>>();
const MAX_AGGREGATED_SEASON_STATS_CACHE_ENTRIES = 300;
const MIN_LANDSCAPE_LAYOUT_WIDTH = 620;
const MIN_SIDE_STATS_LAYOUT_WIDTH = 620;
const MIN_SIDE_STATS_EXTRA_CLEARANCE = 360;

function normalizeSelectedTournaments(selectedTournaments: TournamentFilter[]): TournamentFilter[] {
  const deduped = new Map<string, TournamentFilter>();
  selectedTournaments.forEach((t) => {
    const key = `${t.tournamentId}:${t.seasonId}`;
    if (!deduped.has(key)) deduped.set(key, t);
  });

  return [...deduped.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, value]) => value);
}

function buildSelectedTournamentsKey(selectedTournaments: TournamentFilter[]): string {
  return selectedTournaments.map((t) => `${t.tournamentId}:${t.seasonId}`).join(',');
}

function aggregateSeasonStats(results: Array<PlayerSeasonStats | null>): CachedAggregatedSeasonStats {
  const valid = results.filter((r): r is PlayerSeasonStats => r !== null);
  if (valid.length === 0) {
    return { status: 'unavailable', stats: null };
  }

  const aggregated = valid.reduce<PlayerSeasonStats>(
    (acc, s) => ({
      fouls: acc.fouls + s.fouls,
      wasFouled: acc.wasFouled + s.wasFouled,
      minutesPlayed: acc.minutesPlayed + s.minutesPlayed,
      appearances: acc.appearances + s.appearances,
      matchesStarted: acc.matchesStarted + s.matchesStarted,
      yellowCards: acc.yellowCards + s.yellowCards,
      redCards: acc.redCards + s.redCards,
      rating: 0,
    }),
    { fouls: 0, wasFouled: 0, minutesPlayed: 0, appearances: 0, matchesStarted: 0, yellowCards: 0, redCards: 0, rating: 0 }
  );

  return { status: 'loaded', stats: aggregated };
}

function getCachedAggregatedSeasonStats(cacheKey: string): CachedAggregatedSeasonStats | null {
  const cached = aggregatedSeasonStatsCache.get(cacheKey);
  if (!cached) return null;
  // Touch entry per semplice comportamento LRU.
  aggregatedSeasonStatsCache.delete(cacheKey);
  aggregatedSeasonStatsCache.set(cacheKey, cached);
  return cached;
}

function setCachedAggregatedSeasonStats(cacheKey: string, value: CachedAggregatedSeasonStats): void {
  if (aggregatedSeasonStatsCache.has(cacheKey)) {
    aggregatedSeasonStatsCache.delete(cacheKey);
  }
  aggregatedSeasonStatsCache.set(cacheKey, value);

  while (aggregatedSeasonStatsCache.size > MAX_AGGREGATED_SEASON_STATS_CACHE_ENTRIES) {
    const oldestKey = aggregatedSeasonStatsCache.keys().next().value;
    if (!oldestKey) break;
    aggregatedSeasonStatsCache.delete(oldestKey);
  }
}

async function fetchAggregatedSeasonStats(
  cacheKey: string,
  activePlayerId: number,
  selectedTournaments: TournamentFilter[],
): Promise<CachedAggregatedSeasonStats> {
  const inFlight = aggregatedSeasonStatsInFlight.get(cacheKey);
  if (inFlight) return inFlight;

  const request: Promise<CachedAggregatedSeasonStats> = Promise.all(
    selectedTournaments.map((t) => getPlayerSeasonStats(activePlayerId, t.tournamentId, t.seasonId)),
  )
    .then((results) => aggregateSeasonStats(results))
    .catch((): CachedAggregatedSeasonStats => ({ status: 'unavailable', stats: null }))
    .finally(() => {
      aggregatedSeasonStatsInFlight.delete(cacheKey);
    });

  aggregatedSeasonStatsInFlight.set(cacheKey, request);
  const resolved = await request;
  setCachedAggregatedSeasonStats(cacheKey, resolved);
  return resolved;
}

const CardIcon = ({ type }: { type: CardType }) => {
  if (type === 'yellow') {
    return (
      <div
        className="w-3.5 rounded-sm flex-shrink-0"
        style={{ height: '18px', backgroundColor: '#facc15' }}
        title="Cartellino giallo"
      />
    );
  }
  if (type === 'red') {
    return (
      <div
        className="w-3.5 rounded-sm flex-shrink-0"
        style={{ height: '18px', backgroundColor: '#ef4444' }}
        title="Cartellino rosso"
      />
    );
  }
  return (
    <div className="relative flex-shrink-0" style={{ width: '22px', height: '20px' }} title="Doppio cartellino">
      <div
        className="absolute rounded-sm"
        style={{ width: '14px', height: '18px', backgroundColor: '#facc15', bottom: 0, left: 0 }}
      />
      <div
        className="absolute rounded-sm"
        style={{ width: '14px', height: '18px', backgroundColor: '#ef4444', top: 0, right: 0 }}
      />
    </div>
  );
};

const MatchTeamBadge = ({ team }: { team: Team }) => (
  <img
    src={getTeamImageUrl(team.id)}
    alt=""
    title={team.name}
    className="w-5 h-5 object-contain flex-shrink-0 transition-transform duration-150 group-hover:scale-105"
    onError={(e) => {
      (e.target as HTMLImageElement).style.display = 'none';
    }}
  />
);

function getDisplayCount(value: number | undefined): string {
  return typeof value === 'number' ? String(value) : '—';
}

function renderFieldStatValue(value: number | null, loading: boolean, colorClass: string) {
  if (loading) {
    return <span className={`inline-block w-3 h-3 border border-current border-t-transparent rounded-full animate-spin ${colorClass}`} />;
  }
  return value != null ? value : '—';
}

function renderAverageStatValue(value: string | null, loading: boolean, colorClass: string) {
  if (loading) {
    return <span className={`inline-block w-3 h-3 border border-current border-t-transparent rounded-full animate-spin ${colorClass}`} />;
  }
  return value ?? '—';
}

export default function MatchCard({
  event,
  playerId,
  playerTeamId,
  showCommitted,
  showSuffered,
  panelIndex = 0,
  detailsMap,
  selectedTournaments,
  onDeselect,
  cardCount,
  onRequestRichDetails,
}: MatchCardProps) {
  const { openSplitPlayer, swapSplitAndOpenPlayer, openSplitTeam, swapSplitAndOpenTeam, selectPlayer } = useNavigation();

  const [activePlayerId, setActivePlayerId] = useState(playerId);
  const [positions, setPositions] = useState<{ home: PlayerPosition[]; away: PlayerPosition[] } | null>(null);
  const [positionsStatus, setPositionsStatus] = useState<PositionsStatus>('idle');
  const [activePlayerSeasonStats, setActivePlayerSeasonStats] = useState<PlayerSeasonStats | null>(null);
  const [activePlayerSeasonStatsStatus, setActivePlayerSeasonStatsStatus] = useState<PlayerStatsStatus>('idle');
  const [activePlayerOwnFouls, setActivePlayerOwnFouls] = useState<{ committed: number; suffered: number } | null>(null);
  const [activePlayerOwnFoulsStatus, setActivePlayerOwnFoulsStatus] = useState<PlayerStatsStatus>('idle');
  const [positionsSectionWidth, setPositionsSectionWidth] = useState(0);
  const [rightColWidth, setRightColWidth] = useState(0);
  const [fieldWidth, setFieldWidth] = useState(0);

  const positionsSectionRef = useRef<HTMLDivElement>(null);
  const rightColRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<HTMLDivElement>(null);
  const details = detailsMap.get(event.id);
  const layoutMode: CardLayout = cardCount === 1 ? 'single' : cardCount === 2 ? 'double' : 'multi';
  const useLandscapePositions =
    layoutMode === 'single' && positionsSectionWidth >= MIN_LANDSCAPE_LAYOUT_WIDTH;
  const singleCardOrientation = useLandscapePositions ? 'landscape' : 'portrait';
  const fieldMaxWidthClass = useLandscapePositions ? 'max-w-[367px]' : 'max-w-[238px]';

  // Lazy fetch: se la card viene renderizzata e i dati rich non sono ancora stati caricati, li richiede ora
  useEffect(() => {
    if (details?.commentsStatus === 'idle') {
      onRequestRichDetails?.(event.id);
    }
  }, [event.id, details?.commentsStatus, onRequestRichDetails]);

  useEffect(() => {
    setActivePlayerId(playerId);
  }, [playerId]);

  useEffect(() => {
    const el = positionsSectionRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      setPositionsSectionWidth(entries[0].contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [positions, layoutMode]);

  useEffect(() => {
    const el = fieldRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      setFieldWidth(entries[0].contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [positions, layoutMode, singleCardOrientation]);

  useEffect(() => {
    const el = rightColRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      setRightColWidth(entries[0].contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [positions, layoutMode, singleCardOrientation]);

  useEffect(() => {
    if (!details) return;
    if (details.positions) {
      setPositions(details.positions);
      setPositionsStatus('loaded');
      return;
    }

    let cancelled = false;
    setPositionsStatus('loading');

    getMatchAveragePositions(event.id).then((pos) => {
      if (cancelled) return;
      if (pos) {
        setPositions(pos);
        setPositionsStatus('loaded');
      } else {
        setPositionsStatus('unavailable');
      }
    });

    return () => { cancelled = true; };
  }, [details, event.id]);

  const isHome = event.homeTeam.id === playerTeamId;
  const date = new Date(event.startTimestamp * 1000);
  const dateStr = date.toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' });

  const fouls = details?.fouls ?? [];
  const committedFouls = fouls.filter((f) => f.type === 'committed' || f.type === 'handball');
  const sufferedFouls = fouls.filter((f) => f.type === 'suffered');
  const officialCommitted = details?.officialStats?.fouls;
  const officialSuffered = details?.officialStats?.wasFouled;
  const officialMinutes = details?.officialStats?.minutesPlayed;
  const substituteInMinute = details?.substituteInMinute;
  const substituteOutMinute = details?.substituteOutMinute;
  const cardInfo = details?.cardInfo ?? null;
  const jerseyMap = details?.jerseyMap ?? new Map<number, string>();
  const commentsMessage =
    details?.commentsStatus === 'loading'
      ? 'Caricamento cronaca...'
      : details?.commentsStatus === 'error'
        ? 'Errore nel caricamento della cronaca'
        : 'Cronaca non disponibile per questa partita';

  const appearanceLabel =
    substituteInMinute != null
      ? `Entrato al ${substituteInMinute}'`
      : details?.lineupsStatus === 'loaded'
        ? 'Titolare'
        : typeof officialMinutes === 'number'
          ? `${officialMinutes} min`
          : 'Dati minuti non disponibili';

  const neither = !showCommitted && !showSuffered;

  const visibleFouls: FoulMatchup[] = [
    ...(showCommitted ? committedFouls : []),
    ...(showSuffered ? sufferedFouls : []),
  ];

  const involvedPlayerIds = new Set<number>();
  if (showCommitted || neither) {
    committedFouls.forEach((f) => { if (f.playerFouled?.id) involvedPlayerIds.add(f.playerFouled.id); });
  }
  if (showSuffered || neither) {
    sufferedFouls.forEach((f) => { if (f.playerFouling?.id) involvedPlayerIds.add(f.playerFouling.id); });
  }

  const involvedKey = [...involvedPlayerIds].sort().join(',');
  useEffect(() => {
    if (activePlayerId !== playerId && !involvedPlayerIds.has(activePlayerId)) {
      setActivePlayerId(playerId);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [involvedKey, playerId]);

  const isDesktop = typeof window !== 'undefined' && window.innerWidth >= 1024;

  const buildNavContext = () => {
    if (!event.tournament?.uniqueTournament) return undefined;
    const leagueId = event.tournament.uniqueTournament.id;
    const leagueName = event.tournament.uniqueTournament.name;
    const country = COUNTRIES.find((c) => c.leagues.some((l) => l.id === leagueId));
    return {
      leagueId,
      leagueName,
      countryId: country?.id,
      countryName: country?.name,
    };
  };

  const handlePlayerClick = (player: Player) => {
    if (isDesktop) {
      const navContext = buildNavContext();
      if (panelIndex > 0) {
        swapSplitAndOpenPlayer(player, player.team?.id, player.team?.name, navContext);
      } else {
        openSplitPlayer(player, player.team?.id, player.team?.name, navContext);
      }
    } else {
      selectPlayer(0, player.id, player);
    }
  };

  const handleTeamClick = (team: Team) => {
    if (isDesktop) {
      const navContext = buildNavContext();
      if (panelIndex > 0) {
        swapSplitAndOpenTeam(team.id, team.name, navContext);
      } else {
        openSplitTeam(team.id, team.name, navContext);
      }
    }
  };

  const abbreviateName = (name: string) => {
    const parts = name.trim().split(/\s+/);
    if (parts.length <= 1) return name;
    return `${parts[0][0]}. ${parts.slice(1).join(' ')}`;
  };

  const activePlayer = useMemo(() => {
    if (!positions) return null;
    return (
      positions.home.find((p) => p.player.id === activePlayerId)?.player ??
      positions.away.find((p) => p.player.id === activePlayerId)?.player ??
      null
    );
  }, [positions, activePlayerId]);

  const activeIsHome = positions
    ? positions.home.some((p) => p.player.id === activePlayerId)
    : isHome;

  const activePlayerIsMain = activePlayerId === playerId;
  const normalizedSelectedTournaments = useMemo(
    () => normalizeSelectedTournaments(selectedTournaments),
    [selectedTournaments],
  );
  const selectedTournamentsKey = useMemo(
    () => buildSelectedTournamentsKey(normalizedSelectedTournaments),
    [normalizedSelectedTournaments],
  );
  const activePlayerSeasonStatsLoading = !activePlayerIsMain && activePlayerSeasonStatsStatus === 'loading';
  const activePlayerOwnFoulsLoading = !activePlayerIsMain && activePlayerOwnFoulsStatus === 'loading';

  useEffect(() => {
    if (activePlayerIsMain || selectedTournamentsKey.length === 0) {
      setActivePlayerSeasonStats(null);
      setActivePlayerSeasonStatsStatus('idle');
      setActivePlayerOwnFouls(null);
      setActivePlayerOwnFoulsStatus('idle');
      return;
    }

    let cancelled = false;
    const seasonStatsCacheKey = `${activePlayerId}|${selectedTournamentsKey}`;
    const cachedSeasonStats = getCachedAggregatedSeasonStats(seasonStatsCacheKey);

    if (cachedSeasonStats) {
      setActivePlayerSeasonStats(cachedSeasonStats.stats);
      setActivePlayerSeasonStatsStatus(cachedSeasonStats.status);
    } else {
      setActivePlayerSeasonStats(null);
      setActivePlayerSeasonStatsStatus('loading');
      fetchAggregatedSeasonStats(seasonStatsCacheKey, activePlayerId, normalizedSelectedTournaments)
        .then((resolved) => {
          if (cancelled) return;
          setActivePlayerSeasonStats(resolved.stats);
          setActivePlayerSeasonStatsStatus(resolved.status);
        })
        .catch(() => {
          if (!cancelled) {
            setActivePlayerSeasonStats(null);
            setActivePlayerSeasonStatsStatus('unavailable');
          }
        });
    }

    const matchDetailsKey = `${event.id}-${activePlayerId}`;
    const cachedMatchDetails = matchDetailsCache.get(matchDetailsKey);
    if (cachedMatchDetails) {
      const committed = cachedMatchDetails.officialStats?.fouls;
      const suffered = cachedMatchDetails.officialStats?.wasFouled;
      if (typeof committed === 'number' || typeof suffered === 'number') {
        setActivePlayerOwnFouls({ committed: committed ?? 0, suffered: suffered ?? 0 });
        setActivePlayerOwnFoulsStatus('loaded');
      } else {
        setActivePlayerOwnFouls(null);
        setActivePlayerOwnFoulsStatus('unavailable');
      }
    } else {
      setActivePlayerOwnFouls(null);
      setActivePlayerOwnFoulsStatus('loading');
      fetchMatchDetails(event.id, activePlayerId)
        .then((matchDetails) => {
          if (cancelled) return;
          const committed = matchDetails.officialStats?.fouls;
          const suffered = matchDetails.officialStats?.wasFouled;
          if (typeof committed === 'number' || typeof suffered === 'number') {
            setActivePlayerOwnFouls({ committed: committed ?? 0, suffered: suffered ?? 0 });
            setActivePlayerOwnFoulsStatus('loaded');
          } else {
            setActivePlayerOwnFouls(null);
            setActivePlayerOwnFoulsStatus('unavailable');
          }
        })
        .catch(() => {
          if (!cancelled) {
            setActivePlayerOwnFouls(null);
            setActivePlayerOwnFoulsStatus('unavailable');
          }
        });
    }

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePlayerId, activePlayerIsMain, selectedTournamentsKey, event.id]);

  const renderFoul = (f: FoulMatchup, i: number) => (
    <div key={i} className="text-sm text-text-secondary py-0.5">
      {f.type === 'handball' ? (
        <span>
          {f.minute != null && <span className="text-text-muted">{f.minute}' </span>}
          Fallo di mano
          {f.zoneText && <span className="text-text-muted"> {f.zoneText}</span>}
        </span>
      ) : f.type === 'suffered' ? (
        <span>
          {f.minute != null && <span className="text-text-muted">{f.minute}' </span>}
          {f.playerFouling ? (
            <>
              da{' '}
              <button
                onClick={() => handlePlayerClick(f.playerFouling!)}
                className="text-neon hover:underline"
              >
                {abbreviateName(f.playerFouling.name)}
              </button>
              {jerseyMap.get(f.playerFouling.id) && (
                <span className="text-text-muted"> ({jerseyMap.get(f.playerFouling.id)})</span>
              )}
            </>
          ) : (
            'punizione conquistata'
          )}
          {f.zoneText && <span className="text-text-muted"> {f.zoneText}</span>}
        </span>
      ) : (
        <span>
          {f.minute != null && <span className="text-text-muted">{f.minute}' </span>}
          {f.playerFouled ? (
            <>
              su{' '}
              <button
                onClick={() => handlePlayerClick(f.playerFouled!)}
                className="text-neon hover:underline"
              >
                {abbreviateName(f.playerFouled.name)}
              </button>
              {jerseyMap.get(f.playerFouled.id) && (
                <span className="text-text-muted"> ({jerseyMap.get(f.playerFouled.id)})</span>
              )}
            </>
          ) : (
            'fallo commesso'
          )}
          {f.zoneText && <span className="text-text-muted"> {f.zoneText}</span>}
        </span>
      )}
    </div>
  );

  const showTwoColumns = showCommitted && showSuffered;
  const showActiveSuffered = showCommitted || neither;
  const showActiveCommitted = showSuffered || neither;

  const playerNameRow = activePlayer ? (
    <div className="flex items-center gap-2 justify-center">
      <img
        src={`https://api.sofascore.com/api/v1/player/${activePlayerId}/image`}
        alt={activePlayer.name}
        className="w-7 h-7 rounded-full object-cover bg-surface-2"
        onError={(e) => {
          (e.target as HTMLImageElement).style.display = 'none';
        }}
      />
      {activePlayerIsMain ? (
        <span className="text-sm text-text-primary font-medium truncate max-w-[100px]">
          {abbreviateName(activePlayer.name)}
        </span>
      ) : (
        <button
          onClick={() => handlePlayerClick(activePlayer)}
          className="text-sm text-text-primary font-medium truncate max-w-[100px] hover:text-neon hover:underline transition-colors"
        >
          {abbreviateName(activePlayer.name)}
        </button>
      )}
    </div>
  ) : null;

  const renderStatBoxes = (cols: 1 | 2 = 1) => {
    const s = activePlayerSeasonStats;
    const committedPerGame = s && s.appearances > 0 ? (s.fouls / s.appearances).toFixed(2) : s ? '—' : null;
    const committedPer90 = s && s.minutesPlayed > 0 ? (s.fouls * 90 / s.minutesPlayed).toFixed(2) : s ? '—' : null;
    const sufferedPerGame = s && s.appearances > 0 ? (s.wasFouled / s.appearances).toFixed(2) : s ? '—' : null;
    const sufferedPer90 = s && s.minutesPlayed > 0 ? (s.wasFouled * 90 / s.minutesPlayed).toFixed(2) : s ? '—' : null;
    const colClass = cols === 2 ? 'grid-cols-2' : 'grid-cols-1';
    return (
      <div className={`grid ${colClass} gap-1 w-fit flex-shrink-0`}>
        {showActiveCommitted && (
          <>
            <div className="bg-surface border border-border rounded px-2 py-0.5 flex items-center justify-between gap-2">
              <p className="text-text-muted text-[9px] uppercase tracking-wide">Comm./p</p>
              <p className="text-negative text-xs font-bold">{renderAverageStatValue(committedPerGame, activePlayerSeasonStatsLoading, 'text-negative')}</p>
            </div>
            <div className="bg-surface border border-border rounded px-2 py-0.5 flex items-center justify-between gap-2">
              <p className="text-text-muted text-[9px] uppercase tracking-wide">Comm./90</p>
              <p className="text-negative text-xs font-bold">{renderAverageStatValue(committedPer90, activePlayerSeasonStatsLoading, 'text-negative')}</p>
            </div>
          </>
        )}
        {showActiveSuffered && (
          <>
            <div className="bg-surface border border-border rounded px-2 py-0.5 flex items-center justify-between gap-2">
              <p className="text-text-muted text-[9px] uppercase tracking-wide">Sub./p</p>
              <p className="text-neon text-xs font-bold">{renderAverageStatValue(sufferedPerGame, activePlayerSeasonStatsLoading, 'text-neon')}</p>
            </div>
            <div className="bg-surface border border-border rounded px-2 py-0.5 flex items-center justify-between gap-2">
              <p className="text-text-muted text-[9px] uppercase tracking-wide">Sub./90</p>
              <p className="text-neon text-xs font-bold">{renderAverageStatValue(sufferedPer90, activePlayerSeasonStatsLoading, 'text-neon')}</p>
            </div>
          </>
        )}
      </div>
    );
  };

  const renderMatchFoulCounts = () => (
    <div className="flex flex-col items-center gap-1 w-fit flex-shrink-0">
      {showActiveCommitted && (
        <div className="bg-surface border border-border rounded px-2 py-0.5 flex items-center justify-between gap-2">
          <p className="text-text-muted text-[9px] uppercase tracking-wide">Comm.</p>
          <p className="text-negative text-xs font-bold">
            {renderFieldStatValue(activePlayerOwnFouls?.committed ?? null, activePlayerOwnFoulsLoading, 'text-negative')}
          </p>
        </div>
      )}
      {showActiveSuffered && (
        <div className="bg-surface border border-border rounded px-2 py-0.5 flex items-center justify-between gap-2">
          <p className="text-text-muted text-[9px] uppercase tracking-wide">Sub.</p>
          <p className="text-neon text-xs font-bold">
            {renderFieldStatValue(activePlayerOwnFouls?.suffered ?? null, activePlayerOwnFoulsLoading, 'text-neon')}
          </p>
        </div>
      )}
    </div>
  );

  const heatmapMaxWidth = fieldWidth > 0 ? Math.round(fieldWidth / 2) : undefined;

  const renderPositionsSection = () => {
    if (!positions) return null;

    const leftCol = (orientation: 'portrait' | 'landscape') => (
      <div className="flex items-center justify-center h-full py-8">
        <div
          ref={fieldRef}
          className={`w-full ${orientation === 'landscape' ? 'max-w-[367px]' : 'max-w-[238px]'}`}
        >
          <FieldMap
            homePositions={positions.home}
            awayPositions={positions.away}
            selectedPlayerId={playerId}
            activePlayerId={activePlayerId}
            involvedPlayerIds={involvedPlayerIds}
            onActivePlayerChange={setActivePlayerId}
            orientation={orientation}
          />
        </div>
      </div>
    );

    const rightCol = (orientation: 'portrait' | 'landscape', statCols: 1 | 2) => {
      const isLandscape = orientation === 'landscape';
      const effectiveHeatmapWidth = heatmapMaxWidth ?? (isLandscape ? 200 : 119);
      const heatmapHeight = Math.round(effectiveHeatmapWidth * (isLandscape ? 68 / 105 : 105 / 68));
      const heatmapHalfHeight = Math.round(heatmapHeight / 2);
      const NAME_HEIGHT = 28;
      const minimumSideStatsWidth = Math.max(
        MIN_SIDE_STATS_LAYOUT_WIDTH,
        effectiveHeatmapWidth + MIN_SIDE_STATS_EXTRA_CLEARANCE,
      );
      const useSideStatsLayout = !activePlayerIsMain && rightColWidth >= minimumSideStatsWidth;

      return (
        <div ref={rightColRef} className="relative flex items-center justify-center">
          <div className="absolute top-0 left-1/2 -translate-x-1/2">
            {playerNameRow}
          </div>
          {!activePlayerIsMain && useSideStatsLayout && (
            <div className="absolute inset-0 flex items-center pointer-events-none">
              <div className="flex-1 flex items-center justify-center pointer-events-auto min-w-0">
                {renderStatBoxes(statCols)}
              </div>
              <div className="flex-shrink-0" style={{ width: effectiveHeatmapWidth }} />
              <div className="flex-1 flex items-center justify-center pointer-events-auto min-w-0">
                {renderMatchFoulCounts()}
              </div>
            </div>
          )}
          {!activePlayerIsMain && !useSideStatsLayout && (
            <>
              <div
                className="absolute left-0 right-0 pointer-events-none flex items-center justify-center"
                style={{ top: `${NAME_HEIGHT}px`, bottom: `calc(50% + ${heatmapHalfHeight}px)` }}
              >
                <div className="pointer-events-auto">
                  {renderStatBoxes(2)}
                </div>
              </div>
              <div
                className="absolute left-0 right-0 pointer-events-none flex items-center justify-center"
                style={{ top: `calc(50% + ${heatmapHalfHeight}px)`, bottom: 0 }}
              >
                <div className="pointer-events-auto">
                  {renderMatchFoulCounts()}
                </div>
              </div>
            </>
          )}
          <HeatmapField
            eventId={event.id}
            playerId={activePlayerId}
            isHome={activeIsHome}
            orientation={orientation}
            maxWidth={heatmapMaxWidth}
          />
        </div>
      );
    };

    if (layoutMode === 'single') {
      return (
        <div ref={positionsSectionRef} className="grid grid-cols-2 gap-3 mb-3 items-stretch pt-3">
          <div className="flex items-center justify-center h-full py-8">
            <div ref={fieldRef} className={`w-full ${fieldMaxWidthClass}`}>
              <FieldMap
                homePositions={positions.home}
                awayPositions={positions.away}
                selectedPlayerId={playerId}
                activePlayerId={activePlayerId}
                involvedPlayerIds={involvedPlayerIds}
                onActivePlayerChange={setActivePlayerId}
                orientation={singleCardOrientation}
              />
            </div>
          </div>
          {rightCol(singleCardOrientation, useLandscapePositions ? 2 : 1)}
        </div>
      );
    }

    if (layoutMode === 'double') {
      return (
        <div ref={positionsSectionRef} className="grid grid-cols-2 gap-3 mb-4 items-stretch pt-3">
          {leftCol('portrait')}
          {rightCol('portrait', 1)}
        </div>
      );
    }

    const multiHeatmapWidth = heatmapMaxWidth ?? 119;
    const multiHalfHeight = Math.round((multiHeatmapWidth * 105 / 68) / 2);
    const NAME_HEIGHT = 28;
    return (
      <div ref={positionsSectionRef} className="grid grid-cols-2 gap-3 mb-4 items-stretch pt-3">
        {leftCol('portrait')}
        <div ref={rightColRef} className="relative flex items-center justify-center">
          <div className="absolute top-0 left-1/2 -translate-x-1/2">
            {playerNameRow}
          </div>
          {!activePlayerIsMain && (
            <div
              className="absolute left-0 right-0 pointer-events-none flex items-center justify-center"
              style={{ top: `${NAME_HEIGHT}px`, bottom: `calc(50% + ${multiHalfHeight}px)` }}
            >
              <div className="pointer-events-auto">
                {renderStatBoxes(2)}
              </div>
            </div>
          )}
          {!activePlayerIsMain && (
            <div
              className="absolute left-0 right-0 pointer-events-none flex items-center justify-center"
              style={{ top: `calc(50% + ${multiHalfHeight}px)`, bottom: 0 }}
            >
              <div className="pointer-events-auto">
                {renderMatchFoulCounts()}
              </div>
            </div>
          )}
          <HeatmapField
            eventId={event.id}
            playerId={activePlayerId}
            isHome={activeIsHome}
            maxWidth={heatmapMaxWidth}
          />
        </div>
      </div>
    );
  };

  const renderNarrativeBlock = (title: string, count: string, colorClass: string, items: FoulMatchup[]) => (
    <div className="flex flex-col items-center text-center">
      <p className={`${colorClass} text-xs font-semibold uppercase tracking-wide mb-2`}>
        {title} ({count})
      </p>
      {details?.commentsStatus === 'loaded' ? (
        items.length > 0 ? items.map(renderFoul) : <p className="text-text-muted text-sm">Nessuno</p>
      ) : (
        <p className="text-text-muted text-sm">{commentsMessage}</p>
      )}
    </div>
  );
  const roundLabel = getMatchRoundLabel(event.roundInfo, 'full');

  return (
    <div className="bg-surface border border-border rounded-lg overflow-hidden h-full w-full flex flex-col">
      <div className="flex items-start justify-between px-4 py-6">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-xs text-text-muted">
            <span>{event.tournament?.name}</span>
            {roundLabel && <span>{roundLabel}</span>}
            <span>· {dateStr}</span>
          </div>
          <div className="text-text-primary font-medium mt-0.5 flex items-center gap-2 flex-wrap">
            {isHome ? (
              <>
                <MatchTeamBadge team={event.homeTeam} />
                <span>{event.homeTeam.shortName ?? event.homeTeam.name}</span>
              </>
              ) : (
                <button
                  onClick={() => handleTeamClick(event.homeTeam)}
                  className="group flex items-center gap-2 text-text-primary hover:text-neon hover:underline transition-colors"
                >
                  <MatchTeamBadge team={event.homeTeam} />
                  {event.homeTeam.shortName ?? event.homeTeam.name}
                </button>
            )}{' '}
            <span className="text-text-muted">
              {event.homeScore.current} - {event.awayScore.current}
            </span>{' '}
            {isHome ? (
              <button
                onClick={() => handleTeamClick(event.awayTeam)}
                className="group flex items-center gap-2 text-text-primary hover:text-neon hover:underline transition-colors"
              >
                {event.awayTeam.shortName ?? event.awayTeam.name}
                <MatchTeamBadge team={event.awayTeam} />
              </button>
            ) : (
              <>
                <span>{event.awayTeam.shortName ?? event.awayTeam.name}</span>
                <MatchTeamBadge team={event.awayTeam} />
              </>
            )}
          </div>
        </div>
        <div className="text-xs text-text-muted text-right flex-shrink-0 mx-2">
          <p>{appearanceLabel}</p>
          {substituteOutMinute != null && <p>Uscito al {substituteOutMinute}'</p>}
        </div>
        {cardInfo && (
          <div className="flex-shrink-0 flex items-center mr-2">
            <CardIcon type={cardInfo.type} />
          </div>
        )}
        <button
          onClick={() => onDeselect(event.id)}
          className="flex-shrink-0 p-1 text-text-muted hover:text-text-primary transition-colors"
          title="Rimuovi"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="px-4 pb-8 border-t border-border pt-3 flex-1">
        {!details ? (
          <div className="flex items-center gap-2 text-text-muted text-sm">
            <div className="w-3 h-3 border-2 border-neon border-t-transparent rounded-full animate-spin" />
            Caricamento dettagli...
          </div>
        ) : (
          <>
            {positions ? (
              renderPositionsSection()
            ) : (
              <div className="mb-3">
                <div className="text-xs text-text-secondary text-center">
                  <span>{appearanceLabel}</span>
                  {positionsStatus === 'loading' && <span> · Caricamento posizioni medie...</span>}
                  {positionsStatus === 'unavailable' && <span> · Posizioni medie non disponibili</span>}
                  {substituteOutMinute != null && <span> · Uscito al {substituteOutMinute}'</span>}
                </div>
                <div className="mt-3 flex justify-center">
                  <HeatmapField
                    eventId={event.id}
                    playerId={playerId}
                    isHome={isHome}
                  />
                </div>
              </div>
            )}

            {showTwoColumns ? (
              <div className="grid grid-cols-2 gap-3">
                {renderNarrativeBlock('Falli commessi', getDisplayCount(officialCommitted), 'text-negative', committedFouls)}
                {renderNarrativeBlock('Falli subiti', getDisplayCount(officialSuffered), 'text-neon', sufferedFouls)}
              </div>
            ) : (
              <>
                {showSuffered && (
                  <div className="mb-3">
                    {renderNarrativeBlock('Falli subiti', getDisplayCount(officialSuffered), 'text-neon', sufferedFouls)}
                  </div>
                )}
                {showCommitted && (
                  <div className="mb-3">
                    {renderNarrativeBlock('Falli commessi', getDisplayCount(officialCommitted), 'text-negative', committedFouls)}
                  </div>
                )}
                {details.commentsStatus === 'loaded' && visibleFouls.length === 0 && (
                  <p className="text-text-muted text-sm text-center">Nessun fallo in questa partita</p>
                )}
                {details.commentsStatus !== 'loaded' && !showCommitted && !showSuffered && (
                  <p className="text-text-muted text-sm text-center">{commentsMessage}</p>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
