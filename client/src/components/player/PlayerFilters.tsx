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
  showHome: boolean;
  onShowHomeChange: (v: boolean) => void;
  showAway: boolean;
  onShowAwayChange: (v: boolean) => void;
  showCards: boolean;
  onShowCardsChange: (v: boolean) => void;
  committedLine: number;
  onCommittedLineChange: (v: number) => void;
  sufferedLine: number;
  onSufferedLineChange: (v: number) => void;
  allTournamentsForSeason: { tournamentId: number; tournamentName: string }[];
  isSplitView?: boolean;
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
  showHome,
  onShowHomeChange,
  showAway,
  onShowAwayChange,
  showCards,
  onShowCardsChange,
  committedLine,
  onCommittedLineChange,
  sufferedLine,
  onSufferedLineChange,
  allTournamentsForSeason,
  isSplitView = false,
}: PlayerFiltersProps) {
  const selectedIds = new Set(selectedTournaments.map((t) => t.tournamentId));

  const handleToggleTournament = (tournamentId: number) => {
    if (selectedIds.has(tournamentId) && selectedIds.size === 1) {
      const idx = allTournamentsForSeason.findIndex((t) => t.tournamentId === tournamentId);
      const nextIdx = (idx + 1) % allTournamentsForSeason.length;
      onToggleTournament(allTournamentsForSeason[nextIdx].tournamentId);
    }
    onToggleTournament(tournamentId);
  };

  const venueActiveCount = [showHome, showAway].filter(Boolean).length;

  const handleToggleHome = () => {
    if (showHome && venueActiveCount === 1) return;
    onShowHomeChange(!showHome);
  };

  const handleToggleAway = () => {
    if (showAway && venueActiveCount === 1) return;
    onShowAwayChange(!showAway);
  };

  const activeCount = [showCommitted, showSuffered, showCards].filter(Boolean).length;

  const handleToggleCommitted = () => {
    if (showCommitted && activeCount === 1) return;
    onShowCommittedChange(!showCommitted);
  };

  const handleToggleSuffered = () => {
    if (showSuffered && activeCount === 1) return;
    onShowSufferedChange(!showSuffered);
  };

  const handleToggleCards = () => {
    if (showCards && activeCount === 1) return;
    onShowCardsChange(!showCards);
  };

  return (
    <div className={`grid grid-cols-3 gap-6 ${isSplitView ? 'w-full' : 'w-1/2'}`}>
      {/* Colonna 1 — Competizioni */}
      <div>
        <label className="text-text-muted text-xs mb-2 block">Competizioni:</label>
        <div className="flex flex-col gap-2 items-start">
          {allTournamentsForSeason.map((t) => {
            const active = selectedIds.has(t.tournamentId);
            return (
              <button
                key={t.tournamentId}
                onClick={() => handleToggleTournament(t.tournamentId)}
                className={`px-2 py-1 rounded-lg text-xs border transition-colors text-left ${
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

      {/* Colonna 2 — Sede + Stagione */}
      <div className="flex flex-col gap-4">
        <div>
          <label className="text-text-muted text-xs mb-2 block">Sede:</label>
          <div className="flex gap-2">
            <button
              onClick={handleToggleHome}
              className={`px-2 py-1 rounded-lg text-xs border transition-colors ${
                showHome
                  ? 'bg-neon/15 border-neon text-neon'
                  : 'bg-surface border-border text-text-muted hover:border-border-hover'
              }`}
            >
              {showHome ? '✓ ' : ''}Casa
            </button>
            <button
              onClick={handleToggleAway}
              className={`px-2 py-1 rounded-lg text-xs border transition-colors ${
                showAway
                  ? 'bg-neon/15 border-neon text-neon'
                  : 'bg-surface border-border text-text-muted hover:border-border-hover'
              }`}
            >
              {showAway ? '✓ ' : ''}Trasferta
            </button>
          </div>
        </div>

        <div className="w-fit">
          <label className="text-text-muted text-xs mb-2 block">Stagione:</label>
          <select
            value={selectedSeasonYear}
            onChange={(e) => onSeasonChange(e.target.value)}
            className="w-fit bg-surface border border-border rounded-lg px-2 py-1 text-xs text-text-primary focus:outline-none focus:border-neon"
          >
            {availableSeasonYears.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Colonna 3 — Mostra */}
      <div>
        <label className="text-text-muted text-xs mb-2 block">Mostra:</label>
        <div className="flex flex-col gap-2 items-start">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={handleToggleCommitted}
              className={`px-2 py-1 rounded-lg text-xs border transition-colors text-left ${
                showCommitted
                  ? 'bg-negative/15 border-negative text-negative'
                  : 'bg-surface border-border text-text-muted hover:border-border-hover'
              }`}
            >
              {showCommitted ? '✓ ' : ''}Falli commessi
            </button>
            <select
              value={committedLine}
              onChange={(e) => onCommittedLineChange(Number(e.target.value))}
              className={`bg-surface border rounded-lg px-2 py-1 text-xs focus:outline-none transition-colors ${
                showCommitted
                  ? 'border-border text-text-primary focus:border-neon'
                  : 'border-border text-text-muted opacity-40 cursor-not-allowed'
              }`}
              disabled={!showCommitted}
            >
              {[0.5,1.5,2.5,3.5,4.5,5.5].map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={handleToggleSuffered}
              className={`px-2 py-1 rounded-lg text-xs border transition-colors text-left ${
                showSuffered
                  ? 'bg-neon/15 border-neon text-neon'
                  : 'bg-surface border-border text-text-muted hover:border-border-hover'
              }`}
            >
              {showSuffered ? '✓ ' : ''}Falli subiti
            </button>
            <select
              value={sufferedLine}
              onChange={(e) => onSufferedLineChange(Number(e.target.value))}
              className={`bg-surface border rounded-lg px-2 py-1 text-xs focus:outline-none transition-colors ${
                showSuffered
                  ? 'border-border text-text-primary focus:border-neon'
                  : 'border-border text-text-muted opacity-40 cursor-not-allowed'
              }`}
              disabled={!showSuffered}
            >
              {[0.5,1.5,2.5,3.5,4.5,5.5].map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </div>
          <button
            onClick={handleToggleCards}
            className={`px-2 py-1 rounded-lg text-xs border transition-colors text-left ${
              showCards
                ? 'bg-yellow-400/15 border-yellow-400 text-yellow-400'
                : 'bg-surface border-border text-text-muted hover:border-border-hover'
            }`}
          >
            {showCards ? '✓ ' : ''}Cartellini
          </button>
        </div>
      </div>
    </div>
  );
}