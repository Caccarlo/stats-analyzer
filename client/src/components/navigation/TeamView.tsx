import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigation } from '@/context/NavigationContext';
import {
  getTeamPlayers,
  getTeamNextEvent,
  getMatchLineups,
  getTeamImageUrl,
  getTeamEventsByDirection,
} from '@/api/sofascore';
import { getFormationPositions } from '@/utils/positionMapping';
import { getMatchRoundLabel } from '@/utils/matchRoundLabel';
import { getShotsCount, getShotsOnTargetCount } from '@/utils/playerStats';
import type { Player, MatchEvent, LineupPlayer, MatchLineups } from '@/types';
import { useViewport } from '@/hooks/useViewport';

const PAGE_SIZE = 5;
const MATCHES_SECTION_TARGET_MIN_WIDTH = 176;  // -20% vs 220
const MATCHES_SECTION_HARD_MIN_WIDTH = 160;    // -20% vs 200
const LAYOUT_GAP = 20;
const LANDSCAPE_LAYOUT_MIN_PANEL_WIDTH = 620;
const PORTRAIT_RIGHT_MIN_PANEL_WIDTH = 420;
const TABLE_PANEL_ROW_HEIGHT = 22;
const TABLE_BODY_MAX_HEIGHT_COMPACT = 171;
const TABLE_BODY_MAX_HEIGHT_REGULAR = 171;
const STATS_TABLE_MIN_WIDTH = 352;
const TEAM_STATS_FETCH_BATCH_SIZE = 4;
const STATS_TABLE_COLUMNS = '100px 40px 52px 48px 40px 40px';

type TeamStatsSectionId = 'foulsCommitted' | 'foulsSuffered' | 'shots' | 'shotsOnTarget';
type TeamStatsSortKey = 'total' | 'appearances' | 'perMatch' | 'minutes' | 'per90';
const LANDSCAPE_FIELD_WIDTH = 400;             // fisso: altezza risultante ≈ altezza naturale sezione partite
const PORTRAIT_FIELD_MIN_WIDTH = 220;
const PORTRAIT_FIELD_MAX_WIDTH = 300;

interface TeamViewProps {
  teamId: number;
  panelIndex?: number;
  availableWidth?: number;
}

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

function formatMatchDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString('it-IT', { day: '2-digit', month: 'short' });
}

