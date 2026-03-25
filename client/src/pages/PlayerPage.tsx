import { usePlayerData } from '@/hooks/usePlayerData';
import { useNavigation } from '@/context/NavigationContext';
import type { Player } from '@/types';
import SearchBar from '@/components/layout/SearchBar';
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
  const { state } = useNavigation();
  const hasSplit = state.panels.length > 1;
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

  // Placeholder player per il header
  const displayPlayer: Player = playerData ?? {
    id: playerId,
    name: `Giocatore #${playerId}`,
    slug: '',
    position: '',
  };

  return (
    <div>
      {panelIndex === 0 && !hasSplit && <SearchBar />}

      {/* Header giocatore */}
      <div className="mt-6 pb-4 border-b border-border">
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
