import { useState, useEffect, useMemo, useCallback } from 'react';
import { usePlayerData } from '@/hooks/usePlayerData';
import { useMatchTimeline } from '@/hooks/useMatchTimeline';
import { useSplitCardSync } from '@/hooks/useSplitCardSync';
import { useNavigation } from '@/context/NavigationContext';
import { getPlayerInfo } from '@/api/sofascore';
import type { Player, MatchEvent } from '@/types';
import type { CachedMatchDetails } from '@/hooks/useMatchDetails';
import PlayerHeader from '@/components/player/PlayerHeader';
import PlayerFilters from '@/components/player/PlayerFilters';
import StatsOverview from '@/components/player/StatsOverview';
import MatchTimeline from '@/components/player/MatchTimeline';
import MatchCard from '@/components/player/MatchCard';

// Wrapper component for cross-panel card height sync (hooks can't be called in .map())
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

  // Fetch full player data (including team) and update panel state
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
    selectedSeasonYear,
    setSelectedSeasonYear,
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
    stats,
    loading,
    error,
  } = usePlayerData(playerId);

  // Tutti i tornei disponibili per la stagione selezionata (per i filtri)
  const allTournamentsForSeason = tournamentSeasons
    .map((ts) => {
      const season = ts.seasons.find((s) => s.year === selectedSeasonYear);
      if (!season) return null;
      return {
        tournamentId: ts.uniqueTournament.id,
        tournamentName: ts.uniqueTournament.name,
        seasonId: season.id,
        seasonName: season.name,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  // Tournament IDs set for filtering
  const selectedTournamentIds = useMemo(
    () => new Set(selectedTournaments.map((t) => t.tournamentId)),
    [selectedTournaments],
  );

  // All season IDs for the current season year (used to know when to stop loading pages)
  const validSeasonIds = useMemo(
    () => new Set(allTournamentsForSeason.map((t) => t.seasonId)),
    [allTournamentsForSeason],
  );

  // Timeline hook
  const {
    filteredEvents,
    selectedEventIds,
    detailsMap,
    detailsLoadedIds,
    loadingEvents,
    toggleMatch,
    deselectMatch,
    selectAll,
    deselectAll,
  } = useMatchTimeline(playerId, selectedTournamentIds, validSeasonIds);

  // Filtro casa/trasferta — playerTeamId ricavato dal team corrente del giocatore
  const venueFilteredEvents = useMemo(() => {
    if (showHome && showAway) return filteredEvents;
    const teamId = resolvedPlayer?.team?.id;
    if (!teamId) return filteredEvents;
    return filteredEvents.filter((e) => {
      const isHome = e.homeTeam.id === teamId;
      if (showHome && isHome) return true;
      if (showAway && !isHome) return true;
      return false;
    });
  }, [filteredEvents, showHome, showAway, resolvedPlayer?.team?.id]);

  const committedHitRate = useMemo(() => {
    const played = venueFilteredEvents.filter((e) => detailsMap.has(e.id));
    const over = played.filter(
      (e) => detailsMap.get(e.id)!.fouls.filter((f) => f.type === 'committed').length > committedLine
    );
    return { over: over.length, total: played.length };
  }, [venueFilteredEvents, detailsMap, committedLine]);

  const sufferedHitRate = useMemo(() => {
    const played = venueFilteredEvents.filter((e) => detailsMap.has(e.id));
    const over = played.filter(
      (e) => detailsMap.get(e.id)!.fouls.filter((f) => f.type === 'suffered').length > sufferedLine
    );
    return { over: over.length, total: played.length };
  }, [venueFilteredEvents, detailsMap, sufferedLine]);

  // Selected events sorted chronologically (most recent first, same as filteredEvents order)
  const selectedEvents = useMemo(
    () => venueFilteredEvents.filter((e) => selectedEventIds.has(e.id)),
    [filteredEvents, selectedEventIds],
  );

  // Card width class based on count — always full width in split view
  const isSplitView = state.panels.length > 1;
  const cardCount = selectedEvents.length;
  const cardWidthClass = isSplitView
    ? 'w-full'
    : cardCount === 1
      ? 'w-full'
      : cardCount === 2
        ? 'w-full md:w-[calc(50%-4px)]'
        : 'w-full md:w-[calc(33.333%-6px)]';

  // ── Toggle mode: 'select' = il tasto seleziona tutte, 'deselect' = deseleziona tutte ──
  const [toggleMode, setToggleMode] = useState<'select' | 'deselect'>('select');

  // Sincronizza toggleMode con la selezione effettiva:
  // - tutte selezionate → passa a 'deselect'
  // - nessuna selezionata → passa a 'select'
  // - selezione parziale → lascia invariato
  useEffect(() => {
    if (venueFilteredEvents.length === 0) return;
    if (selectedEventIds.size === venueFilteredEvents.length) {
      setToggleMode('deselect');
    } else if (selectedEventIds.size === 0) {
      setToggleMode('select');
    }
  }, [selectedEventIds, filteredEvents]);

  const handleToggleAll = useCallback(() => {
    if (toggleMode === 'select') {
      selectAll();
      setToggleMode('deselect');
    } else {
      deselectAll();
      setToggleMode('select');
    }
  }, [toggleMode, selectAll, deselectAll]);

  // Placeholder player per il header (usa dati completi se disponibili)
  const displayPlayer: Player = resolvedPlayer ?? {
    id: playerId,
    name: `Giocatore #${playerId}`,
    slug: '',
    position: '',
  };

  return (
    <div className="min-w-0">
      {/* Header giocatore */}
      <div className="pb-4 border-b border-border">
        <PlayerHeader player={displayPlayer} />
      </div>

      {/* Filtri */}
      {availableSeasonYears.length > 0 && (
        <div className="mt-4 pb-4 border-b border-border">
          <PlayerFilters
            tournamentSeasons={tournamentSeasons}
            availableSeasonYears={availableSeasonYears}
            selectedSeasonYear={selectedSeasonYear}
            onSeasonChange={setSelectedSeasonYear}
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
            isSplitView={isSplitView}
          />
        </div>
      )}

      {/* Loading stats */}
      {loading && (
        <div className="mt-6 flex items-center gap-2 text-text-muted">
          <div className="w-4 h-4 border-2 border-neon border-t-transparent rounded-full animate-spin" />
          Caricamento statistiche...
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mt-6 text-negative text-sm">
          Errore: {error}
        </div>
      )}

      {/* Stats overview */}
      {stats && (
        <div className="mt-6">
          <StatsOverview
            stats={stats}
            showCommitted={showCommitted}
            showSuffered={showSuffered}
            showCards={showCards}
            committedLine={committedLine}
            sufferedLine={sufferedLine}
            committedHitRate={committedHitRate}
            sufferedHitRate={sufferedHitRate}
          />
        </div>
      )}

      {/* Timeline partite */}
      {!loading && (
        <div className="mt-8">
          {loadingEvents ? (
            <div className="flex items-center gap-2 text-text-muted">
              <div className="w-4 h-4 border-2 border-neon border-t-transparent rounded-full animate-spin" />
              Caricamento partite...
            </div>
          ) : (
            <>
              <MatchTimeline
                events={venueFilteredEvents}
                selectedEventIds={selectedEventIds}
                detailsMap={detailsMap}
                detailsLoadedIds={detailsLoadedIds}
                showCommitted={showCommitted}
                showSuffered={showSuffered}
                onToggleMatch={toggleMatch}
                toggleMode={toggleMode}
                onToggleAll={handleToggleAll}
              />

              {/* Selected match cards */}
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
      )}
    </div>
  );
}