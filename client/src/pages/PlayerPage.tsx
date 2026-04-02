import { useState, useEffect, useMemo, useCallback } from 'react';
import { usePlayerData } from '@/hooks/usePlayerData';
import type { SelectedPeriod } from '@/hooks/usePlayerData';
import { useMatchTimeline } from '@/hooks/useMatchTimeline';
import { useSplitCardSync } from '@/hooks/useSplitCardSync';
import { useNavigation } from '@/context/NavigationContext';
import { getPlayerInfo, getPlayerNationalStats } from '@/api/sofascore';
import type { Player, PlayerFilterState, NationalTeamStat, Team } from '@/types';
import type { CachedMatchDetails } from '@/hooks/useMatchDetails';
import PlayerHeader from '@/components/player/PlayerHeader';
import PlayerFilters from '@/components/player/PlayerFilters';
import StatsOverview from '@/components/player/StatsOverview';
import MatchTimeline from '@/components/player/MatchTimeline';
import MatchCard from '@/components/player/MatchCard';

const AUTO_SELECTED_MATCH_COUNT = 3;

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
  const { state, navigateTo, updatePanelFilters } = useNavigation();
  const [resolvedPlayer, setResolvedPlayer] = useState<Player | undefined>(playerData);
  const [nationalStats, setNationalStats] = useState<NationalTeamStat[]>([]);

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
    showStartersOnly,
    setShowStartersOnly,
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

  // Season IDs passed to useMatchTimeline:
  // 'last' mode → all season IDs across all years (caricamento fisso, indipendente dai filtri)
  // 'season' mode → only the current season year (existing behaviour)
  const validSeasonIds = useMemo(
    () => {
      if (selectedPeriod.type === 'season') {
        return new Set(allTournamentsForSeason.map((t) => t.seasonId));
      }
      return new Set(tournamentSeasons.flatMap((ts) => ts.seasons.map((s) => s.id)));
    },
    [selectedPeriod.type, allTournamentsForSeason, tournamentSeasons],
  );

  const maxEvents = selectedPeriod.type === 'last' ? selectedPeriod.count * 2 : undefined;
  const minPlayedEvents = selectedPeriod.type === 'last' ? selectedPeriod.count : undefined;

  const {
    allEvents,
    detailsMap,
    detailsLoadedIds,
    loadingEvents,
    allOfficialStatsLoaded,
    allLineupsLoaded,
    recentRichLoaded,
    requestRichDetails,
  } = useMatchTimeline(playerId, validSeasonIds, maxEvents, minPlayedEvents);

  const lastPeriodBaseEvents = useMemo(() => {
    if (selectedPeriod.type !== 'last') return [];

    return allEvents
      .filter((e) => {
        const details = detailsMap.get(e.id);
        if (!details) return true;
        return !details.didNotPlay;
      })
      .slice(0, selectedPeriod.count);
  }, [selectedPeriod, allEvents, detailsMap]);

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

  // Tournament list for the filter UI:
  // 'last' mode → unique tournaments extracted from the current last-N valid matches
  // 'season' mode → same as allTournamentsForSeason
  const tournamentsForFilter = useMemo(() => {
    if (selectedPeriod.type === 'season') return allTournamentsForSeason;
    const seen = new Set<number>();
    const result: typeof allTournamentsForSeason = [];
    for (const event of lastPeriodBaseEvents) {
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
  }, [selectedPeriod.type, allTournamentsForSeason, lastPeriodBaseEvents]);

  // Tournaments currently enabled (subset of tournamentsForFilter)
  const activeFilterTournaments = useMemo(
    () => tournamentsForFilter.filter((t) => enabledTournaments.has(t.tournamentId)),
    [tournamentsForFilter, enabledTournaments],
  );

  const selectedTournamentIds = useMemo(
    () => new Set(activeFilterTournaments.map((t) => t.tournamentId)),
    [activeFilterTournaments],
  );

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
        if (!details) return true;
        return !details.didNotPlay;
      });
    }

    // Tournament filter (in 'last' mode: su quelle N partite; in 'season' mode: già applicato)
    if (selectedPeriod.type === 'last' && selectedTournamentIds.size > 0) {
      events = events.filter((e) => selectedTournamentIds.has(e.tournament?.uniqueTournament?.id));
    }

    // 4. Venue filter
    if (!showHome || !showAway) {
      const teamId = resolvedPlayer?.team?.id;
      events = events.filter((e) => {
        // Primo: usa playerSide dalle lineup (affidabile anche per le nazionali)
        const side = detailsMap.get(e.id)?.playerSide;
        let isHome: boolean | null;
        if (side !== undefined) {
          isHome = side === 'home';
        } else if (teamId) {
          // Fallback: confronto per team ID (funziona per i club, non per le nazionali)
          if (e.homeTeam.id === teamId) isHome = true;
          else if (e.awayTeam.id === teamId) isHome = false;
          else isHome = null; // lineups non ancora caricate e team non riconosciuto
        } else {
          isHome = null;
        }
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
    const seasonKey = [...validSeasonIds].sort().join(',');
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
    const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
    const count = isMobile ? 1 : AUTO_SELECTED_MATCH_COUNT;
    return new Set(displayEvents.slice(0, count).map((event) => event.id));
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
    let committedOver = 0;
    let sufferedOver = 0;

    for (const { details: d } of played) {
      const committed = getCommittedCount(d) ?? 0;
      const suffered = getSufferedCount(d) ?? 0;
      totalCommitted += committed;
      totalSuffered += suffered;

      if (d.cardInfo?.type === 'yellow') totalYellow++;
      else if (d.cardInfo?.type === 'red') totalRed++;
      else if (d.cardInfo?.type === 'yellowRed') { totalYellow++; totalRed++; }

      if (committed > committedLine) committedOver++;
      if (suffered > sufferedLine) sufferedOver++;

      totalMinutes += d.officialStats?.minutesPlayed ?? 0;
    }

    const appearances = played.length;
    return {
      stats: {
        totalFoulsCommitted: totalCommitted,
        totalFoulsSuffered: totalSuffered,
        totalMinutesPlayed: totalMinutes,
        totalAppearances: appearances,
        avgFoulsCommittedPerMatch: appearances > 0 ? (totalCommitted / appearances).toFixed(2) : '—',
        avgFoulsCommittedPer90: totalMinutes > 0 ? (totalCommitted * 90 / totalMinutes).toFixed(2) : '—',
        avgFoulsSufferedPerMatch: appearances > 0 ? (totalSuffered / appearances).toFixed(2) : '—',
        avgFoulsSufferedPer90: totalMinutes > 0 ? (totalSuffered * 90 / totalMinutes).toFixed(2) : '—',
        totalYellowCards: totalYellow,
        totalRedCards: totalRed,
        avgYellowCardsPerMatch: appearances > 0 ? (totalYellow / appearances).toFixed(2) : '—',
        avgRedCardsPerMatch: appearances > 0 ? (totalRed / appearances).toFixed(2) : '—',
      },
      committedHitRate: { over: committedOver, total: appearances },
      sufferedHitRate: { over: sufferedOver, total: appearances },
    };
  }, [displayEvents, detailsMap, committedLine, sufferedLine]);

  // Events shown as MatchCards
  const selectedEvents = useMemo(
    () => displayEvents.filter((e) => selectedEventIds.has(e.id)),
    [displayEvents, selectedEventIds],
  );

  const isSplitView = state.panels.length > 1;
  const cardCount = selectedEvents.length;
  const cardWidthClass = isSplitView
    ? 'w-full'
    : cardCount === 1
      ? 'w-full'
      : cardCount === 2
        ? 'w-full md:w-[calc(50%-4px)]'
        : 'w-full md:w-[calc(33.333%-6px)]';

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
    setShowCards(false);
  }, [setSelectedPeriod, setShowHome, setShowAway, setShowStartersOnly, setShowCommitted, setShowSuffered, setShowCards]);

  // ── Full-page loader: only on the very first visit (never on filter/season changes) ──
  const pageSectionLoading =
    loadingEvents ||
    !allOfficialStatsLoaded ||
    !allLineupsLoaded ||
    !recentRichLoaded;

  // ── Stato di caricamento per filtro Titolare ──
  const displayPlayer: Player = resolvedPlayer ?? {
    id: playerId,
    name: `Giocatore #${playerId}`,
    slug: '',
    position: '',
  };

  return (
    <div className="min-w-0">
      {/* Header */}
      <div className="pb-4 border-b border-border">
        <PlayerHeader player={displayPlayer} nationalStats={nationalStats} />
      </div>

      {/* Filtri */}
      {availableSeasonYears.length > 0 && (
        <div className="mt-4 pb-4 border-b border-border">
          <PlayerFilters
            tournamentSeasons={tournamentSeasons}
            availableSeasonYears={availableSeasonYears}
            selectedPeriod={selectedPeriod}
            seasonClubMap={seasonClubMap}
            onPeriodChange={handlePeriodChange}
            selectedTournaments={activeFilterTournaments}
            onToggleTournament={toggleTournament}
            showCommitted={showCommitted}
            onShowCommittedChange={setShowCommitted}
            showSuffered={showSuffered}
            onShowSufferedChange={setShowSuffered}
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
            showStartersOnly={showStartersOnly}
            onShowStartersOnlyChange={setShowStartersOnly}
            startersFilterEnabled={allLineupsLoaded}
            isSplitView={isSplitView}
          />
        </div>
      )}

      <div className="mt-8">
        {pageSectionLoading ? (
          <div className="flex items-center gap-2 text-text-muted">
            <div className="w-4 h-4 border-2 border-neon border-t-transparent rounded-full animate-spin" />
            Caricamento dati giocatore...
          </div>
        ) : (
          <>
            {derivedStats && (
              <div className="mt-6">
                <StatsOverview
                  stats={derivedStats.stats}
                  showCommitted={showCommitted}
                  showSuffered={showSuffered}
                  showCards={showCards}
                  committedLine={committedLine}
                  sufferedLine={sufferedLine}
                  committedHitRate={derivedStats.committedHitRate}
                  sufferedHitRate={derivedStats.sufferedHitRate}
                />
              </div>
            )}

            <div className="mt-8">
              <MatchTimeline
                events={displayEvents}
                selectedEventIds={selectedEventIds}
                detailsMap={detailsMap}
                detailsLoadedIds={detailsLoadedIds}
                showCommitted={showCommitted}
                showSuffered={showSuffered}
                onToggleMatch={toggleMatch}
                toggleMode={toggleMode}
                onToggleAll={handleToggleAll}
              />

              {selectedEvents.length > 0 && (
                <div className="flex flex-wrap items-stretch gap-2 mt-6">
                  {selectedEvents.map((event, index) => (
                    <SyncedCardSlot
                      key={event.id}
                      panelIndex={panelIndex}
                      cardIndex={index}
                      isSplitView={isSplitView}
                      details={detailsMap.get(event.id)}
                      className={`${cardWidthClass} flex`}
                    >
                      <MatchCard
                        event={event}
                        playerId={playerId}
                        playerTeamId={resolvedPlayer?.team?.id}
                        showCommitted={showCommitted}
                        showSuffered={showSuffered}
                        panelIndex={panelIndex}
                        detailsMap={detailsMap}
                        selectedTournaments={selectedTournaments}
                        onDeselect={deselectMatch}
                        cardCount={cardCount}
                        onRequestRichDetails={requestRichDetails}
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
