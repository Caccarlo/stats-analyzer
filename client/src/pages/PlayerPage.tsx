import { usePlayerData } from '@/hooks/usePlayerData';
import type { Player } from '@/types';
import SearchBar from '@/components/layout/SearchBar';

interface PlayerPageProps {
  playerId: number;
  playerData?: Player;
  panelIndex?: number;
}

export default function PlayerPage({ playerId, playerData, panelIndex = 0 }: PlayerPageProps) {
  const {
    stats,
    loading,
    error,
  } = usePlayerData(playerId);

  return (
    <div>
      {panelIndex === 0 && <SearchBar />}

      <div className="mt-6">
        <h2 className="text-xl font-bold text-text-primary">
          {playerData?.name ?? `Giocatore #${playerId}`}
        </h2>
        {playerData?.team && (
          <p className="text-text-secondary text-sm mt-1">
            {playerData.team.name}
            {playerData.position ? ` · ${playerData.position}` : ''}
          </p>
        )}
      </div>

      {loading && (
        <div className="mt-6 flex items-center gap-2 text-text-muted">
          <div className="w-4 h-4 border-2 border-neon border-t-transparent rounded-full animate-spin" />
          Caricamento statistiche...
        </div>
      )}

      {error && (
        <div className="mt-6 text-negative text-sm">
          Errore: {error}
        </div>
      )}

      {stats && (
        <div className="mt-6 grid grid-cols-3 gap-4">
          <div className="bg-surface border border-border rounded-lg p-4">
            <p className="text-text-muted text-xs">Falli commessi</p>
            <p className="text-negative text-2xl font-bold">{stats.totalFoulsCommitted}</p>
            <p className="text-text-muted text-xs mt-1">{stats.avgFoulsCommittedPer90} / 90 min</p>
          </div>
          <div className="bg-surface border border-border rounded-lg p-4">
            <p className="text-text-muted text-xs">Falli subiti</p>
            <p className="text-neon text-2xl font-bold">{stats.totalFoulsSuffered}</p>
            <p className="text-text-muted text-xs mt-1">{stats.avgFoulsSufferedPer90} / 90 min</p>
          </div>
          <div className="bg-surface border border-border rounded-lg p-4">
            <p className="text-text-muted text-xs">Presenze</p>
            <p className="text-text-primary text-2xl font-bold">{stats.totalAppearances}</p>
            <p className="text-text-muted text-xs mt-1">{stats.totalMinutesPlayed} min</p>
          </div>
        </div>
      )}
    </div>
  );
}
