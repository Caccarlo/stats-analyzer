/* eslint-disable react-hooks/set-state-in-effect */
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { usePlayerData } from '@/hooks/usePlayerData';
import type { SelectedPeriod } from '@/hooks/usePlayerData';
import { useMatchTimeline } from '@/hooks/useMatchTimeline';
import { useSplitCardSync } from '@/hooks/useSplitCardSync';
import { useNavigation } from '@/context/NavigationContext';
import { getPlayerInfo, getPlayerNationalStats } from '@/api/sofascore';
import type { Player, PlayerFilterState, NationalTeamStat, Team } from '@/types';
import type { CachedMatchDetails } from '@/hooks/useMatchDetails';
import { getPlayerMatchIsHome } from '@/utils/playerMatchVenue';
import { getShotsCount, getShotsOnTargetCount } from '@/utils/playerStats';
import PlayerHeader from '@/components/player/PlayerHeader';
import PlayerFilters from '@/components/player/PlayerFilters';
import StatsOverview from '@/components/player/StatsOverview';
import MatchTimeline from '@/components/player/MatchTimeline';
import MatchCard from '@/components/player/MatchCard';
import { useViewport } from '@/hooks/useViewport';

const AUTO_SELECTED_MATCH_COUNT = 3;
const LAST_N_OPTIONS = [5, 10, 15, 20, 30, 50, 75] as const;

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

function getTeamIdentityKey(team: Team): string {
  if (team.nameCode) return `code:${team.nameCode.toLowerCase()}`;
  if (team.shortName) return `short:${team.shortName.toLowerCase()}`;
  return `name:${team.name.toLowerCase()}`;
}

function getCommittedCount(details: CachedMatchDetails | undefined): number | null {
  const value = details?.officialStats?.fouls;
  return typeof value === 'number' ? value : null;
}

function getSufferedCount(details: CachedMatchDetails | undefined): number | null {
  const value = details?.officialStats?.wasFouled;
  return typeof value === 'number' ? value : null;
}

function getShotsValue(details: CachedMatchDetails | undefined): number | null {
  return getShotsCount(details?.officialStats);
}

function getShotsOnTargetValue(details: CachedMatchDetails | undefined): number | null {
  return getShotsOnTargetCount(details?.officialStats);
}

// Wrapper for cross-panel card height sync (hooks can't be called in .map())
function SyncedCardSlot({
  panelIndex,
  cardIndex,
  isSplitView,
  details,
  className,
  children,
}: {
  panelIndex: number;
  cardIndex: number;
  isSplitView: boolean;
  details: CachedMatchDetails | undefined;
  className: string;
  children: React.ReactNode;
}) {
  const ref = useSplitCardSync(panelIndex, cardIndex, isSplitView, details ? 'loaded' : 'pending');
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}

interface PlayerPageProps {
  playerId: number;
  playerData?: Player;
  panelIndex?: number;
}

