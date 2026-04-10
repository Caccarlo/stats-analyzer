import { useState, useRef, useEffect } from 'react';
import { searchAll, getPlayerImageUrl, getTeamImageUrl, getTournamentImageUrl } from '@/api/sofascore';
import { useNavigation } from '@/context/NavigationContext';
import type { SearchResult } from '@/types';

interface SearchBarProps {
  panelIndex?: number;
  compact?: boolean;
}

export default function SearchBar({ panelIndex = 0, compact = false }: SearchBarProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { navigateTo } = useNavigation();

  // Debounce search
  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      setOpen(false);
      setLoading(false);
      return;
    }

    setLoading(true);
    timerRef.current = setTimeout(async () => {
      try {
        const res = await searchAll(query.trim());
        setResults(res.slice(0, 10));
        setOpen(true);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 500);

    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
    };
  }, [query]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleSelect = (result: SearchResult) => {
    switch (result.type) {
      case 'player':
        navigateTo(panelIndex, 'player', {
          playerId: result.entity.id,
          playerData: result.entity,
          teamId: result.entity.team?.id,
          teamName: result.entity.team?.name,
          leagueId: undefined,
          leagueName: undefined,
          seasonId: undefined,
          countryId: undefined,
          countryName: undefined,
          countryCategoryId: undefined,
          tournamentPhaseKey: undefined,
          tournamentPhaseName: undefined,
        });
        break;
      case 'team':
        navigateTo(panelIndex, 'team', {
          teamId: result.entity.id,
          teamName: result.entity.name,
          leagueId: undefined,
          leagueName: undefined,
          seasonId: undefined,
          countryId: undefined,
          countryName: undefined,
          countryCategoryId: undefined,
          tournamentPhaseKey: undefined,
          tournamentPhaseName: undefined,
          playerId: undefined,
          playerData: undefined,
        });
        break;
      case 'uniqueTournament':
        navigateTo(panelIndex, 'teams', {
          leagueId: result.entity.id,
          leagueName: result.entity.name,
          countryId: result.entity.category?.alpha2 ?? String(result.entity.category?.id ?? ''),
          countryName: result.entity.category?.name,
          countryCategoryId: result.entity.category?.id,
          tournamentPhaseKey: undefined,
          tournamentPhaseName: undefined,
          seasonId: undefined,
          teamId: undefined,
          teamName: undefined,
          playerId: undefined,
          playerData: undefined,
        });
        break;
    }
    setQuery('');
    setOpen(false);
  };

  const positionLabels: Record<string, string> = {
    G: 'Portiere',
    D: 'Difensore',
    M: 'Centrocampista',
    F: 'Attaccante',
  };

  function getResultMeta(result: SearchResult): { badge: string; detail: string } {
    switch (result.type) {
      case 'player':
        return {
          badge: 'Giocatore',
          detail: [
            result.entity.team?.name,
            result.entity.position
              ? positionLabels[result.entity.position] ?? result.entity.position
              : undefined,
          ]
            .filter(Boolean)
            .join(' · '),
        };
      case 'team':
        return { badge: 'Squadra', detail: result.entity.nameCode ?? '' };
      case 'uniqueTournament':
        return {
          badge: 'Competizione',
          detail: result.entity.category?.name ?? '',
        };
    }
  }

  function getResultImageUrl(result: SearchResult): string {
    switch (result.type) {
      case 'player':          return getPlayerImageUrl(result.entity.id);
      case 'team':            return getTeamImageUrl(result.entity.id);
      case 'uniqueTournament': return getTournamentImageUrl(result.entity.id);
    }
  }

  return (
    <div ref={containerRef} className={`relative w-full max-w-none ${compact ? 'md:max-w-none' : 'md:max-w-md'}`}>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Cerca giocatore, squadra o competizione..."
        className={`w-full bg-surface border border-border rounded-lg text-text-primary placeholder:text-text-muted focus:outline-none focus:border-neon transition-colors ${
          compact ? 'px-3.5 py-2 text-sm' : 'px-4 py-2.5'
        }`}
      />
      {loading && (
        <div className={`absolute right-3 ${compact ? 'top-2.5' : 'top-3'}`}>
          <div className="w-4 h-4 border-2 border-neon border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {open && results.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-surface border border-border rounded-lg shadow-xl z-50 max-h-80 overflow-y-auto">
          {results.map((r) => {
            const meta = getResultMeta(r);
            const imgClass = r.type === 'player'
              ? 'w-10 h-10 rounded-full bg-border object-cover flex-shrink-0'
              : 'w-10 h-10 rounded bg-border object-cover flex-shrink-0';
            return (
              <button
                key={`${r.type}-${r.entity.id}`}
                onClick={() => handleSelect(r)}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-hover transition-colors text-left"
              >
                <img
                  src={getResultImageUrl(r)}
                  alt=""
                  className={imgClass}
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-text-primary font-medium truncate">{r.entity.name}</p>
                    <span className="text-xs text-text-muted bg-surface-hover px-1.5 py-0.5 rounded shrink-0">
                      {meta.badge}
                    </span>
                  </div>
                  {meta.detail && (
                    <p className="text-text-muted text-sm truncate">{meta.detail}</p>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {open && results.length === 0 && !loading && query.trim().length >= 2 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-surface border border-border rounded-lg p-4 text-text-muted text-sm z-50">
          Nessun risultato trovato
        </div>
      )}
    </div>
  );
}
