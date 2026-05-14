import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigation } from '@/context/NavigationContext';
import {
  getTeamPlayers,
  getTeamEventsByDirection,
  getMatchLineups,
  getTeamImageUrl,
} from '@/api/sofascore';
import { getFormationPositions } from '@/utils/positionMapping';
import { getShotsCount, getShotsOnTargetCount } from '@/utils/playerStats';
import type { Player, MatchEvent, MatchLineups, TeamLineup } from '@/types';

const PAGE_SIZE = 5;
const STATS_TABLE_COLUMNS = '100px 40px 52px 48px 40px 40px';
const STATS_TABLE_MIN_WIDTH = 352;
const TABLE_BODY_MAX_HEIGHT = 171;
const TABLE_PANEL_ROW_HEIGHT = 22;
const TEAM_STATS_FETCH_BATCH_SIZE = 4;

type TeamStatsSectionId = 'foulsCommitted' | 'foulsSuffered' | 'shots' | 'shotsOnTarget';
type TeamStatsSortKey = 'total' | 'appearances' | 'perMatch' | 'minutes' | 'per90';

interface CompetitionOption {
  id: number;
  name: string;
}

interface TeamStatsSectionOption {
  id: TeamStatsSectionId;
  label: string;
  getValue: (statistics: Record<string, unknown> | undefined) => number;
}

interface TeamPlayerStatsRow {
  player: Player;
  total: number;
  appearances: number;
  perMatch: number;
  minutes: number;
  per90: number;
}

