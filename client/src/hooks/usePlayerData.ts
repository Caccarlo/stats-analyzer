/* eslint-disable react-hooks/set-state-in-effect */
import { useState, useEffect, useCallback, useRef } from 'react';
import type { TournamentSeason, PlayerSeasonStats, AggregatedStats, PlayerFilterState, SelectedPeriod } from '@/types';
import { getPlayerSeasons, getPlayerSeasonStats } from '@/api/sofascore';
import { calculateStats } from '@/utils/statsCalculator';

export type { SelectedPeriod };

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
  enabledTournaments: Set<number>;
  selectedTournaments: SelectedTournament[];
  toggleTournament: (tournamentId: number) => void;
  showCommitted: boolean;
  setShowCommitted: (v: boolean) => void;
  showSuffered: boolean;
  setShowSuffered: (v: boolean) => void;
  showShots: boolean;
  setShowShots: (v: boolean) => void;
  showShotsOnTarget: boolean;
  setShowShotsOnTarget: (v: boolean) => void;
  showHome: boolean;
  setShowHome: (v: boolean) => void;
  showAway: boolean;
  setShowAway: (v: boolean) => void;
  showCards: boolean;
  setShowCards: (v: boolean) => void;
  showStartersOnly: boolean;
  setShowStartersOnly: (v: boolean) => void;
  ensureTournamentsEnabled: (ids: Set<number>) => void;
  committedLine: number;
  setCommittedLine: (v: number) => void;
  sufferedLine: number;
  setSufferedLine: (v: number) => void;
  shotsLine: number;
  setShotsLine: (v: number) => void;
  shotsOnTargetLine: number;
  setShotsOnTargetLine: (v: number) => void;
  stats: AggregatedStats | null;
  statsByTournament: Map<number, PlayerSeasonStats>;
  loading: boolean;
  error: string | null;
}

export function usePlayerData(
  playerId: number | null,
  initialFilterState?: PlayerFilterState,
  onFiltersChange?: (s: PlayerFilterState) => void,
): PlayerDataResult {
  const [tournamentSeasons, setTournamentSeasons] = useState<TournamentSeason[]>([]);
  const [selectedPeriod, setSelectedPeriod] = useState<SelectedPeriod>(
    () => initialFilterState?.selectedPeriod ?? { type: 'season', year: '' },
  );
  const [enabledTournaments, setEnabledTournaments] = useState<Set<number>>(
    () => initialFilterState?.enabledTournaments ?? new Set(),
  );
  const tournamentsLoaded = useRef(false);
  const [statsByTournament, setStatsByTournament] = useState<Map<number, PlayerSeasonStats>>(new Map());
  const [showCommitted, setShowCommitted] = useState(() => initialFilterState?.showCommitted ?? true);
  const [showSuffered, setShowSuffered] = useState(() => initialFilterState?.showSuffered ?? true);
  const [showShots, setShowShots] = useState(() => initialFilterState?.showShots ?? true);
  const [showShotsOnTarget, setShowShotsOnTarget] = useState(() => initialFilterState?.showShotsOnTarget ?? false);
  const [showHome, setShowHome] = useState(() => initialFilterState?.showHome ?? true);
  const [showAway, setShowAway] = useState(() => initialFilterState?.showAway ?? true);
  const [showCards, setShowCards] = useState(() => initialFilterState?.showCards ?? false);
  const [showStartersOnly, setShowStartersOnly] = useState(() => initialFilterState?.showStartersOnly ?? false);
  const [committedLine, setCommittedLine] = useState(() => initialFilterState?.committedLine ?? 0.5);
  const [sufferedLine, setSufferedLine] = useState(() => initialFilterState?.sufferedLine ?? 0.5);
  const [shotsLine, setShotsLine] = useState(() => initialFilterState?.shotsLine ?? 0.5);
  const [shotsOnTargetLine, setShotsOnTargetLine] = useState(() => initialFilterState?.shotsOnTargetLine ?? 0.5);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cache = useRef<Map<string, PlayerSeasonStats>>(new Map());
  const onFiltersChangeRef = useRef(onFiltersChange);

  useEffect(() => {
    onFiltersChangeRef.current = onFiltersChange;
  }, [onFiltersChange]);

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
      if (prev.type === 'last') {
        return prev;
      }
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

  // When season changes (or period type switches), enable all relevant tournaments.
  // On the very first load, skip auto-enable if we restored saved tournament state.
  useEffect(() => {
    if (tournamentSeasons.length === 0) return;

    const justLoaded = !tournamentsLoaded.current;
    if (justLoaded) tournamentsLoaded.current = true;
    if (justLoaded && initialFilterState?.enabledTournaments?.size) return;

    if (selectedPeriod.type === 'last') {
      const allIds = new Set(tournamentSeasons.map((ts) => ts.uniqueTournament.id));
      setEnabledTournaments(allIds);
    } else {
      setEnabledTournaments(new Set(tournamentsForSeason.map((t) => t.tournamentId)));
    }
  }, [currentSeasonYear, tournamentSeasons.length, selectedPeriod.type]);

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

  // Persist filter state to NavigationContext whenever it changes
  useEffect(() => {
    onFiltersChangeRef.current?.({
      selectedPeriod,
      enabledTournaments,
      showCommitted,
      showSuffered,
      showShots,
      showShotsOnTarget,
      showHome,
      showAway,
      showCards,
      showStartersOnly,
      committedLine,
      sufferedLine,
      shotsLine,
      shotsOnTargetLine,
    });
  }, [selectedPeriod, enabledTournaments, showCommitted, showSuffered, showShots, showShotsOnTarget, showHome, showAway, showCards, showStartersOnly, committedLine, sufferedLine, shotsLine, shotsOnTargetLine]);

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

  const ensureTournamentsEnabled = useCallback((ids: Set<number>) => {
    setEnabledTournaments((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const id of ids) {
        if (!next.has(id)) { next.add(id); changed = true; }
      }
      return changed ? next : prev;
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
    enabledTournaments,
    selectedTournaments,
    toggleTournament,
    showCommitted,
    setShowCommitted,
    showSuffered,
    setShowSuffered,
    showShots,
    setShowShots,
    showShotsOnTarget,
    setShowShotsOnTarget,
    showHome,
    setShowHome,
    showAway,
    setShowAway,
    showCards,
    setShowCards,
    showStartersOnly,
    setShowStartersOnly,
    ensureTournamentsEnabled,
    committedLine,
    setCommittedLine,
    sufferedLine,
    setSufferedLine,
    shotsLine,
    setShotsLine,
    shotsOnTargetLine,
    setShotsOnTargetLine,
    stats,
    statsByTournament,
    loading,
    error,
  };
}
