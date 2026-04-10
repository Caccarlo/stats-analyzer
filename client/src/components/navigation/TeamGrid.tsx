import { useEffect, useMemo, type ReactNode } from 'react';
import { useNavigation } from '@/context/NavigationContext';
import { getTeamImageUrl } from '@/api/sofascore';
import { useTournamentViewData } from '@/hooks/useTournamentViewData';
import { useViewport } from '@/hooks/useViewport';
import type { Season, StandingRow, Team, TournamentPhaseSection } from '@/types';

interface TeamGridProps {
  leagueId: number;
  panelIndex?: number;
}

function TeamCard({
  team,
  onClick,
  badge,
  compact = false,
}: {
  team: Team;
  onClick: () => void;
  badge?: ReactNode;
  compact?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`relative flex flex-col items-center bg-surface border border-border rounded-lg hover:border-neon transition-colors ${
        compact ? 'gap-1 px-3 py-2' : 'gap-1.5 px-3.5 py-2.5'
      }`}
    >
      {badge}
      <img
        src={getTeamImageUrl(team.id)}
        alt=""
        className={compact ? 'w-7 h-7 object-contain' : 'w-9 h-9 object-contain'}
        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
      />
      <span className={`text-text-primary font-medium text-center leading-tight ${compact ? 'text-[10px]' : 'text-[10.5px]'}`}>
        {team.name}
      </span>
    </button>
  );
}

function StandingBadge({ row, compact = false }: { row: StandingRow; compact?: boolean }) {
  return (
    <>
      <span className={`absolute top-1.5 left-1.5 text-text-muted/70 font-medium ${compact ? 'text-[9px]' : 'text-[10px]'}`}>
        {row.position}.
      </span>
      <div className="absolute top-1.5 right-1.5 text-right leading-none">
        <span className={`text-text-muted/70 font-medium ${compact ? 'text-[9px]' : 'text-[10px]'}`}>
          {row.points} pts
        </span>
        <br />
        <span className={`text-text-muted/60 ${compact ? 'text-[8px]' : 'text-[9px]'}`}>
          {row.matches} pg
        </span>
      </div>
    </>
  );
}

function getSeasonLabel(season: Season): string {
  return season.year?.trim() || season.name?.trim() || String(season.id);
}

function TeamCardGrid({
  panelIndex,
  onSelectTeam,
  teams = [],
  standings = [],
  compact = false,
}: {
  panelIndex: number;
  onSelectTeam: (panel: number, teamId: number, teamName?: string) => void;
  teams?: Team[];
  standings?: StandingRow[];
  compact?: boolean;
}) {
  const gridClass = compact ? 'grid-cols-2 xl:grid-cols-3' : 'grid-cols-2 md:grid-cols-3 xl:grid-cols-4';
  const gapClass = compact ? 'gap-2.5' : 'gap-3';

  if (standings.length > 0) {
    return (
      <div className={`grid ${gridClass} ${gapClass}`}>
        {standings.map((row) => (
          <TeamCard
            key={row.team.id}
            team={row.team}
            onClick={() => onSelectTeam(panelIndex, row.team.id, row.team.name)}
            badge={<StandingBadge row={row} compact={compact} />}
            compact={compact}
          />
        ))}
      </div>
    );
  }

  return (
    <div className={`grid ${gridClass} ${gapClass}`}>
      {teams.map((team) => (
        <TeamCard
          key={team.id}
          team={team}
          onClick={() => onSelectTeam(panelIndex, team.id, team.name)}
          compact={compact}
        />
      ))}
    </div>
  );
}

function TeamSection({
  section,
  panelIndex,
  onSelectTeam,
  compact = false,
}: {
  section: TournamentPhaseSection;
  panelIndex: number;
  onSelectTeam: (panel: number, teamId: number, teamName?: string) => void;
  compact?: boolean;
}) {
  if (section.teams.length === 0 && section.standings.length === 0) return null;

  return (
    <section className="space-y-3">
      <p className="text-[11px] uppercase tracking-[0.18em] text-text-muted">
        {section.label}
      </p>
      <TeamCardGrid
        panelIndex={panelIndex}
        onSelectTeam={onSelectTeam}
        teams={section.teams}
        standings={section.standings}
        compact={compact}
      />
    </section>
  );
}

