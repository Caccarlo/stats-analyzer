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
  selectedSeasonYear: string,
): UseMatchTimelineResult {
  const [allEvents, setAllEvents] = useState<MatchEvent[]>([]);
  const [selectedEventIds, setSelectedEventIds] = useState<Set<number>>(new Set());
  const [detailsMap, setDetailsMap] = useState<Map<number, CachedMatchDetails>>(new Map());
  const [detailsLoadedIds, setDetailsLoadedIds] = useState<Set<number>>(new Set());
  const [loadingEvents, setLoadingEvents] = useState(false);

  // Track whether initial pre-selection has been done for current load
  const preSelectedRef = useRef(false);
  // Track current playerId + season to detect changes
  const loadKeyRef = useRef('');

  // ── Load ALL event pages eagerly ──
  useEffect(() => {
    const key = `${playerId}-${selectedSeasonYear}`;
    if (loadKeyRef.current === key) return;
    loadKeyRef.current = key;

    let cancelled = false;
    preSelectedRef.current = false;
    setAllEvents([]);
    setSelectedEventIds(new Set());
    setDetailsMap(new Map());
    setDetailsLoadedIds(new Set());
    setLoadingEvents(true);

    async function loadAllPages() {
      let page = 0;
      let accumulated: MatchEvent[] = [];
      let hasMore = true;

      while (hasMore && !cancelled) {
        try {
          const { events: pageEvents, hasNextPage } = await getPlayerEvents(playerId, page);
          if (cancelled) return;
          accumulated = [...accumulated, ...pageEvents];
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

    loadAllPages();
    return () => { cancelled = true; };
  }, [playerId, selectedSeasonYear]);

  // ── Filtered events (derived) ──
  const filteredEvents = useMemo(() => {
    return allEvents.filter((e) => {
      if (e.status?.code !== 100) return false;
      if (selectedTournamentIds.size === 0) return true;
      return selectedTournamentIds.has(e.tournament?.uniqueTournament?.id);
    });
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

    async function loadDetails() {
      // Priority 1: selected matches
      const selectedIds = [...selectedEventIds];
      const selectedPromises = selectedIds.map(async (eventId) => {
        if (detailsLoadedIds.has(eventId)) return;
        try {
          const result = await fetchMatchDetails(eventId, playerId);
          if (cancelled) return;
          setDetailsMap((prev) => new Map(prev).set(eventId, result));
          setDetailsLoadedIds((prev) => new Set(prev).add(eventId));
        } catch { /* skip failed */ }
      });
      await Promise.all(selectedPromises);
      if (cancelled) return;

      // Priority 2: remaining matches in batches of 3
      const remaining = filteredEvents
        .filter((e) => !detailsLoadedIds.has(e.id) && !selectedIds.includes(e.id))
        .map((e) => e.id);

      for (let i = 0; i < remaining.length; i += 3) {
        if (cancelled) return;
        const batch = remaining.slice(i, i + 3);
        const batchPromises = batch.map(async (eventId) => {
          // Re-check in case it was loaded by another path
          const key = `${eventId}-${playerId}`;
          if (matchDetailsCache.has(key)) {
            const cached = matchDetailsCache.get(key)!;
            if (!cancelled) {
              setDetailsMap((prev) => new Map(prev).set(eventId, cached));
              setDetailsLoadedIds((prev) => new Set(prev).add(eventId));
            }
            return;
          }
          try {
            const result = await fetchMatchDetails(eventId, playerId);
            if (cancelled) return;
            setDetailsMap((prev) => new Map(prev).set(eventId, result));
            setDetailsLoadedIds((prev) => new Set(prev).add(eventId));
          } catch { /* skip failed */ }
        });
        await Promise.all(batchPromises);
        if (cancelled) return;
        // Pause between batches
        if (i + 3 < remaining.length) {
          await new Promise((r) => setTimeout(r, 300));
        }
      }
    }

    loadDetails();
    return () => { cancelled = true; };
  }, [filteredEvents, selectedEventIds, playerId]);

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
