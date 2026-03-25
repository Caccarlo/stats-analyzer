import { useState, useEffect } from 'react';
import { useNavigation } from '@/context/NavigationContext';
import { getTournamentSeasons, getSeasonStandings } from '@/api/sofascore';
import type { StandingRow } from '@/types';

interface SidebarTeamListProps {
  leagueId: number;
}

export default function SidebarTeamList({ leagueId }: SidebarTeamListProps) {
  const { selectTeam } = useNavigation();
  const [teams, setTeams] = useState<StandingRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        const seasons = await getTournamentSeasons(leagueId);
        if (cancelled || !seasons.length) return;
        const standings = await getSeasonStandings(leagueId, seasons[0].id);
        if (!cancelled) {
          setTeams(standings.sort((a, b) => a.team.name.localeCompare(b.team.name)));
        }
      } catch {
        // silently fail
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [leagueId]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-4 py-3 text-text-muted text-sm">
        <div className="w-3 h-3 border-2 border-neon border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="py-1">
      {teams.map((row) => (
        <button
          key={row.team.id}
          onClick={() => selectTeam(0, row.team.id, row.team.name)}
          className="w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors text-left text-text-secondary hover:text-text-primary hover:bg-surface-hover border-l-2 border-transparent"
        >
          <span className="font-mono text-xs w-5 text-center opacity-60">
            {row.team.nameCode ?? row.team.name.substring(0, 2).toUpperCase()}
          </span>
          <span className="font-medium">{row.team.name}</span>
        </button>
      ))}
    </div>
  );
}
