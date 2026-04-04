import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigation } from '@/context/NavigationContext';
import { getSeasonStandings, getTeamImageUrl, getTournamentSeasonEvents, getTournamentSeasons } from '@/api/sofascore';
import { buildTournamentPhases, isPhaseBasedCompetition } from '@/utils/tournamentPhases';
import type { StandingRow, Team, TournamentPhase } from '@/types';

interface TeamGridProps {
  leagueId: number;
  panelIndex?: number;
}

type CompetitionMode = 'standings' | 'phases';

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Errore nel caricamento delle squadre';
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
      className="relative flex flex-col items-center gap-2 bg-surface border border-border rounded-lg p-4 hover:border-neon transition-colors"
    >
      {badge}
      <img
        src={getTeamImageUrl(team.id)}
        alt=""
        className="w-12 h-12 object-contain"
        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
      />
      <span className="text-text-primary text-sm font-medium text-center leading-tight">
        {team.name}
      </span>
    </button>
  );
}

export default function TeamGrid({ leagueId, panelIndex = 0 }: TeamGridProps) {
  const { state, selectTeam, navigateTo } = useNavigation();
  const panel = state.panels[panelIndex];
  const [mode, setMode] = useState<CompetitionMode>('standings');
  const [teams, setTeams] = useState<StandingRow[]>([]);
  const [phases, setPhases] = useState<TournamentPhase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const leagueName = panel?.leagueName ?? 'Campionato';

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const seasons = await getTournamentSeasons(leagueId);
        if (cancelled || !seasons.length) {
          if (!cancelled) {
            setTeams([]);
            setPhases([]);
            setMode('standings');
            setLoading(false);
          }
          return;
        }

        const currentSeason = seasons[0];
        const events = await getTournamentSeasonEvents(leagueId, currentSeason.id);
        const derivedPhases = buildTournamentPhases(events);
        const usePhaseMode = isPhaseBasedCompetition(derivedPhases);

        if (cancelled) return;

        if (panel?.seasonId !== currentSeason.id) {
          navigateTo(panelIndex, 'teams', { seasonId: currentSeason.id });
        }

        if (usePhaseMode) {
          setMode('phases');
          setPhases(derivedPhases);
          setTeams([]);
          setLoading(false);
          return;
        }

        try {
          const standings = await getSeasonStandings(leagueId, currentSeason.id);
          if (!cancelled) {
            setMode('standings');
            setTeams(standings);
            setPhases([]);
            setLoading(false);
          }
        } catch (standingsError) {
          if (!cancelled && derivedPhases.length > 0) {
            setMode('phases');
            setPhases(derivedPhases);
            setTeams([]);
            setLoading(false);
            return;
          }
          throw standingsError;
        }
      } catch (e: unknown) {
        if (!cancelled) {
          setError(getErrorMessage(e));
          setLoading(false);
        }
      }
    })();

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId, panel?.seasonId, panelIndex]);

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

    return (
      <div>
        <div className="flex flex-col gap-3 mb-4">
          <h2 className="text-lg font-bold text-text-primary">{leagueName}</h2>
          <div className="max-w-sm">
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
        </div>

        {phaseTeams.length === 0 ? (
          <div className="text-sm text-text-muted">Nessuna squadra disponibile per questa fase.</div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {phaseTeams.map((team) => (
              <TeamCard
                key={team.id}
                team={team}
                onClick={() => selectTeam(panelIndex, team.id, team.name)}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-lg font-bold text-text-primary mb-4">{leagueName}</h2>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {teams.map((row) => (
          <TeamCard
            key={row.team.id}
            team={row.team}
            onClick={() => selectTeam(panelIndex, row.team.id, row.team.name)}
            badge={(
              <>
                <span className="absolute top-1.5 left-2 text-xs text-text-muted/70 font-medium">
                  {row.position}.
                </span>
                <div className="absolute top-1.5 right-2 text-right leading-none">
                  <span className="text-[11px] text-text-muted/70 font-medium">
                    {row.points} pts
                  </span>
                  <br />
                  <span className="text-[10px] text-text-muted/60">
                    {row.matches} pg
                  </span>
                </div>
              </>
            )}
          />
        ))}
      </div>
    </div>
  );
}
