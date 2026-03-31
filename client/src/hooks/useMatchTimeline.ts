import { useState, useEffect, useMemo, useRef } from 'react';
import { getPlayerTournamentSeasonEvents } from '@/api/sofascore';
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

  const tournamentsKey = useMemo(
    () =>
      tournamentsForSeason
        .map((t) => `${t.tournamentId}:${t.seasonId}`)
        .sort()
        .join(','),
    [tournamentsForSeason],
  );

  // ── Load events for each tournament/season in parallel ──
  // Uses the per-season endpoint instead of the chronological all-time list,
  // so old seasons (e.g. 23/24) load in ~1-2 pages instead of 8+ sequential pages.
  useEffect(() => {
    if (tournamentsForSeason.length === 0) return;

    let cancelled = false;
    loadedIdsRef.current = new Set();
    setAllEvents([]);
    setDetailsMap(new Map());
    setFailedIds(new Set());
    setLoadingEvents(true);

    async function loadOneTournament(tournamentId: number, seasonId: number): Promise<MatchEvent[]> {
      const collected: MatchEvent[] = [];
      let page = 0;

      while (!cancelled) {
        try {
          const { events: pageEvents, hasNextPage } =
            await getPlayerTournamentSeasonEvents(playerId, tournamentId, seasonId, page);
          if (cancelled) break;

          // Only finished matches (status.code === 100)
          collected.push(...pageEvents.filter((e) => e.status?.code === 100));

          if (!hasNextPage) break;
          page++;
        } catch {
          break; // Network error — stop this tournament's pagination
        }
      }

      return collected;
    }

    async function loadAll() {
      const perTournamentResults = await Promise.all(
        tournamentsForSeason.map((t) => loadOneTournament(t.tournamentId, t.seasonId)),
      );

      if (cancelled) return;

      const merged = perTournamentResults.flat();
      merged.sort((a, b) => b.startTimestamp - a.startTimestamp);

      setAllEvents(merged);
      setLoadingEvents(false);
    }

    loadAll();
    return () => { cancelled = true; };
  }, [playerId, tournamentsKey]);

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
  // Used by PlayerPage to know when to dismiss the full-page loader on first visit.
  const initialDetailsLoaded = useMemo(() => {
    const first5 = allEvents.slice(0, 5);
    return first5.length > 0 && first5.every((e) => detailsMap.has(e.id));
  }, [allEvents, detailsMap]);

  return {
    allEvents,
    detailsMap,
    detailsLoadedIds,
    failedIds,
    loadingEvents,
    initialDetailsLoaded,
  };
}
