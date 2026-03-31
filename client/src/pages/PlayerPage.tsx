import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { usePlayerData } from '@/hooks/usePlayerData';
import { useMatchTimeline } from '@/hooks/useMatchTimeline';
import { useSplitCardSync } from '@/hooks/useSplitCardSync';
import { useNavigation } from '@/context/NavigationContext';
import { getPlayerInfo } from '@/api/sofascore';
import type { Player } from '@/types';
import type { CachedMatchDetails } from '@/hooks/useMatchDetails';
import PlayerHeader from '@/components/player/PlayerHeader';
import PlayerFilters from '@/components/player/PlayerFilters';
import StatsOverview from '@/components/player/StatsOverview';
import MatchTimeline from '@/components/player/MatchTimeline';
import MatchCard from '@/components/player/MatchCard';

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
  const { state, navigateTo } = useNavigation();
  const [resolvedPlayer, setResolvedPlayer] = useState<Player | undefined>(playerData);

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

  const {
    tournamentSeasons,
    availableSeasonYears,
    selectedPeriod,
    setSelectedPeriod,
    currentSeasonYear,
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
  } = usePlayerData(playerId);

  // All tournaments available for the current season year (used by filter UI)
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

  const selectedTournamentIds = useMemo(
    () => new Set(selectedTournaments.map((t) => t.tournamentId)),
    [selectedTournaments],
  );

  const {
    allEvents,
    detailsMap,
    detailsLoadedIds,
    failedIds,
    loadingEvents,
    initialDetailsLoaded,
  } = useMatchTimeline(playerId, allTournamentsForSeason);

  // ── Display events: all filters applied on top of allEvents ──
  // This is pure derivation — changing any filter never touches the background loader.
  const displayEvents = useMemo(() => {
    // 1. Tournament filter
    let events = selectedTournamentIds.size === 0
      ? allEvents
      : allEvents.filter((e) => selectedTournamentIds.has(e.tournament?.uniqueTournament?.id));

    // 2. Period: "last N" slices the already-tournament-filtered list (behavior B)
    if (selectedPeriod.type === 'last') {
      events = events.slice(0, selectedPeriod.count);
    }

    // 3. Exclude matches where player was on the bench and never came on
    events = events.filter((e) => {
      const details = detailsMap.get(e.id);
      if (!details) return true; // keep until details confirm didNotPlay
      return !details.didNotPlay;
    });

    // 4. Venue filter
    if (!showHome || !showAway) {
      const teamId = resolvedPlayer?.team?.id;
      if (teamId) {
        events = events.filter((e) => {
          const isHome = e.homeTeam.id === teamId;
          if (showHome && isHome) return true;
          if (showAway && !isHome) return true;
          return false;
        });
      }
    }

    // 5. Starter filter (excluded if details not yet loaded → grows progressively)
    if (showStartersOnly) {
      events = events.filter((e) => {
        const details = detailsMap.get(e.id);
        if (!details) return false;
        return details.substituteInMinute === undefined;
      });
    }

    return events;
  }, [allEvents, selectedTournamentIds, selectedPeriod, detailsMap, showHome, showAway, resolvedPlayer?.team?.id, showStartersOnly]);

  // ── Selection state (moved here from useMatchTimeline) ──
  const [selectedEventIds, setSelectedEventIds] = useState<Set<number>>(new Set());

  // Pre-selection key: once per player+season combo (not per period change)
  const preSelectedKeyRef = useRef('');

  useEffect(() => {
    const seasonKey = allTournamentsForSeason.map((t) => `${t.tournamentId}:${t.seasonId}`).sort().join(',');
    const key = `${playerId}-${seasonKey}`;
    if (preSelectedKeyRef.current === key) return;
    if (displayEvents.length === 0 || !initialDetailsLoaded) return;
    preSelectedKeyRef.current = key;
    const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
    const count = isMobile ? 1 : 3;
    setSelectedEventIds(new Set(displayEvents.slice(0, count).map((e) => e.id)));
  }, [displayEvents, initialDetailsLoaded, playerId, allTournamentsForSeason]);

  // Prune selection when displayEvents shrinks (e.g. filter change removes events)
  useEffect(() => {
    const validIds = new Set(displayEvents.map((e) => e.id));
    setSelectedEventIds((prev) => {
      const pruned = new Set([...prev].filter((id) => validIds.has(id)));
      if (pruned.size === prev.size) return prev;
      return pruned;
    });
  }, [displayEvents]);

  // Auto-deselect didNotPlay matches as their details arrive
  useEffect(() => {
    const notPlayedIds = [...detailsMap.entries()]
      .filter(([, d]) => d.didNotPlay)
      .map(([id]) => id);
    if (notPlayedIds.length === 0) return;
    setSelectedEventIds((prev) => {
      const next = new Set(prev);
      let changed = false;
      notPlayedIds.forEach((id) => {
        if (next.has(id)) { next.delete(id); changed = true; }
      });
      return changed ? next : prev;
    });
  }, [detailsMap]);

  const toggleMatch = useCallback((eventId: number) => {
    setSelectedEventIds((prev) => {
      const next = new Set(prev);
      if (next.has(eventId)) next.delete(eventId); else next.add(eventId);
      return next;
    });
  }, []);

  const deselectMatch = useCallback((eventId: number) => {
    setSelectedEventIds((prev) => {
      const next = new Set(prev);
      next.delete(eventId);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedEventIds(new Set(displayEvents.map((e) => e.id)));
  }, [displayEvents]);

  const deselectAll = useCallback(() => {
    setSelectedEventIds(new Set());
  }, []);

  // ── Derived stats from displayEvents ──
  const derivedStats = useMemo(() => {
    const played = displayEvents.filter((e) => detailsMap.has(e.id));
    if (played.length === 0) return null;

    let totalCommitted = 0;
    let totalSuffered = 0;
    let totalMinutes = 0;
    let totalYellow = 0;
    let totalRed = 0;
    let committedOver = 0;
    let sufferedOver = 0;

    for (const e of played) {
      const d = detailsMap.get(e.id)!;
      const committed = d.fouls.filter((f) => f.type === 'committed' || f.type === 'handball').length;
      const suffered = d.fouls.filter((f) => f.type === 'suffered').length;
      totalCommitted += committed;
      totalSuffered += suffered;

      if (d.cardInfo?.type === 'yellow') totalYellow++;
      else if (d.cardInfo?.type === 'red') totalRed++;
      else if (d.cardInfo?.type === 'yellowRed') { totalYellow++; totalRed++; }

      if (committed > committedLine) committedOver++;
      if (suffered > sufferedLine) sufferedOver++;

      const inMin = d.substituteInMinute;
      const outMin = d.substituteOutMinute;
      if (inMin == null && outMin == null) totalMinutes += 90;
      else if (inMin == null && outMin != null) totalMinutes += outMin;
      else if (inMin != null && outMin == null) totalMinutes += Math.max(0, 90 - inMin);
      else totalMinutes += Math.max(0, outMin! - inMin!);
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

  // Toggle mode for select/deselect all
  const [toggleMode, setToggleMode] = useState<'select' | 'deselect'>('select');

  useEffect(() => {
    if (displayEvents.length === 0) return;
    if (selectedEventIds.size === displayEvents.length) {
      setToggleMode('deselect');
    } else if (selectedEventIds.size === 0) {
      setToggleMode('select');
    }
  }, [selectedEventIds, displayEvents]);

  const handleToggleAll = useCallback(() => {
    if (toggleMode === 'select') {
      selectAll();
      setToggleMode('deselect');
    } else {
      deselectAll();
      setToggleMode('select');
    }
  }, [toggleMode, selectAll, deselectAll]);

  // ── Full-page loader: only on the very first visit (never on filter/season changes) ──
  const [initialLoadComplete, setInitialLoadComplete] = useState(false);
  useEffect(() => {
    if (initialDetailsLoaded && !initialLoadComplete) {
      setInitialLoadComplete(true);
    }
  }, [initialDetailsLoaded]);

  // ── Timeline spinner: shown when some visible events still lack details ──
  const hasTimelineSpinner = displayEvents.some((e) => !detailsMap.has(e.id));

  const displayPlayer: Player = resolvedPlayer ?? {
    id: playerId,
    name: `Giocatore #${playerId}`,
    slug: '',
    position: '',
  };

  // First visit: show header + full-page loader
  if (!initialLoadComplete) {
    return (
      <div className="min-w-0">
        <div className="pb-4 border-b border-border">
          <PlayerHeader player={displayPlayer} />
        </div>
        <div className="flex items-center gap-2 text-text-muted mt-8">
          <div className="w-4 h-4 border-2 border-neon border-t-transparent rounded-full animate-spin" />
          Caricamento partite...
        </div>
      </div>
    );
  }

  return (
    <div className="min-w-0">
      {/* Header */}
      <div className="pb-4 border-b border-border">
        <PlayerHeader player={displayPlayer} />
      </div>

      {/* Filtri */}
      {availableSeasonYears.length > 0 && (
        <div className="mt-4 pb-4 border-b border-border">
          <PlayerFilters
            tournamentSeasons={tournamentSeasons}
            availableSeasonYears={availableSeasonYears}
            selectedPeriod={selectedPeriod}
            onPeriodChange={setSelectedPeriod}
            selectedTournaments={selectedTournaments}
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
            allTournamentsForSeason={allTournamentsForSeason}
            committedLine={committedLine}
            onCommittedLineChange={setCommittedLine}
            sufferedLine={sufferedLine}
            onSufferedLineChange={setSufferedLine}
            showStartersOnly={showStartersOnly}
            onShowStartersOnlyChange={setShowStartersOnly}
            isSplitView={isSplitView}
          />
        </div>
      )}

      {/* Stats overview */}
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

      {/* Timeline */}
      <div className="mt-8">
        {loadingEvents ? (
          // Season change in progress: pages still loading
          <div className="flex items-center gap-2 text-text-muted">
            <div className="w-4 h-4 border-2 border-neon border-t-transparent rounded-full animate-spin" />
            Caricamento partite...
          </div>
        ) : (
          <>
            <MatchTimeline
              events={displayEvents}
              selectedEventIds={selectedEventIds}
              detailsMap={detailsMap}
              detailsLoadedIds={detailsLoadedIds}
              failedIds={failedIds}
              showCommitted={showCommitted}
              showSuffered={showSuffered}
              onToggleMatch={toggleMatch}
              toggleMode={toggleMode}
              onToggleAll={handleToggleAll}
              isBackgroundLoading={hasTimelineSpinner}
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
                    />
                  </SyncedCardSlot>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}