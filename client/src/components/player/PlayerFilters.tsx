import type { TournamentSeason } from '@/types';

interface PlayerFiltersProps {
  tournamentSeasons: TournamentSeason[];
  availableSeasonYears: string[];
  selectedSeasonYear: string;
  onSeasonChange: (year: string) => void;
  selectedTournaments: { tournamentId: number; tournamentName: string }[];
  onToggleTournament: (tournamentId: number) => void;
  showCommitted: boolean;
  onShowCommittedChange: (v: boolean) => void;
  showSuffered: boolean;
  onShowSufferedChange: (v: boolean) => void;
  allTournamentsForSeason: { tournamentId: number; tournamentName: string }[];
}

export default function PlayerFilters({
  availableSeasonYears,
  selectedSeasonYear,
  onSeasonChange,
  selectedTournaments,
  onToggleTournament,
  showCommitted,
  onShowCommittedChange,
  showSuffered,
  onShowSufferedChange,
  allTournamentsForSeason,
}: PlayerFiltersProps) {
  const selectedIds = new Set(selectedTournaments.map((t) => t.tournamentId));

  const handleToggleTournament = (tournamentId: number) => {
    // Deactivating the last active tournament: activate the next one first
    if (selectedIds.has(tournamentId) && selectedIds.size === 1) {
      const idx = allTournamentsForSeason.findIndex((t) => t.tournamentId === tournamentId);
      const nextIdx = (idx + 1) % allTournamentsForSeason.length;
      onToggleTournament(allTournamentsForSeason[nextIdx].tournamentId);
    }
    onToggleTournament(tournamentId);
  };

  const handleToggleCommitted = () => {
    // Deactivating the last foul type: activate the other first
    if (showCommitted && !showSuffered) onShowSufferedChange(true);
    onShowCommittedChange(!showCommitted);
  };

  const handleToggleSuffered = () => {
    if (showSuffered && !showCommitted) onShowCommittedChange(true);
    onShowSufferedChange(!showSuffered);
  };

  return (
    <div className="space-y-4">
      {/* Stagione */}
      <div className="flex items-center gap-3">
        <label className="text-text-muted text-sm">Stagione:</label>
        <select
          value={selectedSeasonYear}
          onChange={(e) => onSeasonChange(e.target.value)}
          className="bg-surface border border-border rounded-lg px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:border-neon"
        >
          {availableSeasonYears.map((year) => (
            <option key={year} value={year}>
              {year}
            </option>
          ))}
        </select>
      </div>

      {/* Competizioni */}
      <div>
        <label className="text-text-muted text-sm mb-2 block">Competizioni:</label>
        <div className="flex flex-wrap gap-2">
          {allTournamentsForSeason.map((t) => {
            const active = selectedIds.has(t.tournamentId);
            return (
              <button
                key={t.tournamentId}
                onClick={() => handleToggleTournament(t.tournamentId)}
                className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                  active
                    ? 'bg-neon/15 border-neon text-neon'
                    : 'bg-surface border-border text-text-muted hover:border-border-hover'
                }`}
              >
                {active ? '✓ ' : ''}{t.tournamentName}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tipo falli */}
      <div>
        <label className="text-text-muted text-sm mb-2 block">Mostra:</label>
        <div className="flex gap-2">
          <button
            onClick={handleToggleCommitted}
            className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
              showCommitted
                ? 'bg-negative/15 border-negative text-negative'
                : 'bg-surface border-border text-text-muted hover:border-border-hover'
            }`}
          >
            {showCommitted ? '✓ ' : ''}Falli commessi
          </button>
          <button
            onClick={handleToggleSuffered}
            className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
              showSuffered
                ? 'bg-neon/15 border-neon text-neon'
                : 'bg-surface border-border text-text-muted hover:border-border-hover'
            }`}
          >
            {showSuffered ? '✓ ' : ''}Falli subiti
          </button>
        </div>
      </div>
    </div>
  );
}
