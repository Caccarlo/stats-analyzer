import { useState, useEffect, useCallback, useRef } from 'react';
import type { TournamentSeason, PlayerSeasonStats, AggregatedStats } from '@/types';
import { getPlayerSeasons, getPlayerSeasonStats } from '@/api/sofascore';
import { calculateStats } from '@/utils/statsCalculator';

export type SelectedPeriod =
  | { type: 'last'; count: 5 | 10 | 15 | 20 | 30 }
  | { type: 'season'; year: string };

interface SelectedTournament {
  tournamentId: number;
  tournamentName: string;
  seasonId: number;
  seasonName: string;
}

interface PlayerDataResult {
  tournamentSeasons: TournamentSeason[];
  availableSeasonYears: string[];
  selectedPeriod: SelectedPeriod;
  setSelectedPeriod: (p: SelectedPeriod) => void;
  currentSeasonYear: string;
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
  showCards: boolean;
  setShowCards: (v: boolean) => void;
  showStartersOnly: boolean;
  setShowStartersOnly: (v: boolean) => void;
  committedLine: number;
  setCommittedLine: (v: number) => void;
  sufferedLine: number;
  setSufferedLine: (v: number) => void;
  stats: AggregatedStats | null;
  statsByTournament: Map<number, PlayerSeasonStats>;
  loading: boolean;
  error: string | null;
}

export function usePlayerData(playerId: number | null): PlayerDataResult {
  const [tournamentSeasons, setTournamentSeasons] = useState<TournamentSeason[]>([]);
  const [selectedPeriod, setSelectedPeriod] = useState<SelectedPeriod>({ type: 'season', year: '' });
  const [enabledTournaments, setEnabledTournaments] = useState<Set<number>>(new Set());
  const [statsByTournament, setStatsByTournament] = useState<Map<number, PlayerSeasonStats>>(new Map());
  const [showCommitted, setShowCommitted] = useState(true);
  const [showSuffered, setShowSuffered] = useState(true);
  const [showHome, setShowHome] = useState(true);
  const [showAway, setShowAway] = useState(true);
  const [showCards, setShowCards] = useState(false);
  const [showStartersOnly, setShowStartersOnly] = useState(false);
  const [committedLine, setCommittedLine] = useState(0.5);
  const [sufferedLine, setSufferedLine] = useState(0.5);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cache = useRef<Map<string, PlayerSeasonStats>>(new Map());

  // All season years available for this player, sorted descending
  const availableSeasonYears = Array.from(
    new Set(tournamentSeasons.flatMap((ts) => ts.seasons.map((s) => s.year)))
  ).sort().reverse();

  // The season year to use for tournament/season lookups.
  // When period is 'last', we always use the most recent available season.
  const currentSeasonYear =
    selectedPeriod.type === 'season'
      ? selectedPeriod.year
      : availableSeasonYears[0] ?? '';

  useEffect(() => {
    if (availableSeasonYears.length === 0) return;

    setSelectedPeriod((prev) => {
      if (prev.type === 'season' && availableSeasonYears.includes(prev.year)) {
        return prev;
      }
      return { type: 'season', year: availableSeasonYears[0] };
    });
  }, [availableSeasonYears]);

  // Tournaments available for the current season year
  const tournamentsForSeason = tournamentSeasons
    .map((ts) => {
      const season = ts.seasons.find((s) => s.year === currentSeasonYear);
      if (!season) return null;
      return {
        tournamentId: ts.uniqueTournament.id,
        tournamentName: ts.uniqueTournament.name,
        seasonId: season.id,
        seasonName: season.name,
      };
    })
    .filter((x): x is SelectedTournament => x !== null);

  // Load player seasons
  useEffect(() => {
    if (!playerId) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    getPlayerSeasons(playerId)
      .then((ts) => {
        if (cancelled) return;
        setTournamentSeasons(ts);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [playerId]);

  // When season changes, enable all tournaments for that season
  useEffect(() => {
    setEnabledTournaments(new Set(tournamentsForSeason.map((t) => t.tournamentId)));
  }, [currentSeasonYear, tournamentSeasons.length]);

  // Load stats for each tournament in the current season
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
  }, [playerId, currentSeasonYear, tournamentsForSeason.length]);

  // Aggregate stats (only enabled tournaments)
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

  const selectedTournaments = tournamentsForSeason.filter((t) =>
    enabledTournaments.has(t.tournamentId)
  );

  return {
    tournamentSeasons,
    availableSeasonYears,
    selectedPeriod,
    setSelectedPeriod,
    currentSeasonYear,
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
    showStartersOnly,
    setShowStartersOnly,
    committedLine,
    setCommittedLine,
    sufferedLine,
    setSufferedLine,
    stats,
    statsByTournament,
    loading,
    error,
  };
}