function getNumericStatValue(
  statistics: Record<string, unknown> | undefined,
  keys: readonly string[],
): number | null {
  if (!statistics) return null;
  for (const key of keys) {
    const value = statistics[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return null;
}

function formatDecimalStat(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : '0.00';
}

function formatMatchDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString('it-IT', { day: '2-digit', month: 'short' });
}

function formatMatchTime(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
}

function mergeTeamEvents(currentEvents: MatchEvent[], incomingEvents: MatchEvent[], direction: 'last' | 'next'): MatchEvent[] {
  const deduped = new Map<number, MatchEvent>();
  [...currentEvents, ...incomingEvents].forEach((event) => { deduped.set(event.id, event); });
  return [...deduped.values()].sort((a, b) =>
    direction === 'last' ? b.startTimestamp - a.startTimestamp : a.startTimestamp - b.startTimestamp
  );
}

const TEAM_STATS_SECTIONS: TeamStatsSectionOption[] = [
  { id: 'foulsCommitted', label: 'Falli commessi', getValue: (s) => getNumericStatValue(s, ['fouls']) ?? 0 },
  { id: 'foulsSuffered', label: 'Falli subiti', getValue: (s) => getNumericStatValue(s, ['wasFouled']) ?? 0 },
  { id: 'shots', label: 'Tiri', getValue: (s) => getShotsCount((s ?? null) as Record<string, unknown> | null) ?? 0 },
  { id: 'shotsOnTarget', label: 'Tiri in porta', getValue: (s) => getShotsOnTargetCount((s ?? null) as Record<string, unknown> | null) ?? 0 },
];

function buildCompetitionOptions(events: MatchEvent[]): CompetitionOption[] {
  const deduped = new Map<number, CompetitionOption>();
  events.forEach((event) => {
    const tournament = event.tournament?.uniqueTournament;
    if (!tournament?.id) return;
    const name = tournament.name?.trim() || event.tournament?.name?.trim();
    if (!name || deduped.has(tournament.id)) return;
    deduped.set(tournament.id, { id: tournament.id, name });
  });
  return [...deduped.values()].sort((a, b) => a.name.localeCompare(b.name, 'it'));
}

function includesCompetition(events: MatchEvent[], competitionId: number): boolean {
  return events.some((event) => event.tournament?.uniqueTournament?.id === competitionId);
}

// Posizione giocatore casa nel campo landscape unificato:
// casa gioca da sinistra verso destra (GK a sinistra)
// Trasformazione: left = (100 - pos.y) * 0.5 (prima metà), top = pos.x
function getHomePlayerPos(pos: { x: number; y: number }): { left: string; top: string } {
  return {
    left: `${(100 - pos.y) * 0.5}%`,
    top: `${pos.x}%`,
  };
}

// Posizione giocatore trasferta nel campo landscape unificato:
// trasferta gioca da destra verso sinistra (GK a destra)
// specchio orizzontale: left = 50 + pos.y * 0.5, top = 100 - pos.x
function getAwayPlayerPos(pos: { x: number; y: number }): { left: string; top: string } {
  return {
    left: `${50 + pos.y * 0.5}%`,
    top: `${100 - pos.x}%`,
  };
}

interface MatchupViewProps {
  eventId: number;
  homeTeamId: number;
  homeTeamName: string;
  awayTeamId: number;
  awayTeamName: string;
  leagueId?: number;
  leagueName?: string;
  seasonId?: number;
  seasonYear?: string;
}

// Componente sezione partite per una singola squadra
interface TeamMatchesSectionProps {
  teamId: number;
  defaultCompetitionId?: number;
}

function TeamMatchesSection({ teamId, defaultCompetitionId }: TeamMatchesSectionProps) {
  const [activeTab, setActiveTab] = useState<'last' | 'next'>('last');
  const [selectedCompetitionId, setSelectedCompetitionId] = useState<'all' | number>(defaultCompetitionId ?? 'all');
  const [pastEvents, setPastEvents] = useState<MatchEvent[]>([]);
  const [futureEvents, setFutureEvents] = useState<MatchEvent[]>([]);
  const [pastApiPage, setPastApiPage] = useState(0);
  const [futureApiPage, setFutureApiPage] = useState(0);
  const [hasMorePast, setHasMorePast] = useState(true);
  const [hasMoreFuture, setHasMoreFuture] = useState(true);
  const [displayOffset, setDisplayOffset] = useState(0);
  const [loadingMatches, setLoadingMatches] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setPastEvents([]);
    setFutureEvents([]);
    setPastApiPage(0);
    setFutureApiPage(0);
    setHasMorePast(true);
    setHasMoreFuture(true);
    setDisplayOffset(0);
    setActiveTab('last');
    setSelectedCompetitionId(defaultCompetitionId ?? 'all');

    (async () => {
      try {
        const pastEvts = await getTeamEventsByDirection(teamId, 'last', 0);
        if (cancelled) return;
        setPastEvents(mergeTeamEvents([], pastEvts, 'last'));
        if (pastEvts.length === 0) setHasMorePast(false);
      } catch (e) {
        console.error('TeamMatchesSection fetch error:', e);
      }
    })();

    return () => { cancelled = true; };
  }, [teamId, defaultCompetitionId]);

  const activeEvents = activeTab === 'last' ? pastEvents : futureEvents;
  const hasMore = activeTab === 'last' ? hasMorePast : hasMoreFuture;
  const competitionOptions = useMemo(() => buildCompetitionOptions([...pastEvents, ...futureEvents]), [pastEvents, futureEvents]);
  const effectiveSelectedCompetitionId = useMemo<'all' | number>(() => {
    if (selectedCompetitionId === 'all') return 'all';
    return competitionOptions.some((competition) => competition.id === selectedCompetitionId)
      ? selectedCompetitionId
      : 'all';
  }, [competitionOptions, selectedCompetitionId]);

  const filteredEvents = useMemo(() => {
    if (effectiveSelectedCompetitionId === 'all') return activeEvents;
    return activeEvents.filter((ev) => ev.tournament?.uniqueTournament?.id === effectiveSelectedCompetitionId);
  }, [activeEvents, effectiveSelectedCompetitionId]);

  const visibleEvents = filteredEvents.slice(displayOffset, displayOffset + PAGE_SIZE);

  useEffect(() => {
    setDisplayOffset(0);
  }, [effectiveSelectedCompetitionId]);

  const canGoLeft = activeTab === 'last'
    ? (displayOffset + PAGE_SIZE < activeEvents.length || (hasMorePast && !loadingMatches))
    : (displayOffset > 0);
  const canGoRight = activeTab === 'last'
    ? (displayOffset > 0)
    : (displayOffset + PAGE_SIZE < activeEvents.length || (hasMoreFuture && !loadingMatches));

  const loadMorePast = async () => {
    if (!hasMorePast || loadingMatches) return;
    setLoadingMatches(true);
    try {
      const nextPage = pastApiPage + 1;
      const evts = await getTeamEventsByDirection(teamId, 'last', nextPage);
      setPastEvents((prev) => mergeTeamEvents(prev, evts, 'last'));
      setPastApiPage(nextPage);
      if (evts.length === 0) setHasMorePast(false);
    } catch (e) {
      console.error('loadMorePast error:', e);
    } finally {
      setLoadingMatches(false);
    }
  };

  const loadMoreFuture = async () => {
    if (!hasMoreFuture || loadingMatches) return;
    setLoadingMatches(true);
    try {
      const nextPage = futureApiPage + 1;
      const evts = await getTeamEventsByDirection(teamId, 'next', nextPage);
      setFutureEvents((prev) => mergeTeamEvents(prev, evts, 'next'));
      setFutureApiPage(nextPage);
      if (evts.length === 0) setHasMoreFuture(false);
    } catch (e) {
      console.error('loadMoreFuture error:', e);
    } finally {
      setLoadingMatches(false);
    }
  };

  const handleTabSwitch = async (tab: 'last' | 'next') => {
    setActiveTab(tab);
    setDisplayOffset(0);
    if (tab === 'next' && futureEvents.length === 0 && hasMoreFuture) {
      setLoadingMatches(true);
      try {
        const evts = await getTeamEventsByDirection(teamId, 'next', 0);
        setFutureEvents(mergeTeamEvents([], evts, 'next'));
        if (evts.length === 0) setHasMoreFuture(false);
      } catch (e) {
        console.error('handleTabSwitch next error:', e);
      } finally {
        setLoadingMatches(false);
      }
    }
  };

  const handleLeft = async () => {
    if (activeTab === 'last') {
      if (displayOffset + PAGE_SIZE >= activeEvents.length && hasMorePast) await loadMorePast();
      setDisplayOffset((o) => o + PAGE_SIZE);
    } else {
      setDisplayOffset((o) => Math.max(0, o - PAGE_SIZE));
    }
  };

  const handleRight = async () => {
    if (activeTab === 'last') {
      setDisplayOffset((o) => Math.max(0, o - PAGE_SIZE));
    } else {
      if (displayOffset + PAGE_SIZE >= activeEvents.length && hasMoreFuture) await loadMoreFuture();
      setDisplayOffset((o) => o + PAGE_SIZE);
    }
  };

  return (
    <div className="w-full bg-surface border border-border rounded-md overflow-hidden" style={{ minWidth: '160px', maxWidth: '200px' }}>
      {/* Filtro competizione */}
      <div className="flex justify-center px-1.5 py-0.5 border-b border-border bg-bg/30">
        <select
          value={effectiveSelectedCompetitionId === 'all' ? 'all' : String(effectiveSelectedCompetitionId)}
          onChange={(e) => setSelectedCompetitionId(e.target.value === 'all' ? 'all' : Number(e.target.value))}
          className="w-full h-6 bg-surface border border-border rounded px-1.5 text-[10px] text-center text-text-primary focus:outline-none focus:border-neon"
          style={{ textAlignLast: 'center' }}
        >
          <option value="all">Tutte</option>
          {competitionOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {/* Tab ultime/prossime */}
      <div className="grid grid-cols-2 border-b border-border bg-bg/20">
        {(['last', 'next'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => handleTabSwitch(tab)}
            className={`h-6 px-2 text-[10px] font-semibold uppercase tracking-wide transition-colors ${
              activeTab === tab ? 'bg-neon/12 text-neon' : 'text-text-muted hover:bg-surface-hover hover:text-text-primary'
            }`}
          >
            {tab === 'last' ? 'Ultime' : 'Prossime'}
          </button>
        ))}
      </div>

      <div>
        {loadingMatches && visibleEvents.length === 0 ? (
          <div className="flex h-14 items-center justify-center gap-2 text-[10px] text-text-muted">
            <div className="w-3 h-3 border border-neon border-t-transparent rounded-full animate-spin" />
            Caricamento...
          </div>
        ) : visibleEvents.length === 0 ? (
          <div className="flex h-14 items-center justify-center px-3 text-center text-[10px] text-text-muted">
            Nessuna partita disponibile
          </div>
        ) : (
          visibleEvents.map((ev) => {
            const isLive = ev.status?.type === 'inprogress';
            const isFinished = ev.status?.type === 'finished';
            const homeScore = ev.homeScore?.current;
            const awayScore = ev.awayScore?.current;
            const homeTeamName = ev.homeTeam.shortName ?? ev.homeTeam.name;
            const awayTeamName = ev.awayTeam.shortName ?? ev.awayTeam.name;
            return (
              <div key={ev.id} className="border-b border-border/70 last:border-b-0 transition-colors hover:bg-surface-hover/70">
                <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1 px-1.5 py-0.5">
                  <div className="flex min-w-0 flex-col items-center gap-0.5 text-center">
                    <img src={getTeamImageUrl(ev.homeTeam.id)} alt="" className="w-[18px] h-[18px] object-contain"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                    <span className="w-full truncate text-[10px] text-text-primary" title={ev.homeTeam.name}>{homeTeamName}</span>
                  </div>
                  <div className="flex min-w-[44px] flex-col items-center px-1 text-center gap-0.5">
                    {isFinished ? (
                      <span className="text-[12px] font-semibold tabular-nums text-text-primary">{homeScore ?? '?'}–{awayScore ?? '?'}</span>
                    ) : isLive ? (
                      <span className="flex items-center justify-center gap-1 text-[12px] font-semibold tabular-nums text-green-400">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                        {homeScore ?? '0'}–{awayScore ?? '0'}
                      </span>
                    ) : (
                      <span className="text-[11px] font-medium tabular-nums text-text-secondary">{formatMatchTime(ev.startTimestamp)}</span>
                    )}
                    <span className="text-[8px] text-text-muted leading-none">{formatMatchDate(ev.startTimestamp)}</span>
                  </div>
                  <div className="flex min-w-0 flex-col items-center gap-0.5 text-center">
                    <img src={getTeamImageUrl(ev.awayTeam.id)} alt="" className="w-[18px] h-[18px] object-contain"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                    <span className="w-full truncate text-[10px] text-text-primary" title={ev.awayTeam.name}>{awayTeamName}</span>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {(activeEvents.length > 0 || hasMore) && (
        <div className="flex items-center justify-center gap-1.5 border-t border-border px-2 py-0.5 bg-bg/20">
          <button
            disabled={!canGoLeft || loadingMatches}
            onClick={handleLeft}
            className="h-6 min-w-6 px-1 inline-flex items-center justify-center rounded border border-border text-xs text-text-muted hover:border-neon hover:text-text-primary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            {loadingMatches && activeTab === 'last'
              ? <span className="w-3 h-3 border border-neon border-t-transparent rounded-full animate-spin" />
              : '←'}
          </button>
          <button
            disabled={!canGoRight || loadingMatches}
            onClick={handleRight}
            className="h-6 min-w-6 px-1 inline-flex items-center justify-center rounded border border-border text-xs text-text-muted hover:border-neon hover:text-text-primary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            {loadingMatches && activeTab === 'next'
              ? <span className="w-3 h-3 border border-neon border-t-transparent rounded-full animate-spin" />
              : '→'}
          </button>
        </div>
      )}
    </div>
  );
}

// Componente sezione stats + rosa per una singola squadra
interface TeamStatsSectionProps {
  teamId: number;
  roster: Player[];
  defaultCompetitionId?: number;
  defaultSeasonYear?: string;
  onPlayerClick: (player: Player) => void;
  bench: Player[];
}

function parseSeasonDateRange(year: string): { startTimestamp: number; endTimestamp: number } | null {
  const shortSeasonMatch = year.match(/^(\d{2})\/(\d{2})$/);
  if (shortSeasonMatch) {
    const startYear = 2000 + Number(shortSeasonMatch[1]);
    const endYear = 2000 + Number(shortSeasonMatch[2]);
    return {
      startTimestamp: Date.UTC(startYear, 6, 1, 0, 0, 0) / 1000,
      endTimestamp: Date.UTC(endYear, 5, 30, 23, 59, 59) / 1000,
    };
  }

  const longSeasonMatch = year.match(/^(\d{4})\/(\d{2}|\d{4})$/);
  if (longSeasonMatch) {
    const startYear = Number(longSeasonMatch[1]);
    const rawEndYear = longSeasonMatch[2];
    const endYear = rawEndYear.length === 2 ? 2000 + Number(rawEndYear) : Number(rawEndYear);
    return {
      startTimestamp: Date.UTC(startYear, 6, 1, 0, 0, 0) / 1000,
      endTimestamp: Date.UTC(endYear, 5, 30, 23, 59, 59) / 1000,
    };
  }

  const singleYearMatch = year.match(/^(\d{4})$/);
  if (singleYearMatch) {
    const seasonYear = Number(singleYearMatch[1]);
    return {
      startTimestamp: Date.UTC(seasonYear, 0, 1, 0, 0, 0) / 1000,
      endTimestamp: Date.UTC(seasonYear, 11, 31, 23, 59, 59) / 1000,
    };
  }

  return null;
}

function TeamStatsSection({ teamId, roster, defaultCompetitionId, defaultSeasonYear, onPlayerClick, bench }: TeamStatsSectionProps) {
  const [selectedStatsCompetitionId, setSelectedStatsCompetitionId] = useState<'all' | number>(defaultCompetitionId ?? 'all');
  const [selectedStatsSectionId, setSelectedStatsSectionId] = useState<TeamStatsSectionId>('foulsCommitted');
  const [statsSortKey, setStatsSortKey] = useState<TeamStatsSortKey>('total');
  const [statsLineupsMap, setStatsLineupsMap] = useState<Map<number, MatchLineups | null>>(new Map());
  const [statsHistoryStatus, setStatsHistoryStatus] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle');
  const [statsEvents, setStatsEvents] = useState<MatchEvent[]>([]);
  const [statsApiPage, setStatsApiPage] = useState(0);
  const [hasMoreStatsHistory, setHasMoreStatsHistory] = useState(true);
  const markStatsHistoryLoaded = useCallback(() => {
    setStatsHistoryStatus('loaded');
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setStatsHistoryStatus('loading');
      try {
        const events = await getTeamEventsByDirection(teamId, 'last', 0);
        if (cancelled) return;
        setStatsEvents(events);
        setHasMoreStatsHistory(events.length > 0);
        setStatsHistoryStatus(events.length === 0 ? 'loaded' : 'idle');
      } catch (e) {
        if (!cancelled) setStatsHistoryStatus('error');
        console.error('TeamStatsSection fetch error:', e);
      }
    })();

    return () => { cancelled = true; };
  }, [teamId, defaultCompetitionId]);

  const referenceSeasonYear = defaultSeasonYear ?? statsEvents[0]?.season?.year ?? null;
  const statsSeasonDateRange = useMemo(
    () => (referenceSeasonYear ? parseSeasonDateRange(referenceSeasonYear) : null),
    [referenceSeasonYear],
  );
  const reachedOlderStatsSeason = useMemo(() => {
    if (!referenceSeasonYear) return false;

    return statsSeasonDateRange
      ? statsEvents.some((event) => event.startTimestamp < statsSeasonDateRange.startTimestamp)
      : statsEvents.some((event) => event.season?.year && event.season.year !== referenceSeasonYear);
  }, [referenceSeasonYear, statsEvents, statsSeasonDateRange]);

  useEffect(() => {
    if (!referenceSeasonYear || statsHistoryStatus === 'loading' || statsHistoryStatus === 'error') return;
    if (!hasMoreStatsHistory || reachedOlderStatsSeason) {
      if (statsHistoryStatus !== 'loaded') {
        queueMicrotask(() => {
          markStatsHistoryLoaded();
        });
      }
      return;
    }

    let cancelled = false;
    const nextPage = statsApiPage + 1;
    queueMicrotask(() => {
      if (!cancelled) {
        setStatsHistoryStatus('loading');
      }
    });

    void (async () => {
      try {
        const events = await getTeamEventsByDirection(teamId, 'last', nextPage);
        if (cancelled) return;

        if (events.length === 0) {
          setHasMoreStatsHistory(false);
          setStatsHistoryStatus('loaded');
          return;
        }

        setStatsEvents((current) => mergeTeamEvents(current, events, 'last'));
        setStatsApiPage((current) => Math.max(current, nextPage));
        setStatsHistoryStatus('idle');
      } catch (error) {
        console.error('loadMatchupTeamStatsHistory error:', error);
        if (!cancelled) setStatsHistoryStatus('error');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [hasMoreStatsHistory, markStatsHistoryLoaded, reachedOlderStatsSeason, referenceSeasonYear, statsApiPage, statsHistoryStatus, teamId]);

  const currentSeasonPastEvents = useMemo(
    () => statsEvents.filter((event) => (
      event.status?.type === 'finished' && (
        !referenceSeasonYear
          ? true
          : statsSeasonDateRange
            ? event.startTimestamp >= statsSeasonDateRange.startTimestamp && event.startTimestamp <= statsSeasonDateRange.endTimestamp
            : event.season?.year === referenceSeasonYear
      )
    )),
    [referenceSeasonYear, statsEvents, statsSeasonDateRange],
  );
  const statsCompetitionOptions = useMemo(() => buildCompetitionOptions(currentSeasonPastEvents), [currentSeasonPastEvents]);
  const effectiveSelectedStatsCompetitionId = useMemo<'all' | number>(() => {
    if (selectedStatsCompetitionId === 'all') return 'all';
    if (!statsCompetitionOptions.some((competition) => competition.id === selectedStatsCompetitionId)) {
      return 'all';
    }
    return includesCompetition(currentSeasonPastEvents, selectedStatsCompetitionId)
      ? selectedStatsCompetitionId
      : 'all';
  }, [currentSeasonPastEvents, selectedStatsCompetitionId, statsCompetitionOptions]);

  const filteredStatsEvents = useMemo(() => {
    if (effectiveSelectedStatsCompetitionId === 'all') return currentSeasonPastEvents;
    return currentSeasonPastEvents.filter((ev) => ev.tournament?.uniqueTournament?.id === effectiveSelectedStatsCompetitionId);
  }, [currentSeasonPastEvents, effectiveSelectedStatsCompetitionId]);

  const selectedStatsSection = TEAM_STATS_SECTIONS.find((s) => s.id === selectedStatsSectionId) ?? TEAM_STATS_SECTIONS[0];
  const statsRosterIds = useMemo(() => new Set(roster.map((p) => p.id)), [roster]);
  const nextStatsLineupBatch = useMemo(
    () => currentSeasonPastEvents.filter((event) => !statsLineupsMap.has(event.id)).slice(0, TEAM_STATS_FETCH_BATCH_SIZE),
    [currentSeasonPastEvents, statsLineupsMap],
  );

  useEffect(() => {
    if (nextStatsLineupBatch.length === 0) return;

    let cancelled = false;

    void (async () => {
      try {
        const batchResults = await Promise.all(
          nextStatsLineupBatch.map(async (event) => ({
            eventId: event.id,
            lineups: await getMatchLineups(event.id),
          })),
        );

        if (cancelled) return;

        setStatsLineupsMap((current) => {
          const next = new Map(current);
          batchResults.forEach(({ eventId, lineups }) => {
            next.set(eventId, lineups);
          });
          return next;
        });
      } catch (error) {
        console.error('loadMatchupTeamStatsLineups error:', error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [nextStatsLineupBatch]);

  const teamStatsRows = useMemo<TeamPlayerStatsRow[]>(() => {
    const aggregates = new Map<number, { player: Player; total: number; appearances: number; minutes: number }>();
    roster.forEach((player) => { aggregates.set(player.id, { player, total: 0, appearances: 0, minutes: 0 }); });

    filteredStatsEvents.forEach((event) => {
      const lineups = statsLineupsMap.get(event.id);
      if (!lineups) return;
      const teamLineup = event.homeTeam.id === teamId ? lineups.home : event.awayTeam.id === teamId ? lineups.away : null;
      if (!teamLineup) return;
      teamLineup.players.forEach((lineupPlayer) => {
        if (!statsRosterIds.has(lineupPlayer.player.id)) return;
        const statistics = lineupPlayer.statistics as Record<string, unknown> | undefined;
        const total = selectedStatsSection.getValue(statistics);
        const minutes = getNumericStatValue(statistics, ['minutesPlayed']) ?? 0;
        const appeared = minutes > 0 || (!lineupPlayer.substitute && statistics !== undefined);
        const current = aggregates.get(lineupPlayer.player.id);
        if (!current) return;
        current.total += total;
        current.minutes += minutes;
        if (appeared) current.appearances += 1;
      });
    });

    return [...aggregates.values()]
      .filter((row) => row.appearances > 0)
      .map<TeamPlayerStatsRow>((row) => ({
        player: row.player,
        total: row.total,
        appearances: row.appearances,
        perMatch: row.appearances > 0 ? row.total / row.appearances : 0,
        minutes: row.minutes,
        per90: row.minutes > 0 ? (row.total * 90) / row.minutes : 0,
      }))
      .sort((a, b) => {
        const av = a[statsSortKey], bv = b[statsSortKey];
        if (bv !== av) return bv - av;
        return a.player.name.localeCompare(b.player.name, 'it');
      });
  }, [roster, filteredStatsEvents, statsLineupsMap, selectedStatsSection, teamId, statsSortKey, statsRosterIds]);

  const loadingTeamStats = statsHistoryStatus === 'loading' || nextStatsLineupBatch.length > 0;

  const positionLabels: Record<string, string> = { G: 'Portieri', D: 'Difensori', M: 'Centrocampisti', F: 'Attaccanti' };
  const benchByPosition = bench.reduce<Record<string, Player[]>>((acc, p) => {
    const pos = p.position || 'F';
    if (!acc[pos]) acc[pos] = [];
    acc[pos].push(p);
    return acc;
  }, {});

  return (
    <div className="flex flex-col min-w-0">
      {/* Tabella stats */}
      <div className="bg-surface border border-border rounded-md overflow-hidden mb-3">
        {/* Filtro competizione stats */}
        <div className="flex justify-center px-1.5 py-0.5 border-b border-border bg-bg/30">
          <select
            value={effectiveSelectedStatsCompetitionId === 'all' ? 'all' : String(effectiveSelectedStatsCompetitionId)}
            onChange={(e) => setSelectedStatsCompetitionId(e.target.value === 'all' ? 'all' : Number(e.target.value))}
            className="w-full h-6 bg-surface border border-border rounded px-1.5 text-[10px] text-center text-text-primary focus:outline-none focus:border-neon"
            style={{ textAlignLast: 'center' }}
          >
            <option value="all">Tutte</option>
            {statsCompetitionOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>

        {/* Filtro sezione stats */}
        <div className="flex justify-center px-1.5 py-0.5 border-b border-border bg-bg/20">
          <select
            value={selectedStatsSectionId}
            onChange={(e) => setSelectedStatsSectionId(e.target.value as TeamStatsSectionId)}
            className="w-full h-6 bg-surface border border-border rounded px-1.5 text-[10px] text-center text-text-primary focus:outline-none focus:border-neon"
            style={{ textAlignLast: 'center' }}
          >
            {TEAM_STATS_SECTIONS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </div>

        <div className="overflow-x-auto">
          <div style={{ minWidth: `${STATS_TABLE_MIN_WIDTH}px` }}>
            <div className="grid border-b border-border bg-bg/20" style={{ gridTemplateColumns: STATS_TABLE_COLUMNS }}>
              <div className="px-1.5 py-1 text-[9px] font-semibold uppercase tracking-wide text-text-secondary">Giocatore</div>
              {[{ key: 'total', label: 'Tot' }, { key: 'perMatch', label: 'xP' }, { key: 'per90', label: '/90' }, { key: 'appearances', label: 'PG' }, { key: 'minutes', label: 'Min' }].map((col) => (
                <button
                  key={col.key}
                  onClick={() => setStatsSortKey(col.key as TeamStatsSortKey)}
                  className={`px-1 py-1 text-[9px] font-semibold uppercase tracking-wide transition-colors ${
                    statsSortKey === col.key ? 'bg-neon/12 text-neon' : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary'
                  }`}
                >
                  {col.label}
                </button>
              ))}
            </div>

            <div style={{ maxHeight: `${TABLE_BODY_MAX_HEIGHT}px` }} className="overflow-y-auto overflow-x-hidden">
              {loadingTeamStats && teamStatsRows.length === 0 ? (
                <div className="flex h-14 items-center justify-center gap-2 text-[10px] text-text-muted">
                  <div className="w-3 h-3 border border-neon border-t-transparent rounded-full animate-spin" />
                  Caricamento...
                </div>
              ) : filteredStatsEvents.length === 0 ? (
                <div className="flex h-14 items-center justify-center px-3 text-center text-[10px] text-text-muted">
                  Nessun dato statistico disponibile
                </div>
              ) : teamStatsRows.length === 0 ? (
                <div className="flex h-14 items-center justify-center px-3 text-center text-[10px] text-text-muted">
                  Nessun giocatore con presenze disponibili
                </div>
              ) : (
                teamStatsRows.map((row) => (
                  <div
                    key={row.player.id}
                    className="grid border-b border-border/70 last:border-b-0 transition-colors hover:bg-surface-hover/70"
                    style={{ minHeight: `${TABLE_PANEL_ROW_HEIGHT}px`, gridTemplateColumns: STATS_TABLE_COLUMNS }}
                  >
                    <button
                      onClick={() => onPlayerClick(row.player)}
                      className="truncate px-1.5 text-left text-[10px] text-text-primary hover:text-neon"
                      title={row.player.name}
                    >
                      {row.player.shortName ?? row.player.name}
                    </button>
                    <div className="flex items-center justify-center px-1 text-[10px] tabular-nums text-text-primary">{row.total}</div>
                    <div className="flex items-center justify-center px-1 text-[10px] tabular-nums text-text-secondary">{formatDecimalStat(row.perMatch)}</div>
                    <div className="flex items-center justify-center px-1 text-[10px] tabular-nums text-text-secondary">{formatDecimalStat(row.per90)}</div>
                    <div className="flex items-center justify-center px-1 text-[10px] tabular-nums text-text-primary">{row.appearances}</div>
                    <div className="flex items-center justify-center px-1 text-[10px] tabular-nums text-text-secondary">{row.minutes}</div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border px-2 py-0.5 bg-bg/20 text-[9px] text-text-muted">
          <span>{selectedStatsSection.label}</span>
          <span>{teamStatsRows.length} giocatori</span>
        </div>
      </div>

      {/* Rosa completa */}
      <div>
        <h3 className="text-xs mb-2.5 font-semibold text-text-secondary uppercase tracking-wide">Rosa completa</h3>
        {['G', 'D', 'M', 'F'].map((pos) => {
          const players = benchByPosition[pos];
          if (!players?.length) return null;
          return (
            <div key={pos} className="mb-3.5">
              <p className="text-text-muted text-[11px] mb-1.5">{positionLabels[pos]}</p>
              <div className="flex flex-wrap gap-1.5">
                {players.map((p) => {
                  const parts = p.name.split(' ');
                  const shortName = parts.length > 1 ? `${parts[0][0]}. ${parts.slice(1).join(' ')}` : p.name;
                  return (
                    <button
                      key={p.id}
                      onClick={() => onPlayerClick(p)}
                      className="inline-flex items-center gap-1 rounded-full border border-border bg-surface text-text-primary hover:border-neon transition-colors px-2 py-0.5 text-[11px]"
                    >
                      <span className="truncate">{shortName}</span>
                      {p.jerseyNumber && <span className="text-[10px] text-text-muted">#{p.jerseyNumber}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function MatchupView({ eventId, homeTeamId, homeTeamName, awayTeamId, awayTeamName, leagueId, leagueName, seasonYear }: MatchupViewProps) {
  const { goBack, selectPlayer } = useNavigation();

  const [homeRoster, setHomeRoster] = useState<Player[]>([]);
  const [awayRoster, setAwayRoster] = useState<Player[]>([]);
  const [homeLineup, setHomeLineup] = useState<TeamLineup | null>(null);
  const [awayLineup, setAwayLineup] = useState<TeamLineup | null>(null);
  const [loadingLineups, setLoadingLineups] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoadingLineups(true);
    setHomeLineup(null);
    setAwayLineup(null);

    (async () => {
      try {
        const [homePlayersData, awayPlayersData, lineups] = await Promise.all([
          getTeamPlayers(homeTeamId),
          getTeamPlayers(awayTeamId),
          getMatchLineups(eventId),
        ]);
        if (cancelled) return;
        setHomeRoster(homePlayersData.map((p) => p.player));
        setAwayRoster(awayPlayersData.map((p) => p.player));

        if (lineups) {
          setHomeLineup(lineups.home);
          setAwayLineup(lineups.away);
        }
      } catch (e) {
        console.error('MatchupView fetch error:', e);
      } finally {
        if (!cancelled) setLoadingLineups(false);
      }
    })();

    return () => { cancelled = true; };
  }, [homeTeamId, awayTeamId, eventId]);

  const homeStarters = useMemo(() => homeLineup?.players.filter((p) => !p.substitute) ?? [], [homeLineup]);
  const awayStarters = useMemo(() => awayLineup?.players.filter((p) => !p.substitute) ?? [], [awayLineup]);
  const homeFormationPositions = useMemo(() => homeLineup?.formation ? getFormationPositions(homeLineup.formation) : [], [homeLineup]);
  const awayFormationPositions = useMemo(() => awayLineup?.formation ? getFormationPositions(awayLineup.formation) : [], [awayLineup]);

  const homeStarterIds = useMemo(() => new Set(homeStarters.map((p) => p.player.id)), [homeStarters]);
  const awayStarterIds = useMemo(() => new Set(awayStarters.map((p) => p.player.id)), [awayStarters]);
  const homeBench = useMemo(() => homeRoster.filter((p) => !homeStarterIds.has(p.id)), [homeRoster, homeStarterIds]);
  const awayBench = useMemo(() => awayRoster.filter((p) => !awayStarterIds.has(p.id)), [awayRoster, awayStarterIds]);

  const handlePlayerClick = (player: Player) => {
    selectPlayer(0, player.id, player);
  };

  const hasField = homeStarters.length > 0 || awayStarters.length > 0;

  return (
    <div className="w-full">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <button
          onClick={() => goBack(0)}
          className="flex items-center gap-1.5 text-sm text-text-muted hover:text-text-primary transition-colors"
        >
          ← Indietro
        </button>
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <img src={getTeamImageUrl(homeTeamId)} alt="" className="w-8 h-8 object-contain flex-shrink-0"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          <span className="text-lg font-bold text-text-primary truncate">{homeTeamName}</span>
          <span className="text-text-muted mx-1">vs</span>
          <span className="text-lg font-bold text-text-primary truncate">{awayTeamName}</span>
          <img src={getTeamImageUrl(awayTeamId)} alt="" className="w-8 h-8 object-contain flex-shrink-0"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
        </div>
        {leagueName && (
          <span className="text-xs text-text-muted flex-shrink-0">{leagueName}</span>
        )}
      </div>

      {/* Layout principale: colonna sx partite + campo + colonna dx partite */}
      <div className="flex flex-row gap-3 items-start mb-5">
        {/* Colonna sinistra: partite squadra di casa */}
        <TeamMatchesSection teamId={homeTeamId} defaultCompetitionId={leagueId} />

        {/* Campo unificato landscape */}
        <div className="flex-1 min-w-0">
          {loadingLineups ? (
            <div className="flex items-center justify-center gap-2 text-text-muted" style={{ aspectRatio: '105/68' }}>
              <div className="w-4 h-4 border-2 border-neon border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <div
              className="relative bg-field-bg border border-field-lines rounded-lg overflow-hidden w-full"
              style={{ aspectRatio: '105/68' }}
            >
              {/* SVG campo landscape */}
              <svg className="absolute inset-0 w-full h-full" viewBox="0 0 1050 680" preserveAspectRatio="none">
                <rect x="10" y="10" width="1030" height="660" fill="none" stroke="#2a5535" strokeWidth="2" />
                <line x1="525" y1="10" x2="525" y2="670" stroke="#2a5535" strokeWidth="2" />
                <circle cx="525" cy="340" r="91.5" fill="none" stroke="#2a5535" strokeWidth="2" />
                {/* Area di rigore casa (sinistra) */}
                <rect x="10" y="138" width="165" height="404" fill="none" stroke="#2a5535" strokeWidth="2" />
                <rect x="10" y="218" width="55" height="244" fill="none" stroke="#2a5535" strokeWidth="2" />
                {/* Area di rigore trasferta (destra) */}
                <rect x="875" y="138" width="165" height="404" fill="none" stroke="#2a5535" strokeWidth="2" />
                <rect x="985" y="218" width="55" height="244" fill="none" stroke="#2a5535" strokeWidth="2" />
              </svg>

              {/* Label formazioni */}
              {homeLineup?.formation && (
                <div className="absolute top-1 left-2 z-10">
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-neon/20 text-neon text-[10px] font-medium">
                    {homeLineup.formation}
                  </span>
                </div>
              )}
              {awayLineup?.formation && (
                <div className="absolute top-1 right-2 z-10">
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-negative/20 text-negative text-[10px] font-medium">
                    {awayLineup.formation}
                  </span>
                </div>
              )}

              {/* Giocatori casa (verde neon, prima metà campo sinistra) */}
              {homeStarters.map((lp, idx) => {
                const pos = homeFormationPositions[idx];
                if (!pos) return null;
                const playerPos = getHomePlayerPos(pos);
                return (
                  <button
                    key={lp.player.id}
                    onClick={() => handlePlayerClick(lp.player)}
                    className="absolute flex flex-col items-center transform -translate-x-1/2 -translate-y-1/2 group z-10"
                    style={playerPos}
                  >
                    <div className="w-7 h-7 text-[11px] rounded-full bg-neon/80 flex items-center justify-center font-bold text-black group-hover:bg-neon transition-colors">
                      {lp.player.jerseyNumber ?? idx + 1}
                    </div>
                    <span className="text-[9px] max-w-[52px] text-white mt-0.5 font-medium text-center leading-tight truncate drop-shadow">
                      {lp.player.shortName ?? lp.player.name.split(' ').pop()}
                    </span>
                  </button>
                );
              })}

              {/* Giocatori trasferta (rosso, seconda metà campo destra, specchiati) */}
              {awayStarters.map((lp, idx) => {
                const pos = awayFormationPositions[idx];
                if (!pos) return null;
                const playerPos = getAwayPlayerPos(pos);
                return (
                  <button
                    key={lp.player.id}
                    onClick={() => handlePlayerClick(lp.player)}
                    className="absolute flex flex-col items-center transform -translate-x-1/2 -translate-y-1/2 group z-10"
                    style={playerPos}
                  >
                    <div className="w-7 h-7 text-[11px] rounded-full bg-negative/80 flex items-center justify-center font-bold text-white group-hover:bg-negative transition-colors">
                      {lp.player.jerseyNumber ?? idx + 1}
                    </div>
                    <span className="text-[9px] max-w-[52px] text-white mt-0.5 font-medium text-center leading-tight truncate drop-shadow">
                      {lp.player.shortName ?? lp.player.name.split(' ').pop()}
                    </span>
                  </button>
                );
              })}

              {/* Messaggio se nessuna formazione disponibile */}
              {!hasField && !loadingLineups && (
                <div className="absolute inset-0 flex items-center justify-center text-text-muted text-sm">
                  Formazione non disponibile
                </div>
              )}
            </div>
          )}
        </div>

        {/* Colonna destra: partite squadra in trasferta */}
        <TeamMatchesSection teamId={awayTeamId} defaultCompetitionId={leagueId} />
      </div>

      {/* Sezione inferiore: stats + rosa divisa 50/50 */}
      <div className="flex flex-row gap-0 min-h-0">
        {/* Sinistra: casa */}
        <div className="flex-1 min-w-0 overflow-y-auto pr-3 border-r border-border" style={{ maxHeight: '60vh' }}>
          <div className="flex items-center gap-2 mb-3">
            <img src={getTeamImageUrl(homeTeamId)} alt="" className="w-5 h-5 object-contain"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
            <span className="text-sm font-semibold text-text-primary">{homeTeamName}</span>
          </div>
          <TeamStatsSection
            key={`home-stats-${homeTeamId}-${leagueId ?? 'all'}-${seasonYear ?? 'unknown'}`}
            teamId={homeTeamId}
            roster={homeRoster}
            defaultCompetitionId={leagueId}
            defaultSeasonYear={seasonYear}
            onPlayerClick={handlePlayerClick}
            bench={homeBench}
          />
        </div>

        {/* Destra: trasferta */}
        <div className="flex-1 min-w-0 overflow-y-auto pl-3" style={{ maxHeight: '60vh' }}>
          <div className="flex items-center gap-2 mb-3">
            <img src={getTeamImageUrl(awayTeamId)} alt="" className="w-5 h-5 object-contain"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
            <span className="text-sm font-semibold text-text-primary">{awayTeamName}</span>
          </div>
          <TeamStatsSection
            key={`away-stats-${awayTeamId}-${leagueId ?? 'all'}-${seasonYear ?? 'unknown'}`}
            teamId={awayTeamId}
            roster={awayRoster}
            defaultCompetitionId={leagueId}
            defaultSeasonYear={seasonYear}
            onPlayerClick={handlePlayerClick}
            bench={awayBench}
          />
        </div>
      </div>
    </div>
  );
}
