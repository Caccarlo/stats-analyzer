import { useState, useRef, useEffect } from 'react';
import { searchPlayers, getPlayerImageUrl } from '@/api/sofascore';
import { useNavigation } from '@/context/NavigationContext';
import type { SearchResult } from '@/types';

export default function SearchBar({ panelIndex = 0 }: { panelIndex?: number }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { selectPlayer } = useNavigation();

  // Debounce search
  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      setOpen(false);
      return;
    }

    setLoading(true);
    timerRef.current = setTimeout(async () => {
      try {
        const res = await searchPlayers(query.trim());
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
    selectPlayer(panelIndex, result.entity.id, result.entity);
    setQuery('');
    setOpen(false);
  };

  const positionLabels: Record<string, string> = {
    G: 'Portiere',
    D: 'Difensore',
    M: 'Centrocampista',
    F: 'Attaccante',
  };

  return (
    <div ref={containerRef} className="relative w-full max-w-md">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Cerca un giocatore..."
        className="w-full bg-surface border border-border rounded-lg px-4 py-2.5 text-text-primary placeholder:text-text-muted focus:outline-none focus:border-neon transition-colors"
      />
      {loading && (
        <div className="absolute right-3 top-3">
          <div className="w-4 h-4 border-2 border-neon border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {open && results.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-surface border border-border rounded-lg shadow-xl z-50 max-h-80 overflow-y-auto">
          {results.map((r) => (
            <button
              key={r.entity.id}
              onClick={() => handleSelect(r)}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-hover transition-colors text-left"
            >
              <img
                src={getPlayerImageUrl(r.entity.id)}
                alt=""
                className="w-10 h-10 rounded-full bg-border object-cover"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
              <div className="flex-1 min-w-0">
                <p className="text-text-primary font-medium truncate">{r.entity.name}</p>
                <p className="text-text-muted text-sm truncate">
                  {r.entity.team?.name ?? ''}
                  {r.entity.position ? ` · ${positionLabels[r.entity.position] ?? r.entity.position}` : ''}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}

      {open && results.length === 0 && !loading && query.trim().length >= 2 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-surface border border-border rounded-lg p-4 text-text-muted text-sm z-50">
          Nessun giocatore trovato
        </div>
      )}
    </div>
  );
}
