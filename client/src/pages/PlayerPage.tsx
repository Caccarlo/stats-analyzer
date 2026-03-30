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
    showStartersOnly,
    setShowStartersOnly,
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
  // Prima cosa: escludi partite in cui il giocatore era in panchina e non è mai entrato.
  // Se i dettagli non sono ancora caricati (details undefined), la partita rimane visibile
  // e verrà rivalutata quando i dettagli arrivano.
  let events = filteredEvents.filter((e) => {
    const details = detailsMap.get(e.id);
    if (!details) return true;
    return !details.didNotPlay;
  });

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
  if (showStartersOnly) {
    events = events.filter((e) => {
      const details = detailsMap.get(e.id);
      if (!details) return false;
      return details.substituteInMinute === undefined;
    });
  }
  return events;
}, [filteredEvents, showHome, showAway, resolvedPlayer?.team?.id, showStartersOnly, detailsMap]);

  const derivedStats = useMemo(() => {
    const played = venueFilteredEvents.filter((e) => detailsMap.has(e.id));
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
  }, [venueFilteredEvents, detailsMap, committedLine, sufferedLine]);

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

      {/* Timeline partite */}
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
    </div>
  );
}