import type { TournamentSeason } from '@/types';
import type { SelectedPeriod } from '@/hooks/usePlayerData';

const LAST_N_OPTIONS: Array<5 | 10 | 15 | 20 | 30> = [5, 10, 15, 20, 30];

interface PlayerFiltersProps {
  tournamentSeasons: TournamentSeason[];
  availableSeasonYears: string[];
  selectedPeriod: SelectedPeriod;
  onPeriodChange: (p: SelectedPeriod) => void;
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
  showStartersOnly: boolean;
  onShowStartersOnlyChange: (v: boolean) => void;
  startersFilterEnabled: boolean;
  committedLine: number;
  onCommittedLineChange: (v: number) => void;
  sufferedLine: number;
  onSufferedLineChange: (v: number) => void;
  allTournamentsForSeason: { tournamentId: number; tournamentName: string }[];
  isSplitView?: boolean;
}

export default function PlayerFilters({
  availableSeasonYears,
  selectedPeriod,
  onPeriodChange,
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
  showStartersOnly,
  onShowStartersOnlyChange,
  startersFilterEnabled,
  committedLine,
  onCommittedLineChange,
  sufferedLine,
  onSufferedLineChange,
  allTournamentsForSeason,
  isSplitView = false,
}: PlayerFiltersProps) {
  const selectedIds = new Set(selectedTournaments.map((t) => t.tournamentId));

  // Serialize SelectedPeriod to/from a string for the HTML <select>
  const periodValue =
    selectedPeriod.type === 'last'
      ? `last:${selectedPeriod.count}`
      : `season:${selectedPeriod.year}`;

  const handlePeriodChange = (value: string) => {
    if (value.startsWith('last:')) {
      const count = parseInt(value.split(':')[1]) as 5 | 10 | 15 | 20 | 30;
      onPeriodChange({ type: 'last', count });
    } else {
      const year = value.replace('season:', '');
      onPeriodChange({ type: 'season', year });
    }
  };

  const handleToggleTournament = (tournamentId: number) => {
    if (selectedIds.has(tournamentId) && selectedIds.size === 1) {
      const idx = allTournamentsForSeason.findIndex((t) => t.tournamentId === tournamentId);
      const nextIdx = (idx + 1) % allTournamentsForSeason.length;
      onToggleTournament(allTournamentsForSeason[nextIdx].tournamentId);
    }
    onToggleTournament(tournamentId);
  };

  const handleToggleHome = () => {
    if (showHome && !showAway) onShowAwayChange(true);
    onShowHomeChange(!showHome);
  };

  const handleToggleAway = () => {
    if (showAway && !showHome) onShowHomeChange(true);
    onShowAwayChange(!showAway);
  };

  const showFilters = [showCommitted, showSuffered, showCards];
  const showSetters = [onShowCommittedChange, onShowSufferedChange, onShowCardsChange];
  const activeCount = showFilters.filter(Boolean).length;

  const handleToggleShow = (idx: number) => {
    if (showFilters[idx] && activeCount === 1) {
      const nextIdx = (idx + 1) % showFilters.length;
      showSetters[nextIdx](true);
    }
    showSetters[idx](!showFilters[idx]);
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
                {t.tournamentName}
              </button>
            );
          })}
        </div>
      </div>

      {/* Colonna 2 — Sede + Periodo */}
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
              Casa
            </button>
            <button
              onClick={handleToggleAway}
              className={`px-2 py-1 rounded-lg text-xs border transition-colors ${
                showAway
                  ? 'bg-neon/15 border-neon text-neon'
                  : 'bg-surface border-border text-text-muted hover:border-border-hover'
              }`}
            >
              Trasferta
            </button>
          </div>
        </div>
        <div>
          <label className="text-text-muted text-xs mb-2 block">Periodo:</label>
          <div className="flex items-center gap-2">
            <select
              value={periodValue}
              onChange={(e) => handlePeriodChange(e.target.value)}
              className="w-fit bg-surface border border-border rounded-lg px-2 py-1 text-xs text-text-primary focus:outline-none focus:border-neon"
            >
              <optgroup label="Ultime partite">
                {LAST_N_OPTIONS.map((n) => (
                  <option key={n} value={`last:${n}`}>
                    Ultime {n}
                  </option>
                ))}
              </optgroup>
              {availableSeasonYears.length > 0 && (
                <optgroup label="Stagione">
                  {availableSeasonYears.map((year) => (
                    <option key={year} value={`season:${year}`}>
                      {year}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
            <button
              type="button"
              disabled={!startersFilterEnabled}
              onClick={() => onShowStartersOnlyChange(!showStartersOnly)}
              className={`px-2 py-1 rounded-lg text-xs border transition-colors ${
                showStartersOnly
                  ? 'bg-neon/15 border-neon text-neon'
                  : startersFilterEnabled
                    ? 'bg-surface border-border text-text-muted hover:border-border-hover'
                    : 'bg-surface border-border text-text-muted opacity-40 cursor-not-allowed'
              }`}
              title={
                startersFilterEnabled
                  ? undefined
                  : 'Disponibile quando tutte le partite hanno caricato le formazioni'
              }
            >
              Titolare
            </button>
          </div>
        </div>
      </div>

      {/* Colonna 3 — Mostra */}
      <div>
        <label className="text-text-muted text-xs mb-2 block">Mostra:</label>
        <div className="flex flex-col gap-2 items-start">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => handleToggleShow(0)}
              className={`px-2 py-1 rounded-lg text-xs border transition-colors text-left ${
                showCommitted
                  ? 'bg-negative/15 border-negative text-negative'
                  : 'bg-surface border-border text-text-muted hover:border-border-hover'
              }`}
            >
              Falli commessi
            </button>
            <select
              value={committedLine}
              onChange={(e) => onCommittedLineChange(Number(e.target.value))}
              disabled={!showCommitted}
              className={`bg-surface border rounded-lg px-2 py-1 text-xs focus:outline-none transition-colors ${
                showCommitted
                  ? 'border-border text-text-primary focus:border-neon'
                  : 'border-border text-text-muted opacity-40 cursor-not-allowed'
              }`}
            >
              {[0.5, 1.5, 2.5, 3.5, 4.5, 5.5].map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => handleToggleShow(1)}
              className={`px-2 py-1 rounded-lg text-xs border transition-colors text-left ${
                showSuffered
                  ? 'bg-neon/15 border-neon text-neon'
                  : 'bg-surface border-border text-text-muted hover:border-border-hover'
              }`}
            >
              Falli subiti
            </button>
            <select
              value={sufferedLine}
              onChange={(e) => onSufferedLineChange(Number(e.target.value))}
              disabled={!showSuffered}
              className={`bg-surface border rounded-lg px-2 py-1 text-xs focus:outline-none transition-colors ${
                showSuffered
                  ? 'border-border text-text-primary focus:border-neon'
                  : 'border-border text-text-muted opacity-40 cursor-not-allowed'
              }`}
            >
              {[0.5, 1.5, 2.5, 3.5, 4.5, 5.5].map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </div>
          <button
            onClick={() => handleToggleShow(2)}
            className={`px-2 py-1 rounded-lg text-xs border transition-colors text-left ${
              showCards
                ? 'bg-yellow-400/15 border-yellow-400 text-yellow-400'
                : 'bg-surface border-border text-text-muted hover:border-border-hover'
            }`}
          >
            Cartellini
          </button>
        </div>
      </div>
    </div>
  );
}
