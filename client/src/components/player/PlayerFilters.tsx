import { useEffect, useMemo, useRef, useState } from 'react';
import { getTeamImageUrl } from '@/api/sofascore';
import type { TournamentSeason, Team } from '@/types';
import type { SelectedPeriod } from '@/hooks/usePlayerData';
import { useViewport } from '@/hooks/useViewport';

const LAST_N_OPTIONS: Array<5 | 10 | 15 | 20 | 30 | 50 | 75> = [5, 10, 15, 20, 30, 50, 75];

interface PlayerFiltersProps {
  tournamentSeasons: TournamentSeason[];
  availableSeasonYears: string[];
  selectedPeriod: SelectedPeriod;
  seasonClubMap: Map<string, Team[]>;
  lastNClubMap: Map<number, Team[]>;
  onPeriodChange: (p: SelectedPeriod) => void;
  selectedTournaments: { tournamentId: number; tournamentName: string }[];
  onToggleTournament: (tournamentId: number) => void;
  showCommitted: boolean;
  onShowCommittedChange: (v: boolean) => void;
  showSuffered: boolean;
  onShowSufferedChange: (v: boolean) => void;
  showShots: boolean;
  onShowShotsChange: (v: boolean) => void;
  showShotsOnTarget: boolean;
  onShowShotsOnTargetChange: (v: boolean) => void;
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
  shotsLine: number;
  onShotsLineChange: (v: number) => void;
  shotsOnTargetLine: number;
  onShotsOnTargetLineChange: (v: number) => void;
  allTournamentsForSeason: { tournamentId: number; tournamentName: string }[];
  isSplitView?: boolean;
  compact?: boolean;
  panelWidth?: number;
}

function SeasonClubLogos({ teams }: { teams: Team[] | undefined }) {
  if (!teams || teams.length === 0) return null;

  return (
    <span className="flex items-center gap-1 shrink-0">
      {teams.slice(0, 2).map((team, index) => (
        <span key={team.id} className="flex items-center gap-1">
          {index > 0 && <span className="text-text-muted">/</span>}
          <img
            src={getTeamImageUrl(team.id)}
            alt=""
            title={team.name}
            className="w-[18px] h-[18px] object-contain"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
        </span>
      ))}
    </span>
  );
}

