import { useState, useEffect, useCallback, useRef } from 'react';
import type { TournamentSeason, PlayerSeasonStats, AggregatedStats, Season } from '@/types';
import { getPlayerSeasons, getPlayerSeasonStats } from '@/api/sofascore';
import { calculateStats } from '@/utils/statsCalculator';

interface SelectedTournament {
  tournamentId: number;
  tournamentName: string;
  seasonId: number;
  seasonName: string;
}

interface PlayerDataResult {
  tournamentSeasons: TournamentSeason[];
  availableSeasonYears: string[];
  selectedSeasonYear: string;
  setSelectedSeasonYear: (year: string) => void;
  selectedTournaments: SelectedTournament[];
  toggleTournament: (tournamentId: number) => void;
  showCommitted: boolean;
  setShowCommitted: (v: boolean) => void;
  showSuffered: boolean;
  setShowSuffered: (v: boolean) => void;
  showHome: boolean;
  setShowHome: (v: boolean) => void;
  showAway: boolean;
  setShowAway: (v: boolean) => void;
  showCards: boolean; setShowCards: (v: boolean) => void;
  stats: AggregatedStats | null;
  statsByTournament: Map<number, PlayerSeasonStats>;
  loading: boolean;
  error: string | null;
}

export function usePlayerData(playerId: number | null): PlayerDataResult {
  const [tournamentSeasons, setTournamentSeasons] = useState<TournamentSeason[]>([]);
  const [selectedSeasonYear, setSelectedSeasonYear] = useState('');
  const [enabledTournaments, setEnabledTournaments] = useState<Set<number>>(new Set());
  const [statsByTournament, setStatsByTournament] = useState<Map<number, PlayerSeasonStats>>(new Map());
  const [showCommitted, setShowCommitted] = useState(true);
  const [showSuffered, setShowSuffered] = useState(true);
  const [showHome, setShowHome] = useState(true);
  const [showAway, setShowAway] = useState(true);
  const [showCards, setShowCards] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cache = useRef<Map<string, PlayerSeasonStats>>(new Map());

  // Carica stagioni del giocatore
  useEffect(() => {
    if (!playerId) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    getPlayerSeasons(playerId)
      .then((ts) => {
        if (cancelled) return;
        setTournamentSeasons(ts);

        // Trova tutte le stagioni disponibili (per anno)
        const years = new Set<string>();
        ts.forEach((t) => t.seasons.forEach((s) => years.add(s.year)));
        const sorted = Array.from(years).sort().reverse();

        if (sorted.length > 0 && !selectedSeasonYear) {
          setSelectedSeasonYear(sorted[0]);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [playerId]);

  // Calcola quali tornei sono disponibili per la stagione selezionata
  const tournamentsForSeason = tournamentSeasons
    .map((ts) => {
      const season = ts.seasons.find((s) => s.year === selectedSeasonYear);
      if (!season) return null;
      return {
        tournamentId: ts.uniqueTournament.id,
        tournamentName: ts.uniqueTournament.name,
        seasonId: season.id,
        seasonName: season.name,
      };
    })
    .filter((x): x is SelectedTournament => x !== null);

  // Quando cambia la stagione, abilita tutti i tornei
  useEffect(() => {
    setEnabledTournaments(new Set(tournamentsForSeason.map((t) => t.tournamentId)));
  }, [selectedSeasonYear, tournamentSeasons.length]);

  // Carica stats per ogni torneo della stagione
  useEffect(() => {
    if (!playerId || tournamentsForSeason.length === 0) return;

    let cancelled = false;
    setLoading(true);

    const fetches = tournamentsForSeason.map(async (t) => {
      const key = `${playerId}-${t.tournamentId}-${t.seasonId}`;
      if (cache.current.has(key)) {
        return { tournamentId: t.tournamentId, stats: cache.current.get(key)! };
      }
      const stats = await getPlayerSeasonStats(playerId, t.tournamentId, t.seasonId);
      if (stats) cache.current.set(key, stats);
      return { tournamentId: t.tournamentId, stats };
    });

    Promise.all(fetches)
      .then((results) => {
        if (cancelled) return;
        const map = new Map<number, PlayerSeasonStats>();
        results.forEach((r) => {
          if (r.stats) map.set(r.tournamentId, r.stats);
        });
        setStatsByTournament(map);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [playerId, selectedSeasonYear, tournamentsForSeason.length]);

  // Calcola stats aggregate (solo tornei abilitati)
  const enabledStats = Array.from(statsByTournament.entries())
    .filter(([tid]) => enabledTournaments.has(tid))
    .map(([, s]) => s);

  const stats = enabledStats.length > 0 ? calculateStats(enabledStats) : null;

  const toggleTournament = useCallback((tournamentId: number) => {
    setEnabledTournaments((prev) => {
      const next = new Set(prev);
      if (next.has(tournamentId)) {
        next.delete(tournamentId);
      } else {
        next.add(tournamentId);
      }
      return next;
    });
  }, []);

  const availableSeasonYears = Array.from(
    new Set(tournamentSeasons.flatMap((ts) => ts.seasons.map((s) => s.year)))
  ).sort().reverse();

  const selectedTournaments = tournamentsForSeason.filter((t) =>
    enabledTournaments.has(t.tournamentId)
  );

  return {
    tournamentSeasons,
    availableSeasonYears,
    selectedSeasonYear,
    setSelectedSeasonYear,
    selectedTournaments,
    toggleTournament,
    showCommitted,
    setShowCommitted,
    showSuffered,
    setShowSuffered,
    showHome,
    setShowHome,
    showAway,
    setShowAway,
    showCards, 
    setShowCards,
    stats,
    statsByTournament,
    loading,
    error,
  };
}
