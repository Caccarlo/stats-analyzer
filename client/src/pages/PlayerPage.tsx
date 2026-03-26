import { useState, useEffect } from 'react';
import { usePlayerData } from '@/hooks/usePlayerData';
import { useNavigation } from '@/context/NavigationContext';
import { getPlayerInfo } from '@/api/sofascore';
import type { Player } from '@/types';
import PlayerHeader from '@/components/player/PlayerHeader';
import PlayerFilters from '@/components/player/PlayerFilters';
import StatsOverview from '@/components/player/StatsOverview';
import MatchList from '@/components/player/MatchList';

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

  // Placeholder player per il header (usa dati completi se disponibili)
  const displayPlayer: Player = resolvedPlayer ?? {
    id: playerId,
    name: `Giocatore #${playerId}`,
    slug: '',
    position: '',
  };

  return (
    <div>
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
            allTournamentsForSeason={allTournamentsForSeason}
          />
        </div>
      )}

      {/* Loading */}
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
          />
        </div>
      )}

      {/* Lista partite */}
      {!loading && (
        <div className="mt-8">
          <MatchList
            playerId={playerId}
            selectedTournamentIds={new Set(selectedTournaments.map((t) => t.tournamentId))}
            showCommitted={showCommitted}
            showSuffered={showSuffered}
            panelIndex={panelIndex}
          />
        </div>
      )}
    </div>
  );
}