export default function PlayerFilters({
  availableSeasonYears,
  selectedPeriod,
  seasonClubMap,
  lastNClubMap,
  onPeriodChange,
  selectedTournaments,
  onToggleTournament,
  showCommitted,
  onShowCommittedChange,
  showSuffered,
  onShowSufferedChange,
  showShots,
  onShowShotsChange,
  showShotsOnTarget,
  onShowShotsOnTargetChange,
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
  shotsLine,
  onShotsLineChange,
  shotsOnTargetLine,
  onShotsOnTargetLineChange,
  allTournamentsForSeason,
  isSplitView = false,
  compact = false,
  panelWidth = 0,
}: PlayerFiltersProps) {
  const [periodOpen, setPeriodOpen] = useState(false);
  const selectedIds = new Set(selectedTournaments.map((t) => t.tournamentId));
  const periodRef = useRef<HTMLDivElement>(null);

  const periodLabel = useMemo(
    () => (
      selectedPeriod.type === 'last'
        ? `Ultime ${selectedPeriod.count}`
        : selectedPeriod.year
    ),
    [selectedPeriod],
  );

  const selectedPeriodTeams = useMemo(
    () => (
      selectedPeriod.type === 'season'
        ? seasonClubMap.get(selectedPeriod.year)
        : lastNClubMap.get(selectedPeriod.count)
    ),
    [selectedPeriod, seasonClubMap, lastNClubMap],
  );

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (periodRef.current && !periodRef.current.contains(e.target as Node)) {
        setPeriodOpen(false);
      }
    };

    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handlePeriodSelect = (period: SelectedPeriod) => {
    onPeriodChange(period);
    setPeriodOpen(false);
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

  const showFilters = [showCommitted, showSuffered, showShots, showShotsOnTarget, showCards];
  const showSetters = [onShowCommittedChange, onShowSufferedChange, onShowShotsChange, onShowShotsOnTargetChange, onShowCardsChange];
  const activeCount = showFilters.filter(Boolean).length;

  const handleToggleShow = (idx: number) => {
    if (showFilters[idx] && activeCount === 1) {
      const nextIdx = (idx + 1) % showFilters.length;
      showSetters[nextIdx](true);
    }
    showSetters[idx](!showFilters[idx]);
  };

  const { width: viewportWidth } = useViewport();
  const capCompetitionsToHalf = !isSplitView && viewportWidth >= 1024;

  const labelClass = compact ? 'text-[11px]' : 'text-xs';
  const competitionChipClass = compact ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-xs';
  const controlHeightClass = compact ? 'h-8' : 'h-8';
  const controlChipClass = `${controlHeightClass} inline-flex items-center px-2.5 text-xs rounded-lg border transition-colors`;
  const selectClass = `${controlHeightClass} bg-surface border rounded-lg focus:outline-none transition-colors px-2.5 text-xs`;
  const periodButtonWidth = compact ? 112 : 124;
  const allowFullFallback = panelWidth > 0 && panelWidth < 300;
  const gridTemplateColumns = isSplitView
    ? '1fr'
    : 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))';

  return (
    <div className={`player-filters grid ${compact ? 'gap-3' : 'gap-4'}`} style={{ gridTemplateColumns }}>
      <div className="min-w-0" style={{ gridColumn: '1 / -1' }}>
        <label className={`text-text-muted mb-2 block ${labelClass}`}>Competizioni:</label>
        <div className="flex flex-wrap gap-2" style={capCompetitionsToHalf ? { maxWidth: '50%' } : undefined}>
          {allTournamentsForSeason.map((t) => {
            const active = selectedIds.has(t.tournamentId);
            return (
              <button
                key={t.tournamentId}
                onClick={() => handleToggleTournament(t.tournamentId)}
                className={`${competitionChipClass} rounded-lg border transition-colors text-left ${
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

      <div className="min-w-0" style={{ gridColumn: '1 / -1' }}>
        <div className={allowFullFallback ? 'flex flex-col items-start gap-3' : 'flex flex-wrap items-start gap-3'}>
          <div className={allowFullFallback ? 'flex flex-col items-start gap-3 w-full' : 'flex flex-nowrap items-start gap-3 min-w-0'}>
            <div className={allowFullFallback ? 'w-full' : 'flex-shrink-0'}>
              <label className={`text-text-muted mb-2 block ${labelClass}`}>Sede:</label>
              <div className="flex flex-nowrap gap-2">
                <button
                  onClick={handleToggleHome}
                  className={`${controlChipClass} whitespace-nowrap ${
                    showHome
                      ? 'bg-neon/15 border-neon text-neon'
                      : 'bg-surface border-border text-text-muted hover:border-border-hover'
                  }`}
                >
                  Casa
                </button>
                <button
                  onClick={handleToggleAway}
                  className={`${controlChipClass} whitespace-nowrap ${
                    showAway
                      ? 'bg-neon/15 border-neon text-neon'
                      : 'bg-surface border-border text-text-muted hover:border-border-hover'
                  }`}
                >
                  Trasferta
                </button>
              </div>
            </div>

            <div className={allowFullFallback ? 'w-full' : 'flex-shrink-0'}>
              <label className={`text-text-muted mb-2 block ${labelClass}`}>Periodo:</label>
              <div className="flex flex-nowrap gap-2">
                <div ref={periodRef} className="relative" style={{ width: `${periodButtonWidth}px` }}>
                  <button
                    type="button"
                    onClick={() => setPeriodOpen((prev) => !prev)}
                    className={`w-full ${controlHeightClass} bg-surface border rounded-lg transition-colors text-left flex items-center justify-between gap-1.5 px-2 text-xs ${
                      periodOpen ? 'border-neon text-text-primary' : 'border-border text-text-primary'
                    }`}
                  >
                    <span className="flex items-center justify-between gap-1 min-w-0 flex-1">
                      <span className="min-w-0 leading-none">{periodLabel}</span>
                      <SeasonClubLogos teams={selectedPeriodTeams} />
                    </span>
                    <span className={`text-text-muted transition-transform shrink-0 ${periodOpen ? 'rotate-180' : ''}`}>
                      v
                    </span>
                  </button>

                  {periodOpen && (
                    <div className="absolute top-full left-0 mt-1 w-full bg-surface border border-border rounded-lg shadow-xl z-50 overflow-hidden">
                      <div className="py-1">
                        {LAST_N_OPTIONS.map((n) => {
                          const active = selectedPeriod.type === 'last' && selectedPeriod.count === n;
                          return (
                            <button
                              key={n}
                              type="button"
                              onClick={() => handlePeriodSelect({ type: 'last', count: n })}
                              className={`w-full px-3 py-2 text-xs text-left transition-colors ${
                                active
                                  ? 'text-neon bg-neon/10'
                                  : 'text-text-primary hover:bg-bg'
                              }`}
                            >
                              Ultime {n}
                            </button>
                          );
                        })}
                      </div>

                      {availableSeasonYears.length > 0 && (
                        <>
                          <div className="h-px bg-border mx-2" />
                          <div className="py-1">
                            {availableSeasonYears.map((year) => {
                              const active = selectedPeriod.type === 'season' && selectedPeriod.year === year;
                              return (
                                <button
                                  key={year}
                                  type="button"
                                  onClick={() => handlePeriodSelect({ type: 'season', year })}
                                  className={`w-full px-3 py-2 text-xs transition-colors text-left ${
                                    active
                                      ? 'text-neon bg-neon/10'
                                      : 'text-text-primary hover:bg-bg'
                                  }`}
                                >
                                  {year}
                                </button>
                              );
                            })}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className={allowFullFallback ? 'w-full' : 'flex-shrink-0'}>
            <label className={`text-text-muted mb-2 block ${labelClass}`}>Titolare:</label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={!startersFilterEnabled}
                onClick={() => onShowStartersOnlyChange(!showStartersOnly)}
                className={`${controlChipClass} ${
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
      </div>

      <div className="min-w-0" style={{ gridColumn: '1 / -1' }}>
        <div>
          <label className={`text-text-muted mb-2 block ${labelClass}`}>Mostra:</label>
          <div className={`flex flex-wrap items-start ${compact ? 'gap-2' : 'gap-3'}`}>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => handleToggleShow(0)}
                className={`${controlChipClass} text-left ${
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
                className={`${selectClass} ${
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

            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => handleToggleShow(1)}
                className={`${controlChipClass} text-left ${
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
                className={`${selectClass} ${
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

            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => handleToggleShow(2)}
                className={`${controlChipClass} text-left ${
                  showShots
                    ? 'bg-white/10 border-white text-white'
                    : 'bg-surface border-border text-text-muted hover:border-border-hover'
                }`}
              >
                Tiri
              </button>
              <select
                value={shotsLine}
                onChange={(e) => onShotsLineChange(Number(e.target.value))}
                disabled={!showShots}
                className={`${selectClass} ${
                  showShots
                    ? 'border-border text-text-primary focus:border-neon'
                    : 'border-border text-text-muted opacity-40 cursor-not-allowed'
                }`}
              >
                {[0.5, 1.5, 2.5, 3.5, 4.5, 5.5].map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => handleToggleShow(3)}
                className={`${controlChipClass} text-left ${
                  showShotsOnTarget
                    ? 'bg-sky-400/15 border-sky-400 text-sky-300'
                    : 'bg-surface border-border text-text-muted hover:border-border-hover'
                }`}
              >
                Tiri in porta
              </button>
              <select
                value={shotsOnTargetLine}
                onChange={(e) => onShotsOnTargetLineChange(Number(e.target.value))}
                disabled={!showShotsOnTarget}
                className={`${selectClass} ${
                  showShotsOnTarget
                    ? 'border-border text-text-primary focus:border-neon'
                    : 'border-border text-text-muted opacity-40 cursor-not-allowed'
                }`}
              >
                {[0.5, 1.5, 2.5, 3.5, 4.5, 5.5].map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => handleToggleShow(4)}
                className={`${controlChipClass} text-left ${
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
      </div>
    </div>
  );
}
