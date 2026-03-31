import { useState, useEffect, useMemo, useRef } from 'react';
import { getPlayerEvents } from '@/api/sofascore';
import { fetchMatchDetails, matchDetailsCache } from '@/hooks/useMatchDetails';
import type { CachedMatchDetails } from '@/hooks/useMatchDetails';
import type { MatchEvent } from '@/types';

export interface TournamentForSeason {
  tournamentId: number;
  seasonId: number;
}

export interface UseMatchTimelineResult {
  allEvents: MatchEvent[];
  detailsMap: Map<number, CachedMatchDetails>;
  detailsLoadedIds: Set<number>;
  failedIds: Set<number>;
  loadingEvents: boolean;
  initialDetailsLoaded: boolean;
}

export function useMatchTimeline(
  playerId: number,
  tournamentsForSeason: TournamentForSeason[],
): UseMatchTimelineResult {
  const [allEvents, setAllEvents] = useState<MatchEvent[]>([]);
  const [detailsMap, setDetailsMap] = useState<Map<number, CachedMatchDetails>>(new Map());
  const [failedIds, setFailedIds] = useState<Set<number>>(new Set());
  const [loadingEvents, setLoadingEvents] = useState(true);

  // Ref to track which event details have already been fetched (avoids duplicate requests)
  const loadedIdsRef = useRef<Set<number>>(new Set());

  // Derive validSeasonIds from tournamentsForSeason for event filtering
  const validSeasonIds = useMemo(
    () => new Set(tournamentsForSeason.map((t) => t.seasonId)),
    [tournamentsForSeason],
  );

  const seasonIdsKey = useMemo(
    () => [...validSeasonIds].sort().join(','),
    [validSeasonIds],
  );

  // ── Load event pages for the current season only ──
  useEffect(() => {
    if (validSeasonIds.size === 0) return;

    let cancelled = false;
    loadedIdsRef.current = new Set();
    setAllEvents([]);
    setDetailsMap(new Map());
    setFailedIds(new Set());
    setLoadingEvents(true);

    async function loadPages() {
      let page = 0;
      let accumulated: MatchEvent[] = [];
      let hasMore = true;
      // Only stop early AFTER we've found some events and then a page has none —
      // this prevents stopping too early when first pages belong to a newer season.
      let foundRelevant = false;

      while (hasMore && !cancelled) {
        try {
          const { events: pageEvents, hasNextPage } = await getPlayerEvents(playerId, page);
          if (cancelled) return;

          const relevant = pageEvents.filter(
            (e) => e.status?.code === 100 && validSeasonIds.has(e.season?.id),
          );
          accumulated = [...accumulated, ...relevant];

          if (relevant.length > 0) foundRelevant = true;

          // Stop only after we've found season events and then a page has none
          if (foundRelevant && pageEvents.length > 0 && relevant.length === 0) break;

          hasMore = hasNextPage;
          page++;
        } catch {
          break;
        }
      }

      if (!cancelled) {
        accumulated.sort((a, b) => b.startTimestamp - a.startTimestamp);
        setAllEvents(accumulated);
        setLoadingEvents(false);
      }
    }

    loadPages();
    return () => { cancelled = true; };
  }, [playerId, seasonIdsKey]);

  // ── Progressive detail loading ──
  // Critically: this runs on allEvents, NEVER on the filtered/display subset.
  // This means filter changes in PlayerPage never interrupt or restart this loop.
  useEffect(() => {
    if (allEvents.length === 0) return;

    let cancelled = false;

    async function loadAllDetails() {
      const eventIds = allEvents.map((e) => e.id);

      for (let i = 0; i < eventIds.length; i += 5) {
        if (cancelled) return;
        const batch = eventIds.slice(i, i + 5);
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
            } catch {
              // Mark as loaded so we never retry this event, and flag it as failed for the UI
              loadedIdsRef.current.add(eventId);
              setFailedIds((prev) => {
                const next = new Set(prev);
                next.add(eventId);
                return next;
              });
            }
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

        if (i + 5 < eventIds.length) {
          await new Promise((r) => setTimeout(r, 300));
        }
      }
    }

    loadAllDetails();
    return () => { cancelled = true; };
  }, [allEvents, playerId]);

  // ── Derived ──
  const detailsLoadedIds = useMemo(
    () => new Set(detailsMap.keys()),
    [detailsMap],
  );

  // True once the first 5 events (or all events if fewer than 5) have their details loaded.
  // Also true when loading is complete but there are no events (player has no matches in season).
  const initialDetailsLoaded = useMemo(() => {
    if (!loadingEvents && allEvents.length === 0) return true;
    const first5 = allEvents.slice(0, 5);
    return first5.length > 0 && first5.every((e) => detailsMap.has(e.id));
  }, [allEvents, detailsMap, loadingEvents]);

  return {
    allEvents,
    detailsMap,
    detailsLoadedIds,
    failedIds,
    loadingEvents,
    initialDetailsLoaded,
  };
}
