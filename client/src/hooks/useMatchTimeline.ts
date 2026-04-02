import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { getPlayerEvents } from '@/api/sofascore';
import {
  matchDetailsCache,
  mergeMatchDetailsWithSeed,
  patchMatchDetailsCache,
  fetchMatchOfficialStats,
  fetchMatchLineupsOnly,
  fetchMatchRichData,
  createSeededMatchDetails,
  type CachedMatchDetails,
  type MatchDetailsSeed,
} from '@/hooks/useMatchDetails';
import type { MatchEvent } from '@/types';

type PlayerEventsPageResult = Awaited<ReturnType<typeof getPlayerEvents>>;

interface TimelineSnapshot {
  allEvents: MatchEvent[];
  detailsMap: Map<number, CachedMatchDetails>;
  lineupsLoadedIds: Set<number>;
  allOfficialStatsLoaded: boolean;
  allLineupsLoaded: boolean;
  recentRichLoaded: boolean;
}

const playerEventsPageCache = new Map<string, PlayerEventsPageResult>();
const timelineContextCache = new Map<string, TimelineSnapshot>();

export interface UseMatchTimelineResult {
  allEvents: MatchEvent[];
  detailsMap: Map<number, CachedMatchDetails>;
  detailsLoadedIds: Set<number>;
  lineupsLoadedIds: Set<number>;
  loadingEvents: boolean;
  allOfficialStatsLoaded: boolean;
  allLineupsLoaded: boolean;
  recentRichLoaded: boolean;
  requestRichDetails: (eventId: number) => void;
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

function hasSeedOnlyOfficialStats(details: CachedMatchDetails | undefined): boolean {
  return Boolean(
    details &&
    details.officialStatsStatus === 'loaded' &&
    typeof details.officialStats?.fouls !== 'number' &&
    typeof details.officialStats?.wasFouled !== 'number',
  );
}

function normalizeSeededOfficialStats(details: CachedMatchDetails): CachedMatchDetails {
  if (!hasSeedOnlyOfficialStats(details)) return details;
  return {
    ...details,
    officialStatsStatus: 'idle',
  };
}

function buildTimelineContextKey(
  playerId: number,
  seasonIdsKey: string,
  maxEvents?: number,
  minPlayedEvents?: number,
): string {
  const suffix = minPlayedEvents !== undefined
    ? `p${minPlayedEvents}-m${maxEvents ?? 'all'}`
    : `${maxEvents ?? 'all'}`;
  return `${playerId}|${seasonIdsKey}|${suffix}`;
}

function cloneDetailsMap(source: Map<number, CachedMatchDetails>): Map<number, CachedMatchDetails> {
  return new Map(
    [...source.entries()].map(([eventId, details]) => [eventId, { ...details }]),
  );
}

function cloneTimelineSnapshot(snapshot: TimelineSnapshot): TimelineSnapshot {
  return {
    allEvents: [...snapshot.allEvents],
    detailsMap: cloneDetailsMap(snapshot.detailsMap),
    lineupsLoadedIds: new Set(snapshot.lineupsLoadedIds),
    allOfficialStatsLoaded: snapshot.allOfficialStatsLoaded,
    allLineupsLoaded: snapshot.allLineupsLoaded,
    recentRichLoaded: snapshot.recentRichLoaded,
  };
}

function mergeSnapshotIntoCache(
  contextKey: string,
  patch: Partial<TimelineSnapshot>,
): void {
  const existing = timelineContextCache.get(contextKey);
  if (!existing) return;
  timelineContextCache.set(contextKey, cloneTimelineSnapshot({
    ...existing,
    ...patch,
  }));
}

function buildSnapshotFromEvents(
  events: MatchEvent[],
  combinedDetails: Map<number, CachedMatchDetails>,
): TimelineSnapshot {
  const sortedEvents = [...events].sort((a, b) => b.startTimestamp - a.startTimestamp);
  const sortedDetails = new Map<number, CachedMatchDetails>();
  sortedEvents.forEach((event) => {
    const details = combinedDetails.get(event.id);
    if (details) sortedDetails.set(event.id, details);
  });

  const allOfficialReady = sortedEvents.every((event) => {
    const details = sortedDetails.get(event.id);
    return details?.officialStatsStatus !== 'idle';
  });
  const allLineupsReady = sortedEvents.every((event) => {
    const details = sortedDetails.get(event.id);
    return details?.lineupsStatus !== 'idle';
  });
  const preloadedLineups = new Set(
    sortedEvents
      .filter((event) => sortedDetails.get(event.id)?.lineupsStatus !== 'idle')
      .map((event) => event.id),
  );

  return {
    allEvents: sortedEvents,
    detailsMap: sortedDetails,
    lineupsLoadedIds: preloadedLineups,
    allOfficialStatsLoaded: allOfficialReady,
    allLineupsLoaded: allLineupsReady,
    recentRichLoaded: true,
  };
}

function buildSnapshotFromCachedPages(
  playerId: number,
  validSeasonIds: Set<number>,
  maxEvents?: number,
  minPlayedEvents?: number,
): TimelineSnapshot | null {
  if (validSeasonIds.size === 0) return null;

  let page = 0;
  let accumulated: MatchEvent[] = [];
  let foundRelevant = false;
  const stopAfterFirstIrrelevantPage = maxEvents === undefined;
  const combinedDetails = new Map<number, CachedMatchDetails>();
  const combinedOnBenchMap: Record<string, boolean> = {};

  while (true) {
    const cachedPage = playerEventsPageCache.get(`${playerId}-${page}`);
    if (!cachedPage) return null;

    const {
      events: pageEvents,
      hasNextPage,
      statisticsMap,
      incidentsMap,
      onBenchMap,
    } = cachedPage;
    Object.assign(combinedOnBenchMap, onBenchMap);

    const relevant = pageEvents.filter(
      (event) => event.status?.code === 100 && validSeasonIds.has(event.season?.id),
    );

    accumulated = [...accumulated, ...relevant];
    for (const event of relevant) {
      const seed = buildSeed(event.id, statisticsMap, incidentsMap, onBenchMap);
      const cacheKey = `${event.id}-${playerId}`;
      const existing =
        combinedDetails.get(event.id) ??
        matchDetailsCache.get(cacheKey);
      const mergedBase = existing
        ? mergeMatchDetailsWithSeed(existing, seed)
        : createSeededMatchDetails(seed);
      const merged = normalizeSeededOfficialStats(mergedBase);
      combinedDetails.set(event.id, merged);
    }

    if (maxEvents !== undefined && accumulated.length >= maxEvents) {
      return buildSnapshotFromEvents(accumulated, combinedDetails);
    }
    if (minPlayedEvents !== undefined) {
      const playedCount = accumulated.filter((event) => {
        const onBench = combinedOnBenchMap[String(event.id)];
        return onBench === false;
      }).length;
      if (playedCount >= minPlayedEvents) {
        return buildSnapshotFromEvents(accumulated, combinedDetails);
      }
    }

    if (relevant.length > 0) foundRelevant = true;

    if (
      stopAfterFirstIrrelevantPage &&
      foundRelevant &&
      pageEvents.length > 0 &&
      relevant.length === 0
    ) {
      return buildSnapshotFromEvents(accumulated, combinedDetails);
    }

    if (!hasNextPage) {
      return buildSnapshotFromEvents(accumulated, combinedDetails);
    }

    page++;
  }
}

export function useMatchTimeline(
  playerId: number,
  validSeasonIds: Set<number>,
  maxEvents?: number,
  minPlayedEvents?: number,
): UseMatchTimelineResult {
  const seasonIdsKey = useMemo(
    () => [...validSeasonIds].sort().join(','),
    [validSeasonIds],
  );
  const stableSeasonIds = useMemo(
    () => new Set(
      seasonIdsKey
        .split(',')
        .filter(Boolean)
        .map((value) => Number(value)),
    ),
    [seasonIdsKey],
  );
  const contextKey = useMemo(
    () => buildTimelineContextKey(playerId, seasonIdsKey, maxEvents, minPlayedEvents),
    [playerId, seasonIdsKey, maxEvents, minPlayedEvents],
  );

  const [allEvents, setAllEvents] = useState<MatchEvent[]>([]);
  const [detailsMap, setDetailsMap] = useState<Map<number, CachedMatchDetails>>(new Map());
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [allOfficialStatsLoaded, setAllOfficialStatsLoaded] = useState(false);
  const [lineupsLoadedIds, setLineupsLoadedIds] = useState<Set<number>>(new Set());
  const [allLineupsLoaded, setAllLineupsLoaded] = useState(false);
  const [recentRichLoaded, setRecentRichLoaded] = useState(true);

  const statsLoadingRef = useRef(false);
  const lineupsLoadingRef = useRef(false);
  const detailsMapRef = useRef(detailsMap);
  const playerIdRef = useRef(playerId);

  useEffect(() => {
    detailsMapRef.current = detailsMap;
  }, [detailsMap]);

  useEffect(() => {
    playerIdRef.current = playerId;
  }, [playerId]);

  useEffect(() => {
    if (stableSeasonIds.size === 0) return;

    let cancelled = false;
    statsLoadingRef.current = false;
    lineupsLoadingRef.current = false;

    const cachedContext = timelineContextCache.get(contextKey);
    if (cachedContext) {
      const snapshot = cloneTimelineSnapshot(cachedContext);
      setAllEvents(snapshot.allEvents);
      setDetailsMap(snapshot.detailsMap);
      setLineupsLoadedIds(snapshot.lineupsLoadedIds);
      setAllOfficialStatsLoaded(snapshot.allOfficialStatsLoaded);
      setAllLineupsLoaded(snapshot.allLineupsLoaded);
      setRecentRichLoaded(true);
      setLoadingEvents(false);
      return () => { cancelled = true; };
    }

    const cachedPagesSnapshot = buildSnapshotFromCachedPages(
      playerId,
      stableSeasonIds,
      maxEvents,
      minPlayedEvents,
    );
    if (cachedPagesSnapshot) {
      const snapshot = cloneTimelineSnapshot(cachedPagesSnapshot);
      timelineContextCache.set(contextKey, cloneTimelineSnapshot(snapshot));
      setAllEvents(snapshot.allEvents);
      setDetailsMap(snapshot.detailsMap);
      setLineupsLoadedIds(snapshot.lineupsLoadedIds);
      setAllOfficialStatsLoaded(snapshot.allOfficialStatsLoaded);
      setAllLineupsLoaded(snapshot.allLineupsLoaded);
      setRecentRichLoaded(true);
      setLoadingEvents(false);
      return () => { cancelled = true; };
    }

    setAllEvents([]);
    setDetailsMap(new Map());
    setLoadingEvents(true);
    setAllOfficialStatsLoaded(false);
    setLineupsLoadedIds(new Set());
    setAllLineupsLoaded(false);
    setRecentRichLoaded(true);

    async function loadPages() {
      let page = 0;
      let accumulated: MatchEvent[] = [];
      let hasMore = true;
      let foundRelevant = false;
      const stopAfterFirstIrrelevantPage = maxEvents === undefined;
      const combinedDetails = new Map<number, CachedMatchDetails>();
      const combinedOnBenchMap: Record<string, boolean> = {};

      while (hasMore && !cancelled) {
        try {
          const pageCacheKey = `${playerId}-${page}`;
          const pageResult = playerEventsPageCache.get(pageCacheKey) ?? await getPlayerEvents(playerId, page);
          if (!playerEventsPageCache.has(pageCacheKey)) {
            playerEventsPageCache.set(pageCacheKey, pageResult);
          }
          const {
            events: pageEvents,
            hasNextPage,
            statisticsMap,
            incidentsMap,
            onBenchMap,
          } = pageResult;
          Object.assign(combinedOnBenchMap, onBenchMap);
          if (cancelled) return;

          const relevant = pageEvents.filter(
            (event) => event.status?.code === 100 && stableSeasonIds.has(event.season?.id),
          );

          accumulated = [...accumulated, ...relevant];
          for (const event of relevant) {
            const seed = buildSeed(event.id, statisticsMap, incidentsMap, onBenchMap);
            const cacheKey = `${event.id}-${playerId}`;
            const existing =
              combinedDetails.get(event.id) ??
              matchDetailsCache.get(cacheKey);
            const mergedBase = existing
              ? mergeMatchDetailsWithSeed(existing, seed)
              : createSeededMatchDetails(seed);
            const merged = normalizeSeededOfficialStats(mergedBase);

            combinedDetails.set(event.id, merged);
            matchDetailsCache.set(cacheKey, merged);
          }

          if (maxEvents !== undefined && accumulated.length >= maxEvents) {
            hasMore = false;
            break;
          }
          if (minPlayedEvents !== undefined) {
            const playedCount = accumulated.filter((event) => {
              const onBench = combinedOnBenchMap[String(event.id)];
              return onBench === false;
            }).length;
            if (playedCount >= minPlayedEvents) {
              hasMore = false;
              break;
            }
          }

          if (relevant.length > 0) foundRelevant = true;

          if (
            stopAfterFirstIrrelevantPage &&
            foundRelevant &&
            pageEvents.length > 0 &&
            relevant.length === 0
          ) {
            break;
          }

          hasMore = hasNextPage;
          page++;
        } catch {
          break;
        }
      }

      if (cancelled) return;

      const snapshot = buildSnapshotFromEvents(accumulated, combinedDetails);
      timelineContextCache.set(contextKey, cloneTimelineSnapshot(snapshot));

      setAllEvents(snapshot.allEvents);
      setDetailsMap(snapshot.detailsMap);
      setLineupsLoadedIds(snapshot.lineupsLoadedIds);
      setAllOfficialStatsLoaded(snapshot.allOfficialStatsLoaded);
      setAllLineupsLoaded(snapshot.allLineupsLoaded);
      setRecentRichLoaded(true);
      setLoadingEvents(false);
    }

    loadPages();
    return () => { cancelled = true; };
  }, [playerId, stableSeasonIds, maxEvents, minPlayedEvents, contextKey]);

  useEffect(() => {
    if (allEvents.length === 0) return;
    if (allOfficialStatsLoaded) return;
    if (statsLoadingRef.current) return;
    statsLoadingRef.current = true;

    let cancelled = false;

    async function loadAllOfficialStats() {
      const BATCH = 8;
      const DELAY = 100;

      for (let i = 0; i < allEvents.length; i += BATCH) {
        if (cancelled) return;

        const batch = allEvents.slice(i, i + BATCH);
        const batchResults: { eventId: number; patch: Partial<CachedMatchDetails> }[] = [];
        let batchDidFetch = false;

        await Promise.all(
          batch.map(async (event) => {
            const existing = detailsMapRef.current.get(event.id);
            if (existing?.officialStatsStatus !== 'idle') {
              batchResults.push({ eventId: event.id, patch: {} });
              return;
            }

            batchDidFetch = true;
            const result = await fetchMatchOfficialStats(
              event.id,
              playerId,
              existing?.officialStats ?? null,
            );
            if (cancelled) return;

            const patch: Partial<CachedMatchDetails> = {
              officialStats: result.officialStats,
              officialStatsStatus: result.officialStatsStatus,
              didNotPlay: existing?.didNotPlay
                ? (result.officialStats?.minutesPlayed ?? 0) === 0 && (existing?.onBench ?? false)
                : false,
            };
            patchMatchDetailsCache(event.id, playerId, patch);
            batchResults.push({ eventId: event.id, patch });
          }),
        );

        if (cancelled) return;

        setDetailsMap((prev) => {
          const next = new Map(prev);
          for (const { eventId, patch } of batchResults) {
            const cur = next.get(eventId);
            if (cur && Object.keys(patch).length > 0) {
              next.set(eventId, { ...cur, ...patch });
            }
          }
          mergeSnapshotIntoCache(contextKey, { detailsMap: next });
          return next;
        });

        if (batchDidFetch && i + BATCH < allEvents.length) {
          await new Promise((resolve) => setTimeout(resolve, DELAY));
        }
      }

      if (!cancelled) {
        setAllOfficialStatsLoaded(true);
        mergeSnapshotIntoCache(contextKey, { allOfficialStatsLoaded: true });
      }
    }

    loadAllOfficialStats();
    return () => { cancelled = true; };
  }, [allEvents, allOfficialStatsLoaded]);

  useEffect(() => {
    if (allEvents.length === 0) return;
    if (allLineupsLoaded) return;
    if (lineupsLoadingRef.current) return;
    lineupsLoadingRef.current = true;

    let cancelled = false;

    async function loadAllLineups() {
      const BATCH = 5;
      const DELAY = 150;

      for (let i = 0; i < allEvents.length; i += BATCH) {
        if (cancelled) return;

        const batch = allEvents.slice(i, i + BATCH);
        const batchResults: { eventId: number; patch: Partial<CachedMatchDetails> }[] = [];
        let batchDidFetch = false;

        await Promise.all(
          batch.map(async (event) => {
            const existing = detailsMapRef.current.get(event.id);
            if (existing?.lineupsStatus === 'loaded' || existing?.lineupsStatus === 'unavailable') {
              batchResults.push({ eventId: event.id, patch: {} });
              return;
            }

            batchDidFetch = true;
            const result = await fetchMatchLineupsOnly(
              event.id,
              playerId,
              existing?.onBench ?? false,
              existing?.officialStats ?? null,
            );
            if (cancelled) return;

            const patch: Partial<CachedMatchDetails> = {
              lineupsStatus: result.lineupsStatus,
              jerseyMap: result.jerseyMap,
              didNotPlay: result.didNotPlay,
              isStarter: result.isStarter,
              playerSide: result.playerSide,
            };
            patchMatchDetailsCache(event.id, playerId, patch);
            batchResults.push({ eventId: event.id, patch });
          }),
        );

        if (cancelled) return;

        setDetailsMap((prev) => {
          const next = new Map(prev);
          for (const { eventId, patch } of batchResults) {
            const cur = next.get(eventId);
            if (cur && Object.keys(patch).length > 0) {
              next.set(eventId, { ...cur, ...patch });
            }
          }
          mergeSnapshotIntoCache(contextKey, { detailsMap: next });
          return next;
        });

        setLineupsLoadedIds((prev) => {
          const next = new Set(prev);
          for (const { eventId } of batchResults) next.add(eventId);
          mergeSnapshotIntoCache(contextKey, { lineupsLoadedIds: next });
          return next;
        });

        if (batchDidFetch && i + BATCH < allEvents.length) {
          await new Promise((resolve) => setTimeout(resolve, DELAY));
        }
      }

      if (!cancelled) {
        setAllLineupsLoaded(true);
        mergeSnapshotIntoCache(contextKey, { allLineupsLoaded: true });
      }
    }

    loadAllLineups();
    return () => { cancelled = true; };
  }, [allEvents, allLineupsLoaded]);

  const requestRichDetails = useCallback((eventId: number) => {
    setDetailsMap((prev) => {
      const existing = prev.get(eventId);
      if (!existing || existing.commentsStatus !== 'idle') return prev;

      fetchMatchRichData(eventId, playerIdRef.current, null).then((result) => {
        const patch: Partial<CachedMatchDetails> = {
          fouls: result.fouls,
          commentsStatus: result.commentsStatus,
          commentsAvailable: result.commentsAvailable,
          substituteInMinute: result.substituteInMinute,
          substituteOutMinute: result.substituteOutMinute,
          cardInfo: result.cardInfo ?? existing.cardInfo ?? null,
          cardInfoStatus: result.cardInfoStatus,
        };
        patchMatchDetailsCache(eventId, playerIdRef.current, patch);
        setDetailsMap((currentMap) => {
          const current = currentMap.get(eventId);
          if (!current) return currentMap;
          const next = new Map(currentMap);
          next.set(eventId, { ...current, ...patch });
          mergeSnapshotIntoCache(contextKey, { detailsMap: next });
          return next;
        });
      });

      const next = new Map(prev);
      next.set(eventId, { ...existing, commentsStatus: 'loading' });
      return next;
    });
  }, [contextKey]);

  const detailsLoadedIds = useMemo(
    () => new Set(
      [...detailsMap.entries()]
        .filter(([, details]) => details.officialStatsStatus !== 'idle')
        .map(([eventId]) => eventId),
    ),
    [detailsMap],
  );

  return {
    allEvents,
    detailsMap,
    detailsLoadedIds,
    lineupsLoadedIds,
    loadingEvents,
    allOfficialStatsLoaded,
    allLineupsLoaded,
    recentRichLoaded,
    requestRichDetails,
  };
}