function formatMatchTime(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
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

function getNumericStatValue(
  statistics: Record<string, unknown> | undefined,
  keys: readonly string[],
): number | null {
  if (!statistics) return null;

  for (const key of keys) {
    const value = statistics[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  }

  return null;
}

function formatDecimalStat(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : '0.00';
}

const TEAM_STATS_SECTIONS: TeamStatsSectionOption[] = [
  {
    id: 'foulsCommitted',
    label: 'Falli commessi',
    getValue: (statistics) => getNumericStatValue(statistics, ['fouls']) ?? 0,
  },
  {
    id: 'foulsSuffered',
    label: 'Falli subiti',
    getValue: (statistics) => getNumericStatValue(statistics, ['wasFouled']) ?? 0,
  },
  {
    id: 'shots',
    label: 'Tiri',
    getValue: (statistics) => getShotsCount((statistics ?? null) as Record<string, unknown> | null) ?? 0,
  },
  {
    id: 'shotsOnTarget',
    label: 'Tiri in porta',
    getValue: (statistics) => getShotsOnTargetCount((statistics ?? null) as Record<string, unknown> | null) ?? 0,
  },
];

function getEventCompetition(event: MatchEvent): CompetitionOption | null {
  const tournament = event.tournament?.uniqueTournament;
  if (!tournament?.id) return null;

  const name = tournament.name?.trim() || event.tournament?.name?.trim();
  if (!name) return null;

  return { id: tournament.id, name };
}

function buildCompetitionOptions(events: MatchEvent[], nextEvent: MatchEvent | null): CompetitionOption[] {
  const deduped = new Map<number, CompetitionOption>();

  const addEventCompetition = (event: MatchEvent | null) => {
    if (!event) return;
    const competition = getEventCompetition(event);
    if (!competition || deduped.has(competition.id)) return;
    deduped.set(competition.id, competition);
  };

  addEventCompetition(nextEvent);
  events.forEach(addEventCompetition);

  return [...deduped.values()].sort((a, b) => a.name.localeCompare(b.name, 'it'));
}

function mergeTeamEvents(currentEvents: MatchEvent[], incomingEvents: MatchEvent[], direction: 'last' | 'next'): MatchEvent[] {
  const deduped = new Map<number, MatchEvent>();

  [...currentEvents, ...incomingEvents].forEach((event) => {
    deduped.set(event.id, event);
  });

  return [...deduped.values()].sort((a, b) =>
    direction === 'last'
      ? b.startTimestamp - a.startTimestamp
      : a.startTimestamp - b.startTimestamp
  );
}

function matchesCompetition(event: MatchEvent, selectedCompetitionId: 'all' | number): boolean {
  if (selectedCompetitionId === 'all') return true;
  return event.tournament?.uniqueTournament?.id === selectedCompetitionId;
}

type TeamViewLayoutMode = 'landscape-right' | 'portrait-right' | 'portrait-bottom';

export default function TeamView({ teamId, panelIndex = 0, availableWidth }: TeamViewProps) {
  const { state, selectPlayer, openSplitPlayer, openSplitTeam, selectTeam, navigateTo } = useNavigation();
  const { width, height } = useViewport();
  const hasSplit = state.panels.length > 1;
  const panel = state.panels[panelIndex];

  const [roster, setRoster] = useState<Player[]>([]);
  const [nextEvent, setNextEvent] = useState<MatchEvent | null>(null);
  const [lineupPlayers, setLineupPlayers] = useState<LineupPlayer[]>([]);
  const [formation, setFormation] = useState('');
  const [loading, setLoading] = useState(true);
  const [teamName, setTeamName] = useState(panel?.teamName ?? '');
  const [isHome, setIsHome] = useState(true);

  // Sezione partite: pastEvents DESC (più recente = indice 0), futureEvents ASC (più imminente = indice 0)
  const [activeTab, setActiveTab] = useState<'last' | 'next'>('last');
  const [selectedCompetitionId, setSelectedCompetitionId] = useState<'all' | number>('all');
  const [pastEvents, setPastEvents] = useState<MatchEvent[]>([]);
  const [futureEvents, setFutureEvents] = useState<MatchEvent[]>([]);
  const [pastApiPage, setPastApiPage] = useState(0);
  const [futureApiPage, setFutureApiPage] = useState(0);
  const [hasMorePast, setHasMorePast] = useState(true);
  const [hasMoreFuture, setHasMoreFuture] = useState(true);
  const [displayOffset, setDisplayOffset] = useState(0);
  const [loadingMatches, setLoadingMatches] = useState(false);
  const [hasPrefetchedMatches, setHasPrefetchedMatches] = useState(false);
  const [selectedStatsCompetitionId, setSelectedStatsCompetitionId] = useState<'all' | number>('all');
  const [selectedStatsSectionId, setSelectedStatsSectionId] = useState<TeamStatsSectionId>('foulsCommitted');
  const [statsSortKey, setStatsSortKey] = useState<TeamStatsSortKey>('total');
  const [statsLineupsMap, setStatsLineupsMap] = useState<Map<number, MatchLineups | null>>(new Map());
  const [statsHistoryStatus, setStatsHistoryStatus] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setTeamName(panel?.teamName ?? '');
    setNextEvent(null);
    setLineupPlayers([]);
    setFormation('');
    setIsHome(true);
    setPastEvents([]);
    setFutureEvents([]);
    setPastApiPage(0);
    setFutureApiPage(0);
    setHasMorePast(true);
    setHasMoreFuture(true);
    setDisplayOffset(0);
    setActiveTab('last');
    setSelectedCompetitionId('all');
    setHasPrefetchedMatches(false);
    setSelectedStatsCompetitionId('all');
    setSelectedStatsSectionId('foulsCommitted');
    setStatsSortKey('total');
    setStatsLineupsMap(new Map());
    setStatsHistoryStatus('idle');

    (async () => {
      try {
        const [playersData, event, pastEvts] = await Promise.all([
          getTeamPlayers(teamId),
          getTeamNextEvent(teamId),
          getTeamEventsByDirection(teamId, 'last', 0),
        ]);
        if (cancelled) return;

        setRoster(playersData.map((p) => p.player));

        if (event) {
          setNextEvent(event);
          const eventIsHome = event.homeTeam.id === teamId;
          setIsHome(eventIsHome);
          if (!panel?.teamName) {
            const nameFromEvent = eventIsHome ? event.homeTeam.name : event.awayTeam.name;
            if (nameFromEvent) setTeamName(nameFromEvent);
          }
          const lineups = await getMatchLineups(event.id);
          if (!cancelled && lineups) {
            const teamLineup = event.homeTeam.id === teamId ? lineups.home : lineups.away;
            setFormation(teamLineup.formation);
            setLineupPlayers(teamLineup.players);
          }
        }

        if (!cancelled) {
          setPastEvents(mergeTeamEvents([], pastEvts, 'last'));
          if (pastEvts.length === 0) setHasMorePast(false);
        }
      } catch (e) {
        console.error('TeamView error:', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [teamId, panel?.teamName]);

  // Fallback contesto league/paese
  useEffect(() => {
    if (!nextEvent?.tournament?.uniqueTournament) return;
    if (panel?.leagueId && panel?.countryId) return;
    const ut = nextEvent.tournament.uniqueTournament;
    navigateTo(panelIndex, 'team', {
      leagueId: panel?.leagueId ?? ut.id,
      leagueName: panel?.leagueName ?? ut.name,
      countryId: panel?.countryId ?? ut.category?.alpha2 ?? (ut.category?.id !== undefined ? String(ut.category.id) : undefined),
      countryName: panel?.countryName ?? ut.category?.name,
      countryCategoryId: panel?.countryCategoryId ?? ut.category?.id,
      tournamentPhaseKey: panel?.tournamentPhaseKey,
      tournamentPhaseName: panel?.tournamentPhaseName,
    });
  }, [nextEvent, panel?.leagueId, panel?.leagueName, panel?.countryId, panel?.countryName, panel?.countryCategoryId, panel?.tournamentPhaseKey, panel?.tournamentPhaseName, panelIndex, navigateTo]);

  useEffect(() => {
    if (loading || hasPrefetchedMatches) return;

    let cancelled = false;
    const timeoutId = window.setTimeout(() => {
      void (async () => {
        const [nextPageZero, pastPageOne, nextPageOne] = await Promise.allSettled([
          getTeamEventsByDirection(teamId, 'next', 0),
          getTeamEventsByDirection(teamId, 'last', 1),
          getTeamEventsByDirection(teamId, 'next', 1),
        ]);

        if (cancelled) return;

        if (nextPageZero.status === 'fulfilled') {
          const events = nextPageZero.value;
          setFutureEvents((current) => mergeTeamEvents(current, events, 'next'));
          if (events.length === 0) {
            setHasMoreFuture(false);
          } else {
            setFutureApiPage((current) => Math.max(current, 0));
          }
        } else {
          console.error('prefetch next/0 error:', nextPageZero.reason);
        }

        if (pastPageOne.status === 'fulfilled') {
          const events = pastPageOne.value;
          if (events.length === 0) {
            setHasMorePast(false);
          } else {
            setPastEvents((current) => mergeTeamEvents(current, events, 'last'));
            setPastApiPage((current) => Math.max(current, 1));
          }
        } else {
          console.error('prefetch last/1 error:', pastPageOne.reason);
        }

        if (nextPageOne.status === 'fulfilled') {
          const events = nextPageOne.value;
          if (events.length === 0) {
            setHasMoreFuture(false);
          } else {
            setFutureEvents((current) => mergeTeamEvents(current, events, 'next'));
            setFutureApiPage((current) => Math.max(current, 1));
          }
        } else {
          console.error('prefetch next/1 error:', nextPageOne.reason);
        }
      })();
    }, 0);

    setHasPrefetchedMatches(true);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [loading, hasPrefetchedMatches, teamId]);

  const loadMorePast = useCallback(async () => {
    if (loadingMatches || !hasMorePast) return false;
    setLoadingMatches(true);
    try {
      const nextPage = pastApiPage + 1;
      const evts = await getTeamEventsByDirection(teamId, 'last', nextPage);
      if (evts.length === 0) {
        setHasMorePast(false);
        return false;
      } else {
        setPastEvents((prev) => mergeTeamEvents(prev, evts, 'last'));
        setPastApiPage(nextPage);
        return true;
      }
    } catch (e) {
      console.error('loadMorePast error:', e);
      return false;
    } finally {
      setLoadingMatches(false);
    }
  }, [loadingMatches, hasMorePast, pastApiPage, teamId]);

  const loadMoreFuture = useCallback(async () => {
    if (loadingMatches || !hasMoreFuture) return false;
    setLoadingMatches(true);
    try {
      const nextPage = futureApiPage + 1;
      const evts = await getTeamEventsByDirection(teamId, 'next', nextPage);
      if (evts.length === 0) {
        setHasMoreFuture(false);
        return false;
      } else {
        setFutureEvents((prev) => mergeTeamEvents(prev, evts, 'next'));
        setFutureApiPage(nextPage);
        return true;
      }
    } catch (e) {
      console.error('loadMoreFuture error:', e);
      return false;
    } finally {
      setLoadingMatches(false);
    }
  }, [loadingMatches, hasMoreFuture, futureApiPage, teamId]);

  const handleTabSwitch = (tab: 'last' | 'next') => {
    setActiveTab(tab);
    setDisplayOffset(0);
    if (tab === 'next' && futureEvents.length === 0 && hasMoreFuture) {
      (async () => {
        setLoadingMatches(true);
        try {
          const evts = await getTeamEventsByDirection(teamId, 'next', 0);
          setFutureEvents((prev) => mergeTeamEvents(prev, evts, 'next'));
          if (evts.length === 0) {
            setHasMoreFuture(false);
          } else {
            setFutureApiPage((current) => Math.max(current, 0));
          }
        } catch (e) {
          console.error('loadFuture error:', e);
        } finally {
          setLoadingMatches(false);
        }
      })();
    }
  };

  const allKnownEvents = nextEvent
    ? [...pastEvents, ...futureEvents, nextEvent]
    : [...pastEvents, ...futureEvents];
  const competitionOptions = buildCompetitionOptions(allKnownEvents, nextEvent);
  const filteredPastEvents = pastEvents.filter((event) => matchesCompetition(event, selectedCompetitionId));
  const filteredFutureEvents = futureEvents.filter((event) => matchesCompetition(event, selectedCompetitionId));
  const activeEvents = activeTab === 'last' ? filteredPastEvents : filteredFutureEvents;
  const hasMore = activeTab === 'last' ? hasMorePast : hasMoreFuture;
  const visibleEvents = activeEvents.slice(displayOffset, displayOffset + PAGE_SIZE);

  // Ultime: ← = più vecchie (offset sale), → = più recenti (offset scende)
  // Prossime: ← = più imminenti (offset scende), → = più lontane (offset sale)
  useEffect(() => {
    if (selectedCompetitionId === 'all') return;
    if (competitionOptions.some((competition) => competition.id === selectedCompetitionId)) return;
    setSelectedCompetitionId('all');
  }, [competitionOptions, selectedCompetitionId]);

  useEffect(() => {
    setDisplayOffset(0);
  }, [selectedCompetitionId]);

  useEffect(() => {
    setStatsSortKey('total');
  }, [selectedStatsSectionId]);

  useEffect(() => {
    if (displayOffset === 0) return;
    if (activeEvents.length === 0) {
      setDisplayOffset(0);
      return;
    }

    const maxOffset = Math.floor((activeEvents.length - 1) / PAGE_SIZE) * PAGE_SIZE;
    if (displayOffset > maxOffset) {
      setDisplayOffset(maxOffset);
    }
  }, [activeEvents.length, displayOffset]);

  const referenceSeasonYear = pastEvents[0]?.season?.year ?? nextEvent?.season?.year ?? null;
  const statsSeasonDateRange = useMemo(
    () => (referenceSeasonYear ? parseSeasonDateRange(referenceSeasonYear) : null),
    [referenceSeasonYear],
  );
  const reachedOlderStatsSeason = useMemo(() => {
    if (!referenceSeasonYear) return false;

    return statsSeasonDateRange
      ? pastEvents.some((event) => event.startTimestamp < statsSeasonDateRange.startTimestamp)
      : pastEvents.some((event) => event.season?.year && event.season.year !== referenceSeasonYear);
  }, [pastEvents, referenceSeasonYear, statsSeasonDateRange]);

  useEffect(() => {
    if (loading || !referenceSeasonYear || statsHistoryStatus === 'error') return;
    if (!hasMorePast || reachedOlderStatsSeason) {
      setStatsHistoryStatus('loaded');
      return;
    }

    let cancelled = false;
    setStatsHistoryStatus('loading');
    const nextPage = pastApiPage + 1;

    void (async () => {
      try {
        const events = await getTeamEventsByDirection(teamId, 'last', nextPage);
        if (cancelled) return;

        if (events.length === 0) {
          setHasMorePast(false);
          setStatsHistoryStatus('loaded');
          return;
        }

        setPastEvents((current) => mergeTeamEvents(current, events, 'last'));
        setPastApiPage((current) => Math.max(current, nextPage));
      } catch (error) {
        console.error('loadStatsHistory error:', error);
        if (!cancelled) setStatsHistoryStatus('error');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loading, referenceSeasonYear, statsHistoryStatus, hasMorePast, reachedOlderStatsSeason, pastApiPage, teamId]);

  const currentSeasonPastEvents = useMemo(() => {
    if (!referenceSeasonYear) return [];

    return pastEvents.filter(
      (event) => (
        event.status?.type === 'finished' && (
          statsSeasonDateRange
            ? event.startTimestamp >= statsSeasonDateRange.startTimestamp && event.startTimestamp <= statsSeasonDateRange.endTimestamp
            : event.season?.year === referenceSeasonYear
        )
      ),
    );
  }, [pastEvents, referenceSeasonYear, statsSeasonDateRange]);

  const statsCompetitionOptions = useMemo(
    () => buildCompetitionOptions(currentSeasonPastEvents, null),
    [currentSeasonPastEvents],
  );

  const statsRosterIds = useMemo(() => new Set(roster.map((player) => player.id)), [roster]);

  useEffect(() => {
    if (selectedStatsCompetitionId === 'all') return;
    if (statsCompetitionOptions.some((competition) => competition.id === selectedStatsCompetitionId)) return;
    setSelectedStatsCompetitionId('all');
  }, [statsCompetitionOptions, selectedStatsCompetitionId]);

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
        console.error('loadTeamStatsLineups error:', error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [nextStatsLineupBatch]);

  const selectedStatsSection = useMemo(
    () => TEAM_STATS_SECTIONS.find((section) => section.id === selectedStatsSectionId) ?? TEAM_STATS_SECTIONS[0],
    [selectedStatsSectionId],
  );

  const filteredStatsEvents = useMemo(
    () => currentSeasonPastEvents.filter((event) => matchesCompetition(event, selectedStatsCompetitionId)),
    [currentSeasonPastEvents, selectedStatsCompetitionId],
  );

  const teamStatsRows = useMemo(() => {
    const aggregates = new Map<number, { player: Player; total: number; appearances: number; minutes: number }>();

    roster.forEach((player) => {
      aggregates.set(player.id, { player, total: 0, appearances: 0, minutes: 0 });
    });

    filteredStatsEvents.forEach((event) => {
      const lineups = statsLineupsMap.get(event.id);
      if (!lineups) return;

      const teamLineup =
        event.homeTeam.id === teamId
          ? lineups.home
          : event.awayTeam.id === teamId
            ? lineups.away
            : null;

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

    const rows = [...aggregates.values()]
      .filter((row) => row.appearances > 0)
      .map<TeamPlayerStatsRow>((row) => ({
        player: row.player,
        total: row.total,
        appearances: row.appearances,
        perMatch: row.appearances > 0 ? row.total / row.appearances : 0,
        minutes: row.minutes,
        per90: row.minutes > 0 ? (row.total * 90) / row.minutes : 0,
      }));

    return rows.sort((left, right) => {
      const leftValue = left[statsSortKey];
      const rightValue = right[statsSortKey];

      if (rightValue !== leftValue) return rightValue - leftValue;
      return left.player.name.localeCompare(right.player.name, 'it');
    });
  }, [roster, filteredStatsEvents, statsLineupsMap, selectedStatsSection, teamId, statsSortKey, statsRosterIds]);

  const loadingTeamStats = statsHistoryStatus === 'loading' || nextStatsLineupBatch.length > 0;

  const canGoLeft = activeTab === 'last'
    ? (displayOffset + PAGE_SIZE < activeEvents.length || (hasMorePast && !loadingMatches))
    : (displayOffset > 0);
  const canGoRight = activeTab === 'last'
    ? (displayOffset > 0)
    : (displayOffset + PAGE_SIZE < activeEvents.length || (hasMoreFuture && !loadingMatches));

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

  const starters = lineupPlayers.filter((p) => !p.substitute);
  const starterIds = new Set(starters.map((p) => p.player.id));
  const bench = roster.filter((p) => !starterIds.has(p.id));
  const formationPositions = formation ? getFormationPositions(formation) : [];
  const opponent = nextEvent ? (isHome ? nextEvent.awayTeam : nextEvent.homeTeam) : null;
  const roundLabel = nextEvent ? getMatchRoundLabel(nextEvent.roundInfo, 'full') : null;

  const isDesktop = width >= 1024;
  const compactDensity = width < 640 || height < 820;
  const effectivePanelWidth = availableWidth ?? 0;
  const hasMeasuredWidth = effectivePanelWidth > 0;
  // Campo landscape: larghezza fissa, identica in fullscreen e split view
  const portraitFieldWidthCandidate = clampNumber(
    hasMeasuredWidth ? effectivePanelWidth * 0.42 : PORTRAIT_FIELD_MAX_WIDTH,
    PORTRAIT_FIELD_MIN_WIDTH,
    PORTRAIT_FIELD_MAX_WIDTH,
  );
  const canUseLandscapeRight =
    hasMeasuredWidth &&
    effectivePanelWidth >= LANDSCAPE_LAYOUT_MIN_PANEL_WIDTH &&
    LANDSCAPE_FIELD_WIDTH + LAYOUT_GAP + MATCHES_SECTION_TARGET_MIN_WIDTH <= effectivePanelWidth;
  const canUsePortraitRight =
    hasMeasuredWidth &&
    effectivePanelWidth >= PORTRAIT_RIGHT_MIN_PANEL_WIDTH &&
    portraitFieldWidthCandidate + LAYOUT_GAP + MATCHES_SECTION_HARD_MIN_WIDTH <= effectivePanelWidth;
  const layoutMode: TeamViewLayoutMode = !hasMeasuredWidth
    ? 'portrait-bottom'
    : canUseLandscapeRight
      ? 'landscape-right'
      : canUsePortraitRight
        ? 'portrait-right'
        : 'portrait-bottom';
  const portraitBottomPanelWidth = hasMeasuredWidth ? effectivePanelWidth : width;
  // portrait-bottom usa campo landscape; cappato al pannello per mobile/split
  const fieldRenderWidth = layoutMode === 'portrait-right'
    ? portraitFieldWidthCandidate
    : Math.min(LANDSCAPE_FIELD_WIDTH, portraitBottomPanelWidth - 24);
  const sideTableWidth = layoutMode === 'portrait-right' ? MATCHES_SECTION_HARD_MIN_WIDTH : MATCHES_SECTION_TARGET_MIN_WIDTH;
  const bottomTableWidth = compactDensity ? 145 : 200;
  const tableBodyMaxHeight = compactDensity ? TABLE_BODY_MAX_HEIGHT_COMPACT : TABLE_BODY_MAX_HEIGHT_REGULAR;
  const canPlaceStatsBesideMatches =
    layoutMode === 'landscape-right' &&
    hasMeasuredWidth &&
    fieldRenderWidth + (LAYOUT_GAP * 2) + (sideTableWidth * 2) <= effectivePanelWidth;
  const showStatsBesideMatches = layoutMode === 'portrait-bottom' || canPlaceStatsBesideMatches;
  const showStatsBesideRosa = layoutMode !== 'portrait-bottom' && !canPlaceStatsBesideMatches;
  const fieldContainerStyle = { width: `${fieldRenderWidth}px`, maxWidth: '100%' } as const;
  // portrait-bottom usa campo orizzontale (landscape) come landscape-right
  const fieldOrientation = layoutMode === 'portrait-right' ? 'portrait' : 'landscape';

  // Posizione giocatori: trasformazione per landscape (GK sinistra, attacco destra)
  // lx = 100 - pos.y  (porta a sinistra = basso y ritratto)
  // ly = 100 - pos.x  (lato sinistro ritratto → basso landscape)
  const getPlayerPos = (pos: { x: number; y: number }) =>
    fieldOrientation === 'landscape'
      ? { left: `${100 - pos.y}%`, top: `${100 - pos.x}%` }
      : { left: `${pos.x}%`, top: `${pos.y}%` };

  const navContext = {
    leagueId: panel?.leagueId,
    leagueName: panel?.leagueName,
    countryId: panel?.countryId,
    countryName: panel?.countryName,
    countryCategoryId: panel?.countryCategoryId,
    tournamentPhaseKey: panel?.tournamentPhaseKey,
    tournamentPhaseName: panel?.tournamentPhaseName,
  };

  const handlePlayerClick = (player: Player) => {
    if (isDesktop && panelIndex === 0 && !hasSplit) {
      openSplitPlayer(player, teamId, teamName, navContext);
    } else if (isDesktop && panelIndex === 0 && hasSplit && state.panels[1]?.teamId === teamId) {
      openSplitPlayer(player, teamId, teamName, navContext);
    } else {
      selectPlayer(panelIndex, player.id, player);
    }
  };

  const handleOpponentClick = () => {
    if (!opponent || !nextEvent) return;
    const homeTeam = nextEvent.homeTeam;
    const awayTeam = nextEvent.awayTeam;
    const ut = nextEvent.tournament.uniqueTournament;
    const matchNavContext = {
      leagueId: ut.id,
      leagueName: ut.name,
      countryId: ut.category?.alpha2 ?? (ut.category?.id !== undefined ? String(ut.category.id) : navContext.countryId),
      countryName: ut.category?.name ?? navContext.countryName,
      countryCategoryId: ut.category?.id ?? navContext.countryCategoryId,
      seasonId: undefined,
    };
    if (!isDesktop) { selectTeam(0, opponent.id, opponent.name); return; }
    if (!hasSplit) {
      navigateTo(0, 'team', { teamId: homeTeam.id, teamName: homeTeam.name, ...matchNavContext });
      openSplitTeam(awayTeam.id, awayTeam.name, matchNavContext);
      return;
    }
    const p0 = state.panels[0];
    const p1 = state.panels[1];
    if (p0?.teamId === homeTeam.id && p1?.teamId === awayTeam.id) return;
    const p0IsPlayer = p0?.view === 'player';
    const p1IsPlayer = p1?.view === 'player';
    if (p1IsPlayer && p1?.teamId === homeTeam.id) {
      navigateTo(0, 'player', { ...p1 });
      navigateTo(1, 'team', { teamId: awayTeam.id, teamName: awayTeam.name, ...matchNavContext });
    } else if (p1IsPlayer && p1?.teamId === awayTeam.id) {
      navigateTo(0, 'team', { teamId: homeTeam.id, teamName: homeTeam.name, ...matchNavContext });
    } else if (p0IsPlayer && p0?.teamId === homeTeam.id) {
      navigateTo(1, 'team', { teamId: awayTeam.id, teamName: awayTeam.name, ...matchNavContext });
    } else if (p0IsPlayer && p0?.teamId === awayTeam.id) {
      navigateTo(0, 'team', { teamId: homeTeam.id, teamName: homeTeam.name, ...matchNavContext });
      navigateTo(1, 'player', { ...p0 });
    } else {
      navigateTo(0, 'team', { teamId: homeTeam.id, teamName: homeTeam.name, ...matchNavContext });
      navigateTo(1, 'team', { teamId: awayTeam.id, teamName: awayTeam.name, ...matchNavContext });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-text-muted">
        <div className="w-4 h-4 border-2 border-neon border-t-transparent rounded-full animate-spin" />
        Caricamento squadra...
      </div>
    );
  }

  const positionLabels: Record<string, string> = { G: 'Portieri', D: 'Difensori', M: 'Centrocampisti', F: 'Attaccanti' };
  const benchByPosition = bench.reduce<Record<string, Player[]>>((acc, p) => {
    const pos = p.position || 'F';
    if (!acc[pos]) acc[pos] = [];
    acc[pos].push(p);
    return acc;
  }, {});

  const emptyMatchesLabel = selectedCompetitionId === 'all'
    ? 'Nessuna partita disponibile'
    : 'Nessuna partita disponibile per questa competizione';
  const emptyStatsLabel = selectedStatsCompetitionId === 'all'
    ? 'Nessun dato statistico disponibile'
    : 'Nessun dato statistico per questa competizione';
  const sharedTablePanelStyle = layoutMode === 'portrait-bottom'
    ? { width: `${bottomTableWidth}px`, maxWidth: '100%' }
    : { width: `${sideTableWidth}px`, minWidth: `${sideTableWidth}px`, maxWidth: '100%' };

  const matchesSection = (
    <div
      className="min-w-0 bg-surface border border-border rounded-md overflow-hidden"
      style={sharedTablePanelStyle}
    >
      {/* Filtro competizione */}
      <div className="flex justify-center px-1.5 py-0.5 border-b border-border bg-bg/30">
        <select
          value={selectedCompetitionId === 'all' ? 'all' : String(selectedCompetitionId)}
          onChange={(event) => {
            const value = event.target.value;
            setSelectedCompetitionId(value === 'all' ? 'all' : Number(value));
          }}
          className="w-full h-6 bg-surface border border-border rounded px-1.5 text-[10px] text-center text-text-primary focus:outline-none focus:border-neon"
          style={{ textAlignLast: 'center' }}
          aria-label="Filtra per competizione"
        >
          <option value="all">Tutte</option>
          {competitionOptions.map((competition) => (
            <option key={competition.id} value={competition.id}>
              {competition.name}
            </option>
          ))}
        </select>
      </div>

      {/* Tab ultime/prossime */}
      <div className="grid grid-cols-2 border-b border-border bg-bg/20">
        {(['last', 'next'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => handleTabSwitch(tab)}
            className={`h-6 px-2 text-[10px] font-semibold uppercase tracking-wide transition-colors ${
              activeTab === tab
                ? 'bg-neon/12 text-neon'
                : 'text-text-muted hover:bg-surface-hover hover:text-text-primary'
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
            {emptyMatchesLabel}
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
                    <img
                      src={getTeamImageUrl(ev.homeTeam.id)}
                      alt=""
                      className="w-[18px] h-[18px] object-contain"
                      onError={(imageEvent) => { (imageEvent.target as HTMLImageElement).style.display = 'none'; }}
                    />
                    <span className="w-full truncate text-[10px] text-text-primary" title={ev.homeTeam.name}>
                      {homeTeamName}
                    </span>
                  </div>
                  <div className="flex min-w-[44px] flex-col items-center px-1 text-center gap-0.5">
                    {isFinished ? (
                      <span className="text-[12px] font-semibold tabular-nums text-text-primary">
                        {homeScore ?? '?'}–{awayScore ?? '?'}
                      </span>
                    ) : isLive ? (
                      <span className="flex items-center justify-center gap-1 text-[12px] font-semibold tabular-nums text-green-400">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                        {homeScore ?? '0'}–{awayScore ?? '0'}
                      </span>
                    ) : (
                      <span className="text-[11px] font-medium tabular-nums text-text-secondary">
                        {formatMatchTime(ev.startTimestamp)}
                      </span>
                    )}
                    <span className="text-[8px] text-text-muted leading-none">
                      {formatMatchDate(ev.startTimestamp)}
                    </span>
                  </div>
                  <div className="flex min-w-0 flex-col items-center gap-0.5 text-center">
                    <img
                      src={getTeamImageUrl(ev.awayTeam.id)}
                      alt=""
                      className="w-[18px] h-[18px] object-contain"
                      onError={(imageEvent) => { (imageEvent.target as HTMLImageElement).style.display = 'none'; }}
                    />
                    <span className="w-full truncate text-[10px] text-text-primary" title={ev.awayTeam.name}>
                      {awayTeamName}
                    </span>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Paginazione */}
      {(activeEvents.length > 0 || hasMore) && (
        <div className="flex items-center justify-center gap-1.5 border-t border-border px-2 py-0.5 bg-bg/20">
          <button
            disabled={!canGoLeft || loadingMatches}
            onClick={handleLeft}
            className="h-6 min-w-6 px-1 inline-flex items-center justify-center rounded border border-border text-xs text-text-muted hover:border-neon hover:text-text-primary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            aria-label="Partite precedenti"
          >
            {loadingMatches && activeTab === 'last'
              ? <span className="w-3 h-3 border border-neon border-t-transparent rounded-full animate-spin" />
              : '←'}
          </button>
          <button
            disabled={!canGoRight || loadingMatches}
            onClick={handleRight}
            className="h-6 min-w-6 px-1 inline-flex items-center justify-center rounded border border-border text-xs text-text-muted hover:border-neon hover:text-text-primary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            aria-label="Partite successive"
          >
            {loadingMatches && activeTab === 'next'
              ? <span className="w-3 h-3 border border-neon border-t-transparent rounded-full animate-spin" />
              : '→'}
          </button>
        </div>
      )}
    </div>
  );

  const statsSection = (
    <div
      className="min-w-0 bg-surface border border-border rounded-md overflow-hidden"
      style={sharedTablePanelStyle}
    >
      <div className="flex justify-center px-1.5 py-0.5 border-b border-border bg-bg/30">
        <select
          value={selectedStatsCompetitionId === 'all' ? 'all' : String(selectedStatsCompetitionId)}
          onChange={(event) => {
            const value = event.target.value;
            setSelectedStatsCompetitionId(value === 'all' ? 'all' : Number(value));
          }}
          className="w-full h-6 bg-surface border border-border rounded px-1.5 text-[10px] text-center text-text-primary focus:outline-none focus:border-neon"
          style={{ textAlignLast: 'center' }}
          aria-label="Filtra statistiche per competizione"
        >
          <option value="all">Tutte</option>
          {statsCompetitionOptions.map((competition) => (
            <option key={competition.id} value={competition.id}>
              {competition.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex justify-center px-1.5 py-0.5 border-b border-border bg-bg/20">
        <select
          value={selectedStatsSectionId}
          onChange={(event) => {
            setSelectedStatsSectionId(event.target.value as TeamStatsSectionId);
          }}
          className="w-full h-6 bg-surface border border-border rounded px-1.5 text-[10px] text-center text-text-primary focus:outline-none focus:border-neon"
          style={{ textAlignLast: 'center' }}
          aria-label="Seleziona sezione statistica"
        >
          {TEAM_STATS_SECTIONS.map((section) => (
            <option key={section.id} value={section.id}>
              {section.label}
            </option>
          ))}
        </select>
      </div>

      <div className="overflow-x-auto">
        <div style={{ minWidth: `${STATS_TABLE_MIN_WIDTH}px` }}>
          <div className="grid border-b border-border bg-bg/20" style={{ gridTemplateColumns: STATS_TABLE_COLUMNS }}>
            <div className="px-1.5 py-1 text-[9px] font-semibold uppercase tracking-wide text-text-secondary">
              Giocatore
            </div>
            {[
              { key: 'total', label: 'Tot' },
              { key: 'perMatch', label: 'xP' },
              { key: 'per90', label: '/90' },
              { key: 'appearances', label: 'PG' },
              { key: 'minutes', label: 'Min' },
            ].map((column) => (
              <button
                key={column.key}
                onClick={() => setStatsSortKey(column.key as TeamStatsSortKey)}
                className={`px-1 py-1 text-[9px] font-semibold uppercase tracking-wide transition-colors ${
                  statsSortKey === column.key
                    ? 'bg-neon/12 text-neon'
                    : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary'
                }`}
              >
                {column.label}
              </button>
            ))}
          </div>

          <div style={{ maxHeight: `${tableBodyMaxHeight}px` }} className="overflow-y-auto overflow-x-hidden">
            {loadingTeamStats && teamStatsRows.length === 0 ? (
              <div className="flex h-14 items-center justify-center gap-2 text-[10px] text-text-muted">
                <div className="w-3 h-3 border border-neon border-t-transparent rounded-full animate-spin" />
                Caricamento...
              </div>
            ) : filteredStatsEvents.length === 0 ? (
              <div className="flex h-14 items-center justify-center px-3 text-center text-[10px] text-text-muted">
                {emptyStatsLabel}
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
                    onClick={() => handlePlayerClick(row.player)}
                    className="truncate px-1.5 text-left text-[10px] text-text-primary hover:text-neon"
                    title={row.player.name}
                  >
                    {row.player.shortName ?? row.player.name}
                  </button>
                  <div className="flex items-center justify-center px-1 text-[10px] tabular-nums text-text-primary">
                    {row.total}
                  </div>
                  <div className="flex items-center justify-center px-1 text-[10px] tabular-nums text-text-secondary">
                    {formatDecimalStat(row.perMatch)}
                  </div>
                  <div className="flex items-center justify-center px-1 text-[10px] tabular-nums text-text-secondary">
                    {formatDecimalStat(row.per90)}
                  </div>
                  <div className="flex items-center justify-center px-1 text-[10px] tabular-nums text-text-primary">
                    {row.appearances}
                  </div>
                  <div className="flex items-center justify-center px-1 text-[10px] tabular-nums text-text-secondary">
                    {row.minutes}
                  </div>
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
  );

  const rosterSection = (
    <RosaSection
      benchByPosition={benchByPosition}
      positionLabels={positionLabels}
      compactDensity={compactDensity}
      handlePlayerClick={handlePlayerClick}
    />
  );

  return (
    <div className={`w-full ${compactDensity ? 'team-view team-view--compact' : 'team-view'}`}>
      {/* Header squadra */}
      <div className={`flex items-center ${compactDensity ? 'gap-2.5 mb-3' : 'gap-3 mb-4'}`}>
        <img src={getTeamImageUrl(teamId)} alt="" className={compactDensity ? 'w-9 h-9 object-contain' : 'w-10 h-10 object-contain'} />
        <h2 className={`${compactDensity ? 'text-lg' : 'text-xl'} font-bold text-text-primary`}>{teamName || 'Squadra'}</h2>
      </div>

      {/* Prossima partita */}
      {nextEvent && opponent && (
        <div className={`text-text-secondary ${compactDensity ? 'mb-4 text-xs sm:text-sm' : 'mb-5 text-sm'}`}>
          <span>Prossima: </span>
          {isHome ? teamName : <button onClick={handleOpponentClick} className="text-neon hover:underline">{opponent.name}</button>}
          <span> vs </span>
          {isHome ? <button onClick={handleOpponentClick} className="text-neon hover:underline">{opponent.name}</button> : teamName}
          {nextEvent.tournament && <span> | {nextEvent.tournament.name}</span>}
          {roundLabel && <span> {roundLabel}</span>}
          {formation && (
            <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded bg-neon/15 text-neon text-xs font-medium">
              {formation}
            </span>
          )}
        </div>
      )}

      {/* Layout principale */}
      {layoutMode === 'landscape-right' ? (
        <>
          <div className="flex flex-row gap-5 items-start mb-5">
            {starters.length > 0 && formationPositions.length > 0 && (
              <div className="flex-shrink-0" style={fieldContainerStyle}>
                <div
                  className="relative bg-field-bg border border-field-lines rounded-lg overflow-hidden w-full"
                  style={{ aspectRatio: '105/68' }}
                >
                  <svg className="absolute inset-0 w-full h-full" viewBox="0 0 1050 680" preserveAspectRatio="none">
                    <rect x="10" y="10" width="1030" height="660" fill="none" stroke="#2a5535" strokeWidth="2" />
                    <line x1="525" y1="10" x2="525" y2="670" stroke="#2a5535" strokeWidth="2" />
                    <circle cx="525" cy="340" r="91.5" fill="none" stroke="#2a5535" strokeWidth="2" />
                    <rect x="10" y="138" width="165" height="404" fill="none" stroke="#2a5535" strokeWidth="2" />
                    <rect x="10" y="218" width="55" height="244" fill="none" stroke="#2a5535" strokeWidth="2" />
                    <rect x="875" y="138" width="165" height="404" fill="none" stroke="#2a5535" strokeWidth="2" />
                    <rect x="985" y="218" width="55" height="244" fill="none" stroke="#2a5535" strokeWidth="2" />
                  </svg>
                  {starters.map((lp, idx) => {
                    const pos = formationPositions[idx];
                    if (!pos) return null;
                    const playerPos = getPlayerPos(pos);
                    return (
                      <button
                        key={lp.player.id}
                        onClick={() => handlePlayerClick(lp.player)}
                        className="absolute flex flex-col items-center transform -translate-x-1/2 -translate-y-1/2 group"
                        style={playerPos}
                      >
                        <div className={`${compactDensity ? 'w-6 h-6 text-[10px]' : 'w-7 h-7 text-[11px]'} rounded-full bg-neon/80 flex items-center justify-center font-bold text-black group-hover:bg-neon transition-colors`}>
                          {lp.player.jerseyNumber ?? idx + 1}
                        </div>
                        <span className={`${compactDensity ? 'text-[8px] max-w-[46px]' : 'text-[9px] max-w-[52px]'} text-white mt-0.5 font-medium text-center leading-tight truncate`}>
                          {lp.player.shortName ?? lp.player.name.split(' ').pop()}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {matchesSection}
            {showStatsBesideMatches && statsSection}
          </div>
          {showStatsBesideRosa ? (
            <div className="flex flex-row gap-5 items-start">
              <div className="min-w-0 flex-1">
                {rosterSection}
              </div>
              {statsSection}
            </div>
          ) : (
            rosterSection
          )}
        </>
      ) : layoutMode === 'portrait-right' ? (
        <>
          <div className="flex flex-row gap-5 items-center justify-center mb-5">
            {starters.length > 0 && formationPositions.length > 0 && (
              <div className="flex-shrink-0" style={fieldContainerStyle}>
                <div
                  className="relative bg-field-bg border border-field-lines rounded-lg overflow-hidden w-full"
                  style={{ aspectRatio: '68/105' }}
                >
                  <svg className="absolute inset-0 w-full h-full" viewBox="0 0 680 1050" preserveAspectRatio="none">
                    <rect x="10" y="10" width="660" height="1030" fill="none" stroke="#2a5535" strokeWidth="2" />
                    <line x1="10" y1="525" x2="670" y2="525" stroke="#2a5535" strokeWidth="2" />
                    <circle cx="340" cy="525" r="91.5" fill="none" stroke="#2a5535" strokeWidth="2" />
                    <rect x="138" y="10" width="404" height="165" fill="none" stroke="#2a5535" strokeWidth="2" />
                    <rect x="218" y="10" width="244" height="55" fill="none" stroke="#2a5535" strokeWidth="2" />
                    <rect x="138" y="875" width="404" height="165" fill="none" stroke="#2a5535" strokeWidth="2" />
                    <rect x="218" y="985" width="244" height="55" fill="none" stroke="#2a5535" strokeWidth="2" />
                  </svg>
                  {starters.map((lp, idx) => {
                    const pos = formationPositions[idx];
                    if (!pos) return null;
                    const playerPos = getPlayerPos(pos);
                    return (
                      <button
                        key={lp.player.id}
                        onClick={() => handlePlayerClick(lp.player)}
                        className="absolute flex flex-col items-center transform -translate-x-1/2 -translate-y-1/2 group"
                        style={playerPos}
                      >
                        <div className={`${compactDensity ? 'w-6 h-6 text-[10px]' : 'w-7 h-7 text-[11px]'} rounded-full bg-neon/80 flex items-center justify-center font-bold text-black group-hover:bg-neon transition-colors`}>
                          {lp.player.jerseyNumber ?? idx + 1}
                        </div>
                        <span className={`${compactDensity ? 'text-[8px] max-w-[46px]' : 'text-[9px] max-w-[52px]'} text-white mt-0.5 font-medium text-center leading-tight truncate`}>
                          {lp.player.shortName ?? lp.player.name.split(' ').pop()}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {matchesSection}
            {showStatsBesideMatches && statsSection}
          </div>
          {showStatsBesideRosa ? (
            <div className="flex flex-row gap-5 items-start">
              <div className="min-w-0 flex-1">
                {rosterSection}
              </div>
              {statsSection}
            </div>
          ) : (
            rosterSection
          )}
        </>
      ) : (
        <>
          {starters.length > 0 && formationPositions.length > 0 && (
            <div className="mb-4 flex justify-center">
              <div style={fieldContainerStyle}>
                <div
                  className="relative bg-field-bg border border-field-lines rounded-lg overflow-hidden w-full"
                  style={{ aspectRatio: '105/68' }}
                >
                  <svg className="absolute inset-0 w-full h-full" viewBox="0 0 1050 680" preserveAspectRatio="none">
                    <rect x="10" y="10" width="1030" height="660" fill="none" stroke="#2a5535" strokeWidth="2" />
                    <line x1="525" y1="10" x2="525" y2="670" stroke="#2a5535" strokeWidth="2" />
                    <circle cx="525" cy="340" r="91.5" fill="none" stroke="#2a5535" strokeWidth="2" />
                    <rect x="10" y="138" width="165" height="404" fill="none" stroke="#2a5535" strokeWidth="2" />
                    <rect x="10" y="218" width="55" height="244" fill="none" stroke="#2a5535" strokeWidth="2" />
                    <rect x="875" y="138" width="165" height="404" fill="none" stroke="#2a5535" strokeWidth="2" />
                    <rect x="985" y="218" width="55" height="244" fill="none" stroke="#2a5535" strokeWidth="2" />
                  </svg>
                  {starters.map((lp, idx) => {
                    const pos = formationPositions[idx];
                    if (!pos) return null;
                    const playerPos = getPlayerPos(pos);
                    return (
                      <button
                        key={lp.player.id}
                        onClick={() => handlePlayerClick(lp.player)}
                        className="absolute flex flex-col items-center transform -translate-x-1/2 -translate-y-1/2 group"
                        style={playerPos}
                      >
                        <div className={`${compactDensity ? 'w-6 h-6 text-[10px]' : 'w-7 h-7 text-[11px]'} rounded-full bg-neon/80 flex items-center justify-center font-bold text-black group-hover:bg-neon transition-colors`}>
                          {lp.player.jerseyNumber ?? idx + 1}
                        </div>
                        <span className={`${compactDensity ? 'text-[8px] max-w-[46px]' : 'text-[9px] max-w-[52px]'} text-white mt-0.5 font-medium text-center leading-tight truncate`}>
                          {lp.player.shortName ?? lp.player.name.split(' ').pop()}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
          <div className="mb-4 flex justify-center gap-3">
            {matchesSection}
            {statsSection}
          </div>
          {rosterSection}
        </>
      )}
    </div>
  );
}

// Componente separato per la rosa per evitare duplicazione
interface RosaSectionProps {
  benchByPosition: Record<string, Player[]>;
  positionLabels: Record<string, string>;
  compactDensity: boolean;
  handlePlayerClick: (player: Player) => void;
}

function RosaSection({ benchByPosition, positionLabels, compactDensity, handlePlayerClick }: RosaSectionProps) {
  return (
    <div>
      <h3 className={`${compactDensity ? 'text-xs mb-2.5' : 'text-sm mb-3'} font-semibold text-text-secondary uppercase tracking-wide`}>
        Rosa completa
      </h3>
      {['G', 'D', 'M', 'F'].map((pos) => {
        const players = benchByPosition[pos];
        if (!players?.length) return null;
        return (
          <div key={pos} className="mb-3.5">
            <p className={`text-text-muted ${compactDensity ? 'text-[11px] mb-1.5' : 'text-xs mb-2'}`}>{positionLabels[pos]}</p>
            <div className="flex flex-wrap gap-1.5">
              {players.map((p) => {
                const parts = p.name.split(' ');
                const shortName = parts.length > 1 ? `${parts[0][0]}. ${parts.slice(1).join(' ')}` : p.name;
                return (
                  <button
                    key={p.id}
                    onClick={() => handlePlayerClick(p)}
                    className={`inline-flex items-center gap-1 rounded-full border border-border bg-surface text-text-primary hover:border-neon transition-colors ${
                      compactDensity ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs'
                    }`}
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
  );
}
