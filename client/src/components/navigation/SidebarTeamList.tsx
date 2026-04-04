import { useState, useEffect, useMemo } from 'react';
import { useNavigation } from '@/context/NavigationContext';
import { getSeasonStandings, getTournamentSeasonEvents, getTournamentSeasons } from '@/api/sofascore';
import { buildTournamentPhases, isPhaseBasedCompetition } from '@/utils/tournamentPhases';
import type { StandingRow, Team, TournamentPhase } from '@/types';

interface SidebarTeamListProps {
  leagueId: number;
}

type CompetitionMode = 'standings' | 'phases';

export default function SidebarTeamList({ leagueId }: SidebarTeamListProps) {
  const { state, selectTeam } = useNavigation();
  const panel = state.panels[0];
  const [mode, setMode] = useState<CompetitionMode>('standings');
  const [teams, setTeams] = useState<StandingRow[]>([]);
  const [phases, setPhases] = useState<TournamentPhase[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

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

        if (cancelled) return;

        if (isPhaseBasedCompetition(derivedPhases)) {
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
        } catch {
          if (!cancelled && derivedPhases.length > 0) {
            setMode('phases');
            setPhases(derivedPhases);
            setTeams([]);
            setLoading(false);
            return;
          }
          throw new Error('Standings non disponibili');
        }
      } catch {
        if (!cancelled) {
          setTeams([]);
          setPhases([]);
          setMode('standings');
          setLoading(false);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [leagueId]);

  const selectedPhase = useMemo(() => {
    if (mode !== 'phases' || phases.length === 0) return null;
    return phases.find((phase) => phase.key === panel?.tournamentPhaseKey) ?? phases[0];
  }, [mode, phases, panel?.tournamentPhaseKey]);

  const visibleTeams: Team[] = mode === 'phases'
    ? (selectedPhase?.teams ?? [])
    : teams.map((row) => row.team);

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-4 py-3 text-text-muted text-sm">
        <div className="w-3 h-3 border-2 border-neon border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="py-1">
      {visibleTeams.map((team) => (
        <button
          key={team.id}
          onClick={() => selectTeam(0, team.id, team.name)}
          className="w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors text-left text-text-secondary hover:text-text-primary hover:bg-surface-hover border-l-2 border-transparent"
        >
          <span className="font-mono text-xs w-5 text-center opacity-60">
            {team.nameCode ?? team.name.substring(0, 2).toUpperCase()}
          </span>
          <span className="font-medium">{team.name}</span>
        </button>
      ))}
      {!loading && visibleTeams.length === 0 && (
        <div className="px-4 py-2 text-sm text-text-muted">Nessuna squadra disponibile.</div>
      )}
    </div>
  );
}
