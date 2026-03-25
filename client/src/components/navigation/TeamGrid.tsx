import { useState, useEffect } from 'react';
import { useNavigation } from '@/context/NavigationContext';
import { getTournamentSeasons, getSeasonStandings, getTeamImageUrl } from '@/api/sofascore';
import type { StandingRow } from '@/types';
import { COUNTRIES } from './CountryList';

interface TeamGridProps {
  leagueId: number;
}

export default function TeamGrid({ leagueId }: TeamGridProps) {
  const { selectTeam } = useNavigation();
  const [teams, setTeams] = useState<StandingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Find league name
  const leagueName = COUNTRIES
    .flatMap((c) => c.leagues)
    .find((l) => l.id === leagueId)?.name ?? 'Campionato';

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const seasons = await getTournamentSeasons(leagueId);
        if (cancelled || !seasons.length) return;

        const standings = await getSeasonStandings(leagueId, seasons[0].id);
        if (!cancelled) setTeams(standings);
      } catch (e: any) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [leagueId]);

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

  return (
    <div>
      <h2 className="text-lg font-bold text-text-primary mb-4">{leagueName}</h2>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {teams.map((row) => (
          <button
            key={row.team.id}
            onClick={() => selectTeam(0, row.team.id, row.team.name)}
            className="relative flex flex-col items-center gap-2 bg-surface border border-border rounded-lg p-4 hover:border-neon transition-colors"
          >
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
            <img
              src={getTeamImageUrl(row.team.id)}
              alt=""
              className="w-12 h-12 object-contain"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
            <span className="text-text-primary text-sm font-medium text-center leading-tight">
              {row.team.name}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
