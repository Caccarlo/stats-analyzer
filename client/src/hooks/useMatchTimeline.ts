import { useState, useEffect, useMemo, useRef } from 'react';
import { getPlayerEvents } from '@/api/sofascore';
import {
  fetchMatchDetails,
  matchDetailsCache,
  createSeededMatchDetails,
  type CachedMatchDetails,
  type MatchDetailsSeed,
} from '@/hooks/useMatchDetails';
import type { MatchEvent } from '@/types';

export interface UseMatchTimelineResult {
  allEvents: MatchEvent[];
  detailsMap: Map<number, CachedMatchDetails>;
  detailsLoadedIds: Set<number>;
  loadingEvents: boolean;
  initialDetailsLoaded: boolean;
}

function buildSeed(
  eventId: number,
  statisticsMap: Record<string, MatchDetailsSeed['officialStats']>,
  incidentsMap: Record<string, MatchDetailsSeed['incidents']>,
  onBenchMap: Record<string, boolean>,
): MatchDetailsSeed {
  const id = String(eventId);
  return {
    officialStats: statisticsMap[id] ?? null,
    incidents: incidentsMap[id] ?? null,
    onBench: onBenchMap[id] ?? false,
  };
}

function hasEssentialDetails(details: CachedMatchDetails | undefined): boolean {
  if (!details) return false;
  return (
    details.officialStatsStatus !== 'idle' &&
    details.commentsStatus !== 'idle' &&
    details.lineupsStatus !== 'idle'
  );
}

export function useMatchTimeline(
  playerId: number,
  validSeasonIds: Set<number>,
): UseMatchTimelineResult {
  const [allEvents, setAllEvents] = useState<MatchEvent[]>([]);
  const [detailsMap, setDetailsMap] = useState<Map<number, CachedMatchDetails>>(new Map());
  const [loadingEvents, setLoadingEvents] = useState(true);

  const loadedIdsRef = useRef<Set<number>>(new Set());

  const seasonIdsKey = useMemo(
    () => [...validSeasonIds].sort().join(','),
    [validSeasonIds],
  );

  useEffect(() => {
    if (validSeasonIds.size === 0) return;

    let cancelled = false;
    loadedIdsRef.current = new Set();
    setAllEvents([]);
    setDetailsMap(new Map());
    setLoadingEvents(true);

    async function loadPages() {
      let page = 0;
      let accumulated: MatchEvent[] = [];
      let hasMore = true;
      let foundRelevant = false;
      let combinedDetails = new Map<number, CachedMatchDetails>();

      while (hasMore && !cancelled) {
        try {
          const {
            events: pageEvents,
            hasNextPage,
            statisticsMap,
            incidentsMap,
            onBenchMap,
          } = await getPlayerEvents(playerId, page);
          if (cancelled) return;

          const relevant = pageEvents.filter(
            (e) => e.status?.code === 100 && validSeasonIds.has(e.season?.id),
          );

          accumulated = [...accumulated, ...relevant];
          for (const event of relevant) {
            const seed = buildSeed(event.id, statisticsMap, incidentsMap, onBenchMap);
            const existing = combinedDetails.get(event.id);
            combinedDetails.set(event.id, existing ?? createSeededMatchDetails(seed));
          }

          if (relevant.length > 0) foundRelevant = true;
          if (foundRelevant && pageEvents.length > 0 && relevant.length === 0) break;

          hasMore = hasNextPage;
          page++;
        } catch {
          break;
        }
      }

      if (!cancelled) {
        accumulated.sort((a, b) => b.startTimestamp - a.startTimestamp);
        const sortedDetails = new Map<number, CachedMatchDetails>();
        accumulated.forEach((event) => {
          const details = combinedDetails.get(event.id);
          if (details) sortedDetails.set(event.id, details);
        });
        setAllEvents(accumulated);
        setDetailsMap(sortedDetails);
        setLoadingEvents(false);
      }
    }

    loadPages();
    return () => { cancelled = true; };
  }, [playerId, seasonIdsKey]);

  useEffect(() => {
    if (allEvents.length === 0) return;

    let cancelled = false;

    async function loadAllDetails() {
      for (let i = 0; i < allEvents.length; i += 5) {
        if (cancelled) return;

        const batch = allEvents.slice(i, i + 5);
        const batchResults: { eventId: number; result: CachedMatchDetails }[] = [];

        await Promise.all(
          batch.map(async (event) => {
            if (loadedIdsRef.current.has(event.id)) return;

            const existing = detailsMap.get(event.id);
            const seed: MatchDetailsSeed = {
              officialStats: existing?.officialStats ?? null,
              incidents: null,
              onBench: existing?.onBench ?? false,
            };

            const key = `${event.id}-${playerId}`;
            try {
              const result = matchDetailsCache.has(key)
                ? matchDetailsCache.get(key)!
                : await fetchMatchDetails(event.id, playerId, seed);
              if (cancelled) return;
              loadedIdsRef.current.add(event.id);
              batchResults.push({ eventId: event.id, result });
            } catch {
              loadedIdsRef.current.add(event.id);
              batchResults.push({
                eventId: event.id,
                result: existing ?? createSeededMatchDetails(seed),
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

        if (i + 5 < allEvents.length) {
          await new Promise((r) => setTimeout(r, 300));
        }
      }
    }

    loadAllDetails();
    return () => { cancelled = true; };
  }, [allEvents, detailsMap, playerId]);

  const detailsLoadedIds = useMemo(
    () => new Set(
      [...detailsMap.entries()]
        .filter(([, details]) => hasEssentialDetails(details))
        .map(([eventId]) => eventId),
    ),
    [detailsMap],
  );

  const initialDetailsLoaded = useMemo(() => {
    const first5 = allEvents.slice(0, 5);
    return first5.length > 0 && first5.every((e) => hasEssentialDetails(detailsMap.get(e.id)));
  }, [allEvents, detailsMap]);

  return {
    allEvents,
    detailsMap,
    detailsLoadedIds,
    loadingEvents,
    initialDetailsLoaded,
  };
}