export default function PlayerPage({ playerId, playerData, panelIndex = 0 }: PlayerPageProps) {
  const { width, height } = useViewport();
  const { state, navigateTo, updatePanelFilters } = useNavigation();
  const [resolvedPlayer, setResolvedPlayer] = useState<Player | undefined>(playerData);
  const [nationalStats, setNationalStats] = useState<NationalTeamStat[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);
  const [panelWidth, setPanelWidth] = useState(0);
  const compactDensity = width < 640 || height < 820;
  const isSplitView = state.panels.length > 1;

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;

    const ro = new ResizeObserver((entries) => {
      setPanelWidth(entries[0].contentRect.width);
    });

    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    getPlayerInfo(playerId).then((info) => {
      if (cancelled || !info) return;
      setResolvedPlayer(info);
      const panel = state.panels[panelIndex];
      if (info.team && panel?.teamId !== info.team.id) {
        navigateTo(panelIndex, 'player', { teamId: info.team.id, teamName: info.team.name });
      }
    });
    return () => { cancelled = true; };
  }, [playerId]);

  useEffect(() => {
    let cancelled = false;
    getPlayerNationalStats(playerId).then((stats) => {
      if (cancelled) return;
      setNationalStats(stats);
    });
    return () => { cancelled = true; };
  }, [playerId]);

  const savedFilters = state.panels[panelIndex]?.filterState;
  const handleFiltersChange = useCallback(
    (fs: PlayerFilterState) => updatePanelFilters(panelIndex, fs),
    [panelIndex, updatePanelFilters],
  );

  const {
    tournamentSeasons,
    availableSeasonYears,
    selectedPeriod,
    setSelectedPeriod,
    currentSeasonYear,
    enabledTournaments,
    selectedTournaments,
    toggleTournament,
    showCommitted,
    setShowCommitted,
    showSuffered,
    setShowSuffered,
    showShots,
    setShowShots,
    showShotsOnTarget,
    setShowShotsOnTarget,
    showHome,
    setShowHome,
    showAway,
    setShowAway,
    showCards,
    setShowCards,
    committedLine,
    setCommittedLine,
    sufferedLine,
    setSufferedLine,
    shotsLine,
    setShotsLine,
    shotsOnTargetLine,
    setShotsOnTargetLine,
    showStartersOnly,
    setShowStartersOnly,
    ensureTournamentsEnabled,
    loading: playerDataLoading,
  } = usePlayerData(playerId, savedFilters, handleFiltersChange);

  // All tournaments available for the current season year (used in 'season' mode)
  const allTournamentsForSeason = tournamentSeasons
    .map((ts) => {
      const season = ts.seasons.find((s) => s.year === currentSeasonYear);
      if (!season) return null;
      return {
        tournamentId: ts.uniqueTournament.id,
        tournamentName: ts.uniqueTournament.name,
        seasonId: season.id,
        seasonName: season.name,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const shouldFallbackToRecentEvents = useMemo(
    () => selectedPeriod.type === 'season' && !playerDataLoading && availableSeasonYears.length === 0,
    [selectedPeriod.type, playerDataLoading, availableSeasonYears.length],
  );

  // Season IDs passed to useMatchTimeline:
  // 'last' mode → all season IDs across all years (caricamento fisso, indipendente dai filtri)
  // 'season' mode → only the current season year (existing behaviour)
  const validSeasonIds = useMemo(
    () => {
      if (shouldFallbackToRecentEvents) return null;
      if (selectedPeriod.type === 'season') {
        return new Set(allTournamentsForSeason.map((t) => t.seasonId));
      }
      return null;
    },
    [selectedPeriod.type, allTournamentsForSeason, shouldFallbackToRecentEvents],
  );

  const validTournamentIds = useMemo(
    () => {
      if (shouldFallbackToRecentEvents) return undefined;
      if (selectedPeriod.type !== 'season') return undefined;
      return new Set(allTournamentsForSeason.map((t) => t.tournamentId));
    },
    [selectedPeriod.type, allTournamentsForSeason, shouldFallbackToRecentEvents],
  );

  const validTournamentYearPairs = useMemo(
    () => {
      if (shouldFallbackToRecentEvents) return undefined;
      if (selectedPeriod.type !== 'season') return undefined;
      return new Set(
        allTournamentsForSeason.map((t) => `${t.tournamentId}:${currentSeasonYear}`),
      );
    },
    [selectedPeriod.type, allTournamentsForSeason, currentSeasonYear, shouldFallbackToRecentEvents],
  );

  const seasonDateRange = useMemo(
    () => {
      if (shouldFallbackToRecentEvents) return null;
      if (selectedPeriod.type !== 'season') return null;
      return parseSeasonDateRange(currentSeasonYear);
    },
    [selectedPeriod.type, currentSeasonYear, shouldFallbackToRecentEvents],
  );

  const maxEvents = selectedPeriod.type === 'last' ? selectedPeriod.count * 2 : undefined;
  const minPlayedEvents = selectedPeriod.type === 'last' ? selectedPeriod.count : undefined;

  const {
    allEvents,
    detailsMap,
    eventDurationMetadataMap,
    detailsLoadedIds,
    loadingEvents,
    allOfficialStatsLoaded,
    allLineupsLoaded,
    requestRichDetails,
  } = useMatchTimeline(
    playerId,
    validSeasonIds,
    validTournamentIds,
    validTournamentYearPairs,
    seasonDateRange,
    maxEvents,
    minPlayedEvents,
  );

  const playedEvents = useMemo(
    () => (
      [...allEvents]
        .sort((a, b) => b.startTimestamp - a.startTimestamp)
        .filter((event) => {
          const details = detailsMap.get(event.id);
          if (!details) return false;
          return !details.didNotPlay;
        })
    ),
    [allEvents, detailsMap],
  );

  const lastPeriodBaseEvents = useMemo(() => {
    if (selectedPeriod.type !== 'last') return [];
    return playedEvents.slice(0, selectedPeriod.count);
  }, [selectedPeriod, playedEvents]);

  const seasonClubMap = useMemo(() => {
    const seasonsToTeams = new Map<string, Team[]>();
    const sortedEvents = [...allEvents].sort((a, b) => a.startTimestamp - b.startTimestamp);

    for (const event of sortedEvents) {
      const year = event.season?.year;
      if (!year) continue;

      const playerSide = detailsMap.get(event.id)?.playerSide;
      const playerTeam =
        playerSide === 'home'
          ? event.homeTeam
          : playerSide === 'away'
            ? event.awayTeam
            : undefined;

      if (!playerTeam || playerTeam.national) continue;

      const seasonTeams = seasonsToTeams.get(year) ?? [];
      const playerTeamKey = getTeamIdentityKey(playerTeam);
      if (!seasonTeams.some((team) => getTeamIdentityKey(team) === playerTeamKey)) {
        seasonTeams.push(playerTeam);
      }
      seasonsToTeams.set(year, seasonTeams.slice(0, 2));
    }

    return seasonsToTeams;
  }, [allEvents, detailsMap]);

  const lastNClubMap = useMemo(() => {
    const periodsToTeams = new Map<number, Team[]>();

    for (const n of LAST_N_OPTIONS) {
      const teams: Team[] = [];
      const seen = new Set<string>();

      for (const event of playedEvents.slice(0, n)) {
        const playerSide = detailsMap.get(event.id)?.playerSide;
        const playerTeam =
          playerSide === 'home'
            ? event.homeTeam
            : playerSide === 'away'
              ? event.awayTeam
              : undefined;

        if (!playerTeam || playerTeam.national) continue;

        const teamKey = getTeamIdentityKey(playerTeam);
        if (seen.has(teamKey)) continue;

        seen.add(teamKey);
        teams.push(playerTeam);

        if (teams.length === 2) break;
      }

      periodsToTeams.set(n, teams);
    }

    return periodsToTeams;
  }, [playedEvents, detailsMap]);

  // Tournament list for the filter UI:
  // 'last' mode → unique tournaments extracted from the current last-N valid matches
  // 'season' mode → allTournamentsForSeason + extra tournaments from loaded events (e.g. friendlies)
  const tournamentsForFilter = useMemo(() => {
    const source = selectedPeriod.type === 'season' ? playedEvents : lastPeriodBaseEvents;
    const seen = new Set<number>();
    const result: typeof allTournamentsForSeason = [];

    if (selectedPeriod.type === 'season') {
      const sourceTournamentIds = new Set(
        source
          .map((event) => event.tournament?.uniqueTournament?.id)
          .filter((value): value is number => typeof value === 'number'),
      );

      for (const t of allTournamentsForSeason) {
        if (!sourceTournamentIds.has(t.tournamentId)) continue;
        seen.add(t.tournamentId);
        result.push(t);
      }
    }

    for (const event of source) {
      const tid = event.tournament?.uniqueTournament?.id;
      const tname = event.tournament?.uniqueTournament?.name;
      if (tid && tname && !seen.has(tid)) {
        seen.add(tid);
        result.push({
          tournamentId: tid,
          tournamentName: tname,
          seasonId: event.season?.id ?? 0,
          seasonName: event.season?.name ?? '',
        });
      }
    }
    return result;
  }, [selectedPeriod.type, allTournamentsForSeason, playedEvents, lastPeriodBaseEvents]);

  // Auto-enable newly discovered tournaments (friendlies, etc.) — only once per ID.
  // Reset tracking when player or period changes (usePlayerData already resets enabledTournaments).
  const knownFilterTournaments = useRef(new Set<number>());
  const prevContextKey = useRef('');
  useEffect(() => {
    const contextKey = `${playerId}|${selectedPeriod.type}|${selectedPeriod.type === 'season' ? currentSeasonYear : selectedPeriod.count}`;
    if (contextKey !== prevContextKey.current) {
      knownFilterTournaments.current = new Set<number>();
      prevContextKey.current = contextKey;
    }
    if (tournamentsForFilter.length === 0) return;
    const newIds = new Set<number>();
    for (const t of tournamentsForFilter) {
      if (!knownFilterTournaments.current.has(t.tournamentId)) {
        knownFilterTournaments.current.add(t.tournamentId);
        newIds.add(t.tournamentId);
      }
    }
    if (newIds.size > 0) ensureTournamentsEnabled(newIds);
  }, [tournamentsForFilter, ensureTournamentsEnabled, playerId, selectedPeriod, currentSeasonYear]);

  // Tournaments currently enabled (subset of tournamentsForFilter)
  const activeFilterTournaments = useMemo(
    () => tournamentsForFilter.filter((t) => enabledTournaments.has(t.tournamentId)),
    [tournamentsForFilter, enabledTournaments],
  );

  const selectedTournamentIds = useMemo(
    () => new Set(activeFilterTournaments.map((t) => t.tournamentId)),
    [activeFilterTournaments],
  );

  const emptyStateMessage = useMemo(() => {
    if (tournamentsForFilter.length === 0) {
      return 'Nessun dato disponibile per questo giocatore.';
    }
    return 'Nessuna partita trovata con i filtri correnti.';
  }, [tournamentsForFilter.length]);

  // ── Display events: all filters applied on top of allEvents ──
  // This is pure derivation — changing any filter never touches the background loader.
  const displayEvents = useMemo(() => {
    let events: typeof allEvents;

    if (selectedPeriod.type === 'last') {
      // 'last N': prima escludi didNotPlay, poi slice a N, poi filtri display su quelle N
      events = lastPeriodBaseEvents;
    } else {
      // 'season': tournament filter prima, poi didNotPlay exclusion
      events = selectedTournamentIds.size === 0
        ? allEvents
        : allEvents.filter((e) => selectedTournamentIds.has(e.tournament?.uniqueTournament?.id));

      events = events.filter((e) => {
        const details = detailsMap.get(e.id);
        if (!details) return false;
        return !details.didNotPlay;
      });
    }

    // Tournament filter (in 'last' mode: su quelle N partite; in 'season' mode: già applicato)
    if (selectedPeriod.type === 'last' && selectedTournamentIds.size > 0) {
      events = events.filter((e) => selectedTournamentIds.has(e.tournament?.uniqueTournament?.id));
    }

    // 4. Venue filter
    if (!showHome || !showAway) {
      events = events.filter((e) => {
        const isHome = getPlayerMatchIsHome(e, detailsMap.get(e.id), resolvedPlayer?.team?.id);
        if (isHome === null) return true; // includi finché non abbiamo certezza
        if (showHome && isHome) return true;
        if (showAway && !isHome) return true;
        return false;
      });
    }

    // 5. Starter filter — applicato solo quando tutte le lineups sono caricate
    if (showStartersOnly) {
      if (!allLineupsLoaded) return []; // non filtrare parzialmente
      events = events.filter((e) => {
        const details = detailsMap.get(e.id);
        if (!details) return false;
        if (details.lineupsStatus === 'loaded') return !details.didNotPlay && details.isStarter === true;
        // lineup unavailable/error: includi solo se officialStats conferma minuti > 0
        return (details.officialStats?.minutesPlayed ?? 0) > 0;
      });
    }

    return events;
  }, [allEvents, selectedTournamentIds, selectedPeriod, lastPeriodBaseEvents, detailsMap, showHome, showAway, resolvedPlayer?.team?.id, showStartersOnly, allLineupsLoaded]);

  // ── Selection state (moved here from useMatchTimeline) ──
  type SelectionDefault = 'auto' | 'all' | 'none';

  const [selectionDefault, setSelectionDefault] = useState<SelectionDefault>('auto');
  const [selectionOverrides, setSelectionOverrides] = useState<Map<number, boolean>>(new Map());

  const selectionContextKey = useMemo(() => {
    const seasonKey = validSeasonIds === null ? '*' : [...validSeasonIds].sort().join(',');
    const periodKey =
      selectedPeriod.type === 'last'
        ? `last:${selectedPeriod.count}`
        : `season:${selectedPeriod.year}`;
    return `${playerId}-${seasonKey}-${periodKey}`;
  }, [playerId, validSeasonIds, selectedPeriod]);

  useEffect(() => {
    setSelectionDefault('auto');
    setSelectionOverrides(new Map());
  }, [selectionContextKey]);

  const autoSelectedIds = useMemo(() => {
    return new Set(displayEvents.slice(0, AUTO_SELECTED_MATCH_COUNT).map((event) => event.id));
  }, [displayEvents]);

  const selectedEventIds = useMemo(() => {
    const next =
      selectionDefault === 'all'
        ? new Set(displayEvents.map((event) => event.id))
        : selectionDefault === 'none'
          ? new Set<number>()
          : new Set(autoSelectedIds);

    displayEvents.forEach((event) => {
      const override = selectionOverrides.get(event.id);
      if (override === true) next.add(event.id);
      if (override === false) next.delete(event.id);
    });

    return next;
  }, [displayEvents, selectionDefault, selectionOverrides, autoSelectedIds]);

  const isSelectedByDefault = useCallback((eventId: number) => {
    if (selectionDefault === 'all') return true;
    if (selectionDefault === 'none') return false;
    return autoSelectedIds.has(eventId);
  }, [selectionDefault, autoSelectedIds]);

  const toggleMatch = useCallback((eventId: number) => {
    setSelectionOverrides((prev) => {
      const next = new Map(prev);
      const nextSelected = !selectedEventIds.has(eventId);
      const defaultSelected = isSelectedByDefault(eventId);

      if (nextSelected === defaultSelected) {
        next.delete(eventId);
      } else {
        next.set(eventId, nextSelected);
      }

      return next;
    });
  }, [selectedEventIds, isSelectedByDefault]);

  const deselectMatch = useCallback((eventId: number) => {
    setSelectionOverrides((prev) => {
      const next = new Map(prev);
      const defaultSelected = isSelectedByDefault(eventId);

      if (defaultSelected) {
        next.set(eventId, false);
      } else {
        next.delete(eventId);
      }

      return next;
    });
  }, [isSelectedByDefault]);

  const selectAll = useCallback(() => {
    setSelectionDefault('all');
    setSelectionOverrides(new Map());
  }, []);

  const deselectAll = useCallback(() => {
    setSelectionDefault('none');
    setSelectionOverrides(new Map());
  }, []);

  // ── Derived stats from displayEvents ──
  const derivedStats = useMemo(() => {
    const played = displayEvents
      .map((e) => ({ event: e, details: detailsMap.get(e.id) }))
      .filter((entry) => entry.details?.officialStatsStatus === 'loaded') as Array<{
        event: (typeof displayEvents)[number];
        details: CachedMatchDetails;
      }>;
    if (played.length === 0) return null;

    let totalCommitted = 0;
    let totalSuffered = 0;
    let totalMinutes = 0;
    let totalYellow = 0;
    let totalRed = 0;
    let totalShots = 0;
    let totalShotsOnTarget = 0;
    let committedOver = 0;
    let sufferedOver = 0;
    let shotsOver = 0;
    let shotsOnTargetOver = 0;

    for (const { details: d } of played) {
      const committed = getCommittedCount(d) ?? 0;
      const suffered = getSufferedCount(d) ?? 0;
      const shots = getShotsValue(d) ?? 0;
      const shotsOnTarget = getShotsOnTargetValue(d) ?? 0;
      totalCommitted += committed;
      totalSuffered += suffered;
      totalShots += shots;
      totalShotsOnTarget += shotsOnTarget;

      if (d.cardInfo?.type === 'yellow') totalYellow++;
      else if (d.cardInfo?.type === 'red') totalRed++;
      else if (d.cardInfo?.type === 'yellowRed') { totalYellow++; totalRed++; }

      if (committed > committedLine) committedOver++;
      if (suffered > sufferedLine) sufferedOver++;
      if (shots > shotsLine) shotsOver++;
      if (shotsOnTarget > shotsOnTargetLine) shotsOnTargetOver++;

      totalMinutes += d.officialStats?.minutesPlayed ?? 0;
    }

    const appearances = played.length;
    return {
        stats: {
          totalFoulsCommitted: totalCommitted,
          totalFoulsSuffered: totalSuffered,
          totalShots,
          totalShotsOnTarget,
          totalMinutesPlayed: totalMinutes,
          totalAppearances: appearances,
          avgFoulsCommittedPerMatch: appearances > 0 ? (totalCommitted / appearances).toFixed(2) : '—',
          avgFoulsCommittedPer90: totalMinutes > 0 ? (totalCommitted * 90 / totalMinutes).toFixed(2) : '—',
          avgFoulsSufferedPerMatch: appearances > 0 ? (totalSuffered / appearances).toFixed(2) : '—',
          avgFoulsSufferedPer90: totalMinutes > 0 ? (totalSuffered * 90 / totalMinutes).toFixed(2) : '—',
          avgShotsPerMatch: appearances > 0 ? (totalShots / appearances).toFixed(2) : '—',
          avgShotsPer90: totalMinutes > 0 ? (totalShots * 90 / totalMinutes).toFixed(2) : '—',
          avgShotsOnTargetPerMatch: appearances > 0 ? (totalShotsOnTarget / appearances).toFixed(2) : '—',
          avgShotsOnTargetPer90: totalMinutes > 0 ? (totalShotsOnTarget * 90 / totalMinutes).toFixed(2) : '—',
          totalYellowCards: totalYellow,
          totalRedCards: totalRed,
          avgYellowCardsPerMatch: appearances > 0 ? (totalYellow / appearances).toFixed(2) : '—',
          avgRedCardsPerMatch: appearances > 0 ? (totalRed / appearances).toFixed(2) : '—',
        },
        committedHitRate: { over: committedOver, total: appearances },
        sufferedHitRate: { over: sufferedOver, total: appearances },
        shotsHitRate: { over: shotsOver, total: appearances },
        shotsOnTargetHitRate: { over: shotsOnTargetOver, total: appearances },
      };
  }, [displayEvents, detailsMap, committedLine, sufferedLine, shotsLine, shotsOnTargetLine]);

  // Events shown as MatchCards
  const selectedEvents = useMemo(
    () => displayEvents.filter((e) => selectedEventIds.has(e.id)),
    [displayEvents, selectedEventIds],
  );

  const cardCount = selectedEvents.length;
  const cardMinWidth = panelWidth > 0 && panelWidth < 760
    ? 276
    : isSplitView
      ? 292
      : compactDensity
        ? 284
        : 312;

  const toggleMode: 'select' | 'deselect' =
    displayEvents.length > 0 && selectedEventIds.size === displayEvents.length
      ? 'deselect'
      : 'select';

  const handleToggleAll = useCallback(() => {
    if (toggleMode === 'select') {
      selectAll();
    } else {
      deselectAll();
    }
  }, [toggleMode, selectAll, deselectAll]);

  const handlePeriodChange = useCallback((period: SelectedPeriod) => {
    setSelectedPeriod(period);
    setShowHome(true);
    setShowAway(true);
    setShowStartersOnly(false);
    setShowCommitted(true);
    setShowSuffered(true);
    setShowShots(true);
    setShowShotsOnTarget(false);
    setShowCards(false);
  }, [setSelectedPeriod, setShowHome, setShowAway, setShowStartersOnly, setShowCommitted, setShowSuffered, setShowShots, setShowShotsOnTarget, setShowCards]);

  // ── Full-page loader: only on the very first visit (never on filter/season changes) ──
  const waitingForSeasonContext =
    selectedPeriod.type === 'season' &&
    availableSeasonYears.length === 0 &&
    playerDataLoading;

  const pageSectionLoading =
    waitingForSeasonContext ||
    loadingEvents ||
    !allOfficialStatsLoaded ||
    !allLineupsLoaded;

  // ── Stato di caricamento per filtro Titolare ──
  const displayPlayer: Player = resolvedPlayer ?? {
    id: playerId,
    name: `Giocatore #${playerId}`,
    slug: '',
    position: '',
  };

  return (
    <div ref={rootRef} className={`min-w-0 ${compactDensity ? 'player-page player-page--compact' : 'player-page'}`}>
      {/* Header */}
      <div className="pb-4 border-b border-border">
        <PlayerHeader player={displayPlayer} nationalStats={nationalStats} compact={compactDensity} />
      </div>

      {/* Filtri */}
      {availableSeasonYears.length > 0 && (
        <div className="mt-4 pb-4 border-b border-border">
          <PlayerFilters
            tournamentSeasons={tournamentSeasons}
            availableSeasonYears={availableSeasonYears}
            selectedPeriod={selectedPeriod}
            seasonClubMap={seasonClubMap}
            lastNClubMap={lastNClubMap}
            onPeriodChange={handlePeriodChange}
            selectedTournaments={activeFilterTournaments}
            onToggleTournament={toggleTournament}
            showCommitted={showCommitted}
            onShowCommittedChange={setShowCommitted}
            showSuffered={showSuffered}
            onShowSufferedChange={setShowSuffered}
            showShots={showShots}
            onShowShotsChange={setShowShots}
            showShotsOnTarget={showShotsOnTarget}
            onShowShotsOnTargetChange={setShowShotsOnTarget}
            showCards={showCards}
            onShowCardsChange={setShowCards}
            showHome={showHome}
            onShowHomeChange={setShowHome}
            showAway={showAway}
            onShowAwayChange={setShowAway}
            allTournamentsForSeason={tournamentsForFilter}
            committedLine={committedLine}
            onCommittedLineChange={setCommittedLine}
            sufferedLine={sufferedLine}
            onSufferedLineChange={setSufferedLine}
            shotsLine={shotsLine}
            onShotsLineChange={setShotsLine}
            shotsOnTargetLine={shotsOnTargetLine}
            onShotsOnTargetLineChange={setShotsOnTargetLine}
            showStartersOnly={showStartersOnly}
            onShowStartersOnlyChange={setShowStartersOnly}
            startersFilterEnabled={allLineupsLoaded}
            isSplitView={isSplitView}
            compact={compactDensity}
            panelWidth={panelWidth}
          />
        </div>
      )}

      <div className={compactDensity ? 'mt-6' : 'mt-8'}>
        {pageSectionLoading ? (
          <div className="flex items-center gap-2 text-text-muted">
            <div className="w-4 h-4 border-2 border-neon border-t-transparent rounded-full animate-spin" />
            Caricamento dati giocatore...
          </div>
        ) : displayEvents.length === 0 ? (
          <p className="mt-8 text-sm text-text-muted">
            {emptyStateMessage}
          </p>
        ) : (
          <>
            {derivedStats && (
              <div className="mt-6">
                <StatsOverview
                  stats={derivedStats.stats}
                  showCommitted={showCommitted}
                  showSuffered={showSuffered}
                  showShots={showShots}
                  showShotsOnTarget={showShotsOnTarget}
                  showCards={showCards}
                  committedLine={committedLine}
                  sufferedLine={sufferedLine}
                  shotsLine={shotsLine}
                  shotsOnTargetLine={shotsOnTargetLine}
                  committedHitRate={derivedStats.committedHitRate}
                  sufferedHitRate={derivedStats.sufferedHitRate}
                  shotsHitRate={derivedStats.shotsHitRate}
                  shotsOnTargetHitRate={derivedStats.shotsOnTargetHitRate}
                  compact={compactDensity}
                />
              </div>
            )}

            <div className={compactDensity ? 'mt-6' : 'mt-8'}>
              <MatchTimeline
                events={displayEvents}
                selectedEventIds={selectedEventIds}
                detailsMap={detailsMap}
                eventDurationMetadataMap={eventDurationMetadataMap}
                detailsLoadedIds={detailsLoadedIds}
                showCommitted={showCommitted}
                showSuffered={showSuffered}
                showShots={showShots}
                showShotsOnTarget={showShotsOnTarget}
                onToggleMatch={toggleMatch}
                toggleMode={toggleMode}
                onToggleAll={handleToggleAll}
                playerTeamId={resolvedPlayer?.team?.id}
                compact={compactDensity}
              />

              {selectedEvents.length > 0 && (
                <div
                  className={`grid items-stretch ${compactDensity ? 'gap-2.5 mt-5' : 'gap-3 mt-6'}`}
                  style={{ gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${cardMinWidth}px), 1fr))` }}
                >
                  {selectedEvents.map((event, index) => (
                    <SyncedCardSlot
                      key={event.id}
                      panelIndex={panelIndex}
                      cardIndex={index}
                      isSplitView={isSplitView}
                      details={detailsMap.get(event.id)}
                      className="flex"
                    >
                      <MatchCard
                        event={event}
                        playerId={playerId}
                        playerTeamId={resolvedPlayer?.team?.id}
                        eventDurationMetadata={eventDurationMetadataMap.get(event.id)}
                        showCommitted={showCommitted}
                        showSuffered={showSuffered}
                        showShots={showShots}
                        showShotsOnTarget={showShotsOnTarget}
                        panelIndex={panelIndex}
                        detailsMap={detailsMap}
                        selectedTournaments={selectedTournaments}
                        onDeselect={deselectMatch}
                        cardCount={cardCount}
                        onRequestRichDetails={requestRichDetails}
                        compact={compactDensity}
                      />
                    </SyncedCardSlot>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
