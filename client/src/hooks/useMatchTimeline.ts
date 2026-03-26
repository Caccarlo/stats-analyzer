import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { getPlayerEvents } from '@/api/sofascore';
import { fetchMatchDetails, matchDetailsCache } from '@/hooks/useMatchDetails';
import type { CachedMatchDetails } from '@/hooks/useMatchDetails';
import type { MatchEvent } from '@/types';

export interface UseMatchTimelineResult {
  filteredEvents: MatchEvent[];
  selectedEventIds: Set<number>;
  detailsMap: Map<number, CachedMatchDetails>;
  detailsLoadedIds: Set<number>;
  loadingEvents: boolean;
  toggleMatch: (eventId: number) => void;
  deselectMatch: (eventId: number) => void;
}

export function useMatchTimeline(
  playerId: number,
  selectedTournamentIds: Set<number>,
  validSeasonIds: Set<number>,
): UseMatchTimelineResult {
  const [allEvents, setAllEvents] = useState<MatchEvent[]>([]);
  const [selectedEventIds, setSelectedEventIds] = useState<Set<number>>(new Set());
  const [detailsMap, setDetailsMap] = useState<Map<number, CachedMatchDetails>>(new Map());
  const [loadingEvents, setLoadingEvents] = useState(true);

  // Use ref for tracking loaded details to avoid stale closures
  const loadedIdsRef = useRef<Set<number>>(new Set());
  const preSelectedRef = useRef(false);

  // Serialize validSeasonIds for stable dependency comparison
  const seasonIdsKey = useMemo(
    () => [...validSeasonIds].sort().join(','),
    [validSeasonIds],
  );

  // ── Load event pages, stopping once past the current season ──
  useEffect(() => {
    // Don't load until we know which seasons are valid
    if (validSeasonIds.size === 0) return;

    let cancelled = false;
    preSelectedRef.current = false;
    loadedIdsRef.current = new Set();
    setAllEvents([]);
    setSelectedEventIds(new Set());
    setDetailsMap(new Map());
    setLoadingEvents(true);

    async function loadPages() {
      let page = 0;
      let accumulated: MatchEvent[] = [];
      let hasMore = true;

      while (hasMore && !cancelled) {
        try {
          const { events: pageEvents, hasNextPage } = await getPlayerEvents(playerId, page);
          if (cancelled) return;

          // Keep only completed matches from valid seasons
          const relevant = pageEvents.filter(
            (e) => e.status?.code === 100 && validSeasonIds.has(e.season?.id),
          );
          accumulated = [...accumulated, ...relevant];

          // If this page had events but none matched our season, we've gone past it — stop
          if (pageEvents.length > 0 && relevant.length === 0) break;

          hasMore = hasNextPage;
          page++;
        } catch {
          break;
        }
      }

      if (!cancelled) {
        setAllEvents(accumulated);
        setLoadingEvents(false);
      }
    }

    loadPages();
    return () => { cancelled = true; };
  }, [playerId, seasonIdsKey]);

  // ── Filtered events by selected tournaments (derived) ──
  const filteredEvents = useMemo(() => {
    if (selectedTournamentIds.size === 0) return allEvents;
    return allEvents.filter((e) =>
      selectedTournamentIds.has(e.tournament?.uniqueTournament?.id),
    );
  }, [allEvents, selectedTournamentIds]);

  // ── Pre-select last N matches after initial load ──
  useEffect(() => {
    if (preSelectedRef.current || filteredEvents.length === 0 || loadingEvents) return;
    preSelectedRef.current = true;

    const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
    const count = isMobile ? 1 : 3;
    const initialIds = new Set(filteredEvents.slice(0, count).map((e) => e.id));
    setSelectedEventIds(initialIds);
  }, [filteredEvents, loadingEvents]);

  // ── Prune selection when filters remove events ──
  useEffect(() => {
    const validIds = new Set(filteredEvents.map((e) => e.id));
    setSelectedEventIds((prev) => {
      const pruned = new Set([...prev].filter((id) => validIds.has(id)));
      if (pruned.size === prev.size) return prev;
      return pruned;
    });
  }, [filteredEvents]);

  // ── Progressive detail loading ──
  useEffect(() => {
    if (filteredEvents.length === 0) return;

    let cancelled = false;

    async function loadAllDetails() {
      const eventIds = filteredEvents.map((e) => e.id);

      for (let i = 0; i < eventIds.length; i += 3) {
        if (cancelled) return;
        const batch = eventIds.slice(i, i + 3);
        const batchResults: { eventId: number; result: CachedMatchDetails }[] = [];

        await Promise.all(
          batch.map(async (eventId) => {
            if (loadedIdsRef.current.has(eventId)) return;

            const key = `${eventId}-${playerId}`;
            if (matchDetailsCache.has(key)) {
              const cached = matchDetailsCache.get(key)!;
              loadedIdsRef.current.add(eventId);
              batchResults.push({ eventId, result: cached });
              return;
            }

            try {
              const result = await fetchMatchDetails(eventId, playerId);
              if (cancelled) return;
              loadedIdsRef.current.add(eventId);
              batchResults.push({ eventId, result });
            } catch { /* skip failed */ }
          }),
        );

        if (cancelled) return;

        if (batchResults.length > 0) {
          setDetailsMap((prev) => {
            const next = new Map(prev);
            for (const { eventId, result } of batchResults) {
              next.set(eventId, result);
            }
            return next;
          });
        }

        if (i + 3 < eventIds.length) {
          await new Promise((r) => setTimeout(r, 300));
        }
      }
    }

    loadAllDetails();
    return () => { cancelled = true; };
  }, [filteredEvents, playerId]);

  // ── Derived: loaded IDs set for rendering ──
  const detailsLoadedIds = useMemo(
    () => new Set(detailsMap.keys()),
    [detailsMap],
  );

  // ── Actions ──
  const toggleMatch = useCallback((eventId: number) => {
    setSelectedEventIds((prev) => {
      const next = new Set(prev);
      if (next.has(eventId)) {
        next.delete(eventId);
      } else {
        next.add(eventId);
      }
      return next;
    });
  }, []);

  const deselectMatch = useCallback((eventId: number) => {
    setSelectedEventIds((prev) => {
      const next = new Set(prev);
      next.delete(eventId);
      return next;
    });
  }, []);

  return {
    filteredEvents,
    selectedEventIds,
    detailsMap,
    detailsLoadedIds,
    loadingEvents,
    toggleMatch,
    deselectMatch,
  };
}
