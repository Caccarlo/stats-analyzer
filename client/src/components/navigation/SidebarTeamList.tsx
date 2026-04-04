import { useMemo } from 'react';
import { useNavigation } from '@/context/NavigationContext';
import { useTournamentViewData } from '@/hooks/useTournamentViewData';
import type { Team } from '@/types';

interface SidebarTeamListProps {
  leagueId: number;
}

export default function SidebarTeamList({ leagueId }: SidebarTeamListProps) {
  const { state, selectTeam } = useNavigation();
  const panel = state.panels[0];
  const { mode, teams, phases, loading } = useTournamentViewData(leagueId, panel?.seasonId);

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
