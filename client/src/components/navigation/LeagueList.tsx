import { useEffect, useState } from 'react';
import { useNavigation } from '@/context/NavigationContext';
import { getCategoryTournaments, getTournamentImageUrl } from '@/api/sofascore';
import type { Tournament } from '@/types';

interface LeagueListProps {
  panelIndex?: number;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Errore nel caricamento dei tornei';
}

export default function LeagueList({ panelIndex = 0 }: LeagueListProps) {
  const { state, selectLeague } = useNavigation();
  const panel = state.panels[panelIndex];
  const categoryId = panel?.countryCategoryId;
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!categoryId) {
      setTournaments([]);
      setError('Categoria paese non disponibile');
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const data = await getCategoryTournaments(categoryId);
        if (!cancelled) {
          setTournaments(data);
        }
      } catch (e: unknown) {
        if (!cancelled) {
          setTournaments([]);
          setError(getErrorMessage(e));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [categoryId]);

  if (!panel) return null;

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-8 text-text-muted">
        <div className="w-4 h-4 border-2 border-neon border-t-transparent rounded-full animate-spin" />
        Caricamento campionati...
      </div>
    );
  }

  if (error) {
    return <div className="text-negative text-sm">Errore: {error}</div>;
  }

  return (
    <div>
      <h2 className="text-lg font-bold text-text-primary mb-4">{panel.countryName ?? 'Paese'}</h2>
      <div className="space-y-2">
        {tournaments.map((league) => (
          <button
            key={league.id}
            onClick={() => selectLeague(panelIndex, league.id, league.name)}
            className="w-full flex items-center gap-2.5 bg-surface border border-border rounded-md p-3 hover:border-neon transition-colors text-left"
          >
            <img
              src={getTournamentImageUrl(league.id)}
              alt=""
              className="w-6 h-6 object-contain"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
            <span className="text-text-primary font-medium text-[13px] leading-tight">{league.name}</span>
          </button>
        ))}
      </div>
      {tournaments.length === 0 && (
        <div className="mt-4 text-sm text-text-muted">Nessun torneo disponibile per questa categoria.</div>
      )}
    </div>
  );
}
