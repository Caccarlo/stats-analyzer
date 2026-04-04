import { useEffect, useMemo, type ReactNode } from 'react';
import { useNavigation } from '@/context/NavigationContext';
import { getTeamImageUrl } from '@/api/sofascore';
import { useTournamentViewData } from '@/hooks/useTournamentViewData';
import type { Season, StandingRow, Team, TournamentPhaseSection } from '@/types';

interface TeamGridProps {
  leagueId: number;
  panelIndex?: number;
}

function TeamCard({
  team,
  onClick,
  badge,
}: {
  team: Team;
  onClick: () => void;
  badge?: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="relative flex flex-col items-center gap-1.5 px-3.5 py-2.5 bg-surface border border-border rounded-lg hover:border-neon transition-colors"
    >
      {badge}
      <img
        src={getTeamImageUrl(team.id)}
        alt=""
        className="w-9 h-9 object-contain"
        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
      />
      <span className="text-text-primary text-[10.5px] font-medium text-center leading-tight">
        {team.name}
      </span>
    </button>
  );
}

function StandingBadge({ row }: { row: StandingRow }) {
  return (
    <>
      <span className="absolute top-1.5 left-1.5 text-[10px] text-text-muted/70 font-medium">
        {row.position}.
      </span>
      <div className="absolute top-1.5 right-1.5 text-right leading-none">
        <span className="text-[10px] text-text-muted/70 font-medium">
          {row.points} pts
        </span>
        <br />
        <span className="text-[9px] text-text-muted/60">
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
}: {
  panelIndex: number;
  onSelectTeam: (panel: number, teamId: number, teamName?: string) => void;
  teams?: Team[];
  standings?: StandingRow[];
}) {
  if (standings.length > 0) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {standings.map((row) => (
          <TeamCard
            key={row.team.id}
            team={row.team}
            onClick={() => onSelectTeam(panelIndex, row.team.id, row.team.name)}
            badge={<StandingBadge row={row} />}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
      {teams.map((team) => (
        <TeamCard
          key={team.id}
          team={team}
          onClick={() => onSelectTeam(panelIndex, team.id, team.name)}
        />
      ))}
    </div>
  );
}

function TeamSection({
  section,
  panelIndex,
  onSelectTeam,
}: {
  section: TournamentPhaseSection;
  panelIndex: number;
  onSelectTeam: (panel: number, teamId: number, teamName?: string) => void;
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
      />
    </section>
  );
}

export default function TeamGrid({ leagueId, panelIndex = 0 }: TeamGridProps) {
  const { state, selectTeam, navigateTo } = useNavigation();
  const panel = state.panels[panelIndex];
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
    return phases.find((phase) => phase.key === phaseKey) ?? phases[0];
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
        <div className="flex flex-col gap-3 mb-4">
          <h2 className="text-lg font-bold text-text-primary">{leagueName}</h2>
          <div className="flex flex-col gap-3 md:flex-row md:items-end">
            {phases.length > 0 && (
              <div className="md:flex-1 md:max-w-xs">
                <label className="block text-xs text-text-muted uppercase tracking-wide mb-1.5">
                  Fase
                </label>
                <select
                  value={selectedPhase?.key ?? ''}
                  onChange={(e) => handlePhaseChange(e.target.value)}
                  className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-neon"
                >
                  {phases.map((phase) => (
                    <option key={phase.key} value={phase.key}>
                      {phase.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="md:w-52">
              <label className="block text-xs text-text-muted uppercase tracking-wide mb-1.5">
                Stagione
              </label>
              <select
                value={seasonId ?? ''}
                onChange={(e) => handleSeasonChange(e.target.value)}
                className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-neon"
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
          />
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-col gap-3 mb-4 sm:flex-row sm:items-end sm:justify-between">
        <h2 className="text-lg font-bold text-text-primary">{leagueName}</h2>
        <div className="sm:w-52">
          <label className="block text-xs text-text-muted uppercase tracking-wide mb-1.5">
            Stagione
          </label>
          <select
            value={seasonId ?? ''}
            onChange={(e) => handleSeasonChange(e.target.value)}
            className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-neon"
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
      />
    </div>
  );
}