export default function TeamGrid({ leagueId, panelIndex = 0 }: TeamGridProps) {
  const { width, height } = useViewport();
  const { state, selectTeam, navigateTo } = useNavigation();
  const panel = state.panels[panelIndex];
  const hasSplit = state.panels.length > 1;
  const compactDensity = width < 640 || height < 820 || hasSplit;
  const seasonControlWidth = compactDensity ? 76 : 84;
  const phaseControlWidth = compactDensity ? 148 : 168;
  const leagueName = panel?.leagueName ?? 'Campionato';
  const {
    seasonId,
    seasons,
    mode,
    teams,
    phases,
    loading,
    error,
  } = useTournamentViewData(leagueId, panel?.seasonId);

  useEffect(() => {
    if (seasonId == null || panel?.seasonId === seasonId) return;
    navigateTo(panelIndex, 'teams', { seasonId });
  }, [seasonId, panel?.seasonId, panelIndex, navigateTo]);

  const selectedPhase = useMemo(() => {
    if (mode !== 'phases' || phases.length === 0) return null;
    const phaseKey = panel?.tournamentPhaseKey;
    if (phaseKey) return phases.find((phase) => phase.key === phaseKey) ?? phases[0];
    return phases.find((phase) => phase.key === 'league-phase') ?? phases[0];
  }, [mode, phases, panel?.tournamentPhaseKey]);

  useEffect(() => {
    if (!selectedPhase || panel?.tournamentPhaseKey === selectedPhase.key) return;
    navigateTo(panelIndex, 'teams', {
      tournamentPhaseKey: selectedPhase.key,
      tournamentPhaseName: selectedPhase.name,
    });
  }, [selectedPhase, panel?.tournamentPhaseKey, panelIndex, navigateTo]);

  const handlePhaseChange = (phaseKey: string) => {
    const phase = phases.find((item) => item.key === phaseKey);
    if (!phase) return;
    navigateTo(panelIndex, 'teams', {
      tournamentPhaseKey: phase.key,
      tournamentPhaseName: phase.name,
    });
  };

  const handleSeasonChange = (value: string) => {
    const nextSeasonId = Number(value);
    if (!Number.isFinite(nextSeasonId) || nextSeasonId === seasonId) return;
    navigateTo(panelIndex, 'teams', {
      seasonId: nextSeasonId,
      tournamentPhaseKey: undefined,
      tournamentPhaseName: undefined,
    });
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-text-muted">
        <div className="w-4 h-4 border-2 border-neon border-t-transparent rounded-full animate-spin" />
        Caricamento squadre...
      </div>
    );
  }

  if (error) {
    return <div className="text-negative text-sm">Errore: {error}</div>;
  }

  if (mode === 'phases') {
    const phaseTeams = selectedPhase?.teams ?? [];
    const phaseStandings = selectedPhase?.standings ?? [];
    const phaseSections = selectedPhase?.sections ?? [];

    return (
      <div>
        <div className="flex flex-col gap-2 mb-4">
          <h2 className="text-lg font-bold text-text-primary">{leagueName}</h2>
          <div
            className="grid gap-2 items-end justify-start"
            style={{ gridTemplateColumns: `${phaseControlWidth}px ${seasonControlWidth}px` }}
          >
            {phases.length > 0 && (
              <div className="min-w-0" style={{ width: `${phaseControlWidth}px` }}>
                <label className="block text-xs text-text-muted uppercase tracking-wide mb-1">
                  Fase
                </label>
                <select
                  value={selectedPhase?.key ?? ''}
                  onChange={(e) => handlePhaseChange(e.target.value)}
                  className="w-full h-8 bg-surface border border-border rounded-lg px-2.5 text-xs text-text-primary focus:outline-none focus:border-neon"
                >
                  {phases.map((phase) => (
                    <option key={phase.key} value={phase.key}>
                      {phase.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="min-w-0">
              <label className="block text-xs text-text-muted uppercase tracking-wide mb-1">
                Stagione
              </label>
              <select
                value={seasonId ?? ''}
                onChange={(e) => handleSeasonChange(e.target.value)}
                className="w-full h-8 bg-surface border border-border rounded-lg px-2.5 text-xs text-text-primary focus:outline-none focus:border-neon"
              >
                {seasons.map((season) => (
                  <option key={season.id} value={season.id}>
                    {getSeasonLabel(season)}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {phases.length === 0 ? (
          <div className="text-sm text-text-muted">Nessuna fase con squadre reali disponibile per questa stagione.</div>
        ) : phaseSections.length > 0 ? (
          <div className="space-y-6">
            {phaseSections.map((section) => (
              <TeamSection
                key={section.key}
                section={section}
                panelIndex={panelIndex}
                onSelectTeam={selectTeam}
                compact={compactDensity}
              />
            ))}
          </div>
        ) : phaseTeams.length === 0 && phaseStandings.length === 0 ? (
          <div className="text-sm text-text-muted">Nessuna squadra disponibile per questa fase.</div>
        ) : (
          <TeamCardGrid
            panelIndex={panelIndex}
            onSelectTeam={selectTeam}
            teams={phaseTeams}
            standings={phaseStandings}
            compact={compactDensity}
          />
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-col gap-2 mb-4">
        <h2 className="text-lg font-bold text-text-primary">{leagueName}</h2>
        <div style={{ width: `${seasonControlWidth}px` }}>
          <label className="block text-xs text-text-muted uppercase tracking-wide mb-1">
            Stagione
          </label>
          <select
            value={seasonId ?? ''}
            onChange={(e) => handleSeasonChange(e.target.value)}
            className="w-full h-8 bg-surface border border-border rounded-lg px-2.5 text-xs text-text-primary focus:outline-none focus:border-neon"
          >
            {seasons.map((season) => (
              <option key={season.id} value={season.id}>
                {getSeasonLabel(season)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <TeamCardGrid
        panelIndex={panelIndex}
        onSelectTeam={selectTeam}
        standings={teams}
        compact={compactDensity}
      />
    </div>
  );
}
