import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { getPlayerEvents } from '@/api/sofascore';
import {
  patchMatchDetailsCache,
  fetchMatchOfficialStats,
  fetchMatchLineupsOnly,
  fetchMatchRichData,
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
  lineupsLoadedIds: Set<number>;
  loadingEvents: boolean;
  initialStatsLoaded: boolean;
  allLineupsLoaded: boolean;
  isBackgroundLoading: boolean;
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

export function useMatchTimeline(
  playerId: number,
  validSeasonIds: Set<number>,
): UseMatchTimelineResult {
  const [allEvents, setAllEvents] = useState<MatchEvent[]>([]);
  const [detailsMap, setDetailsMap] = useState<Map<number, CachedMatchDetails>>(new Map());
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [initialStatsLoaded, setInitialStatsLoaded] = useState(false);
  const [lineupsLoadedIds, setLineupsLoadedIds] = useState<Set<number>>(new Set());
  const [allLineupsLoaded, setAllLineupsLoaded] = useState(false);
  const [richLoadedCount, setRichLoadedCount] = useState(0);

  const statsLoadingRef = useRef(false);
  const lineupsLoadingRef = useRef(false);
  const richLoadingRef = useRef(false);

  const seasonIdsKey = useMemo(
    () => [...validSeasonIds].sort().join(','),
    [validSeasonIds],
  );

  // ── Effetto 1: carica tutte le pagine events/last e costruisce i seed ──
  // officialStats è già inclusa in statisticsMap → initialStatsLoaded scatta subito
  useEffect(() => {
    if (validSeasonIds.size === 0) return;

    let cancelled = false;
    statsLoadingRef.current = false;
    lineupsLoadingRef.current = false;
    richLoadingRef.current = false;
    setAllEvents([]);
    setDetailsMap(new Map());
    setLoadingEvents(true);
    setInitialStatsLoaded(false);
    setLineupsLoadedIds(new Set());
    setAllLineupsLoaded(false);
    setRichLoadedCount(0);

    async function loadPages() {
      let page = 0;
      let accumulated: MatchEvent[] = [];
      let hasMore = true;
      let foundRelevant = false;
      const combinedDetails = new Map<number, CachedMatchDetails>();

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
        // initialStatsLoaded viene settato dal loop officialStats quando il primo batch è pronto
      }
    }

    loadPages();
    return () => { cancelled = true; };
  }, [playerId, seasonIdsKey]);

  // ── Effetto 2: fetch officialStats (fouls, wasFouled, minutesPlayed) per tutte le partite ──
  // I seed di events/last non contengono fouls/wasFouled → serve event/{id}/player/{id}/statistics
  // initialStatsLoaded scatta quando le prime 5 partite hanno i dati completi
  useEffect(() => {
    if (allEvents.length === 0) return;
    if (statsLoadingRef.current) return;
    statsLoadingRef.current = true;

    let cancelled = false;
    let firstBatchDone = false;

    async function loadAllOfficialStats() {
      const BATCH = 8;
      const DELAY = 100;
      const INITIAL_THRESHOLD = Math.min(5, allEvents.length);

      for (let i = 0; i < allEvents.length; i += BATCH) {
        if (cancelled) return;

        const batch = allEvents.slice(i, i + BATCH);
        const batchResults: { eventId: number; patch: Partial<CachedMatchDetails> }[] = [];

        await Promise.all(
          batch.map(async (event) => {
            const existing = detailsMap.get(event.id);
            // Salta se dati già affidabili (fouls presente)
            if (typeof existing?.officialStats?.fouls === 'number') {
              batchResults.push({ eventId: event.id, patch: {} });
              return;
            }

            const result = await fetchMatchOfficialStats(
              event.id,
              playerId,
              existing?.officialStats ?? null,
            );
            if (cancelled) return;

            const patch: Partial<CachedMatchDetails> = {
              officialStats: result.officialStats,
              officialStatsStatus: result.officialStatsStatus,
              // Ricalcola didNotPlay con i minuti aggiornati
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
          return next;
        });

        // Sblocca la pagina dopo il primo batch (prime INITIAL_THRESHOLD partite)
        if (!firstBatchDone && i + BATCH >= INITIAL_THRESHOLD) {
          firstBatchDone = true;
          if (!cancelled) setInitialStatsLoaded(true);
        }

        if (i + BATCH < allEvents.length) {
          await new Promise((r) => setTimeout(r, DELAY));
        }
      }

      // Assicura che initialStatsLoaded sia true anche per dataset piccoli
      if (!cancelled && !firstBatchDone) {
        setInitialStatsLoaded(true);
      }
    }

    loadAllOfficialStats();
    return () => { cancelled = true; };
  }, [allEvents]);

  // ── Effetto 3: preload lineups per tutte le partite (necessario per filtro Titolare) ──
  useEffect(() => {
    if (allEvents.length === 0) return;
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

        await Promise.all(
          batch.map(async (event) => {
            const existing = detailsMap.get(event.id);
            // Salta se lineups già caricate per questo evento
            if (existing?.lineupsStatus === 'loaded' || existing?.lineupsStatus === 'unavailable') {
              batchResults.push({ eventId: event.id, patch: {} });
              return;
            }

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
          return next;
        });

        setLineupsLoadedIds((prev) => {
          const next = new Set(prev);
          for (const { eventId } of batchResults) next.add(eventId);
          return next;
        });

        if (i + BATCH < allEvents.length) {
          await new Promise((r) => setTimeout(r, DELAY));
        }
      }

      if (!cancelled) {
        setAllLineupsLoaded(true);
      }
    }

    loadAllLineups();
    return () => { cancelled = true; };
  }, [allEvents]);

  // ── Effetto 4: preload rich data (comments) solo per le ultime 5 partite ──
  useEffect(() => {
    if (allEvents.length === 0) return;
    if (richLoadingRef.current) return;
    richLoadingRef.current = true;

    let cancelled = false;
    const richTargets = allEvents.slice(0, 5);

    async function loadRichForRecent() {
      const BATCH = 2;
      const DELAY = 200;

      for (let i = 0; i < richTargets.length; i += BATCH) {
        if (cancelled) return;

        const batch = richTargets.slice(i, i + BATCH);
        const batchResults: { eventId: number; patch: Partial<CachedMatchDetails> }[] = [];

        await Promise.all(
          batch.map(async (event) => {
            const existing = detailsMap.get(event.id);
            // Salta se già caricato
            if (existing?.commentsStatus !== 'idle') {
              batchResults.push({ eventId: event.id, patch: {} });
              return;
            }

            const result = await fetchMatchRichData(
              event.id,
              playerId,
              existing?.cardInfo ? null : null, // incidents già nel seed/cardInfo
            );
            if (cancelled) return;

            const patch: Partial<CachedMatchDetails> = {
              fouls: result.fouls,
              commentsStatus: result.commentsStatus,
              commentsAvailable: result.commentsAvailable,
              substituteInMinute: result.substituteInMinute,
              substituteOutMinute: result.substituteOutMinute,
              cardInfo: result.cardInfo ?? existing?.cardInfo ?? null,
              cardInfoStatus: result.cardInfoStatus,
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
          return next;
        });

        setRichLoadedCount((prev) => prev + batchResults.filter((r) => Object.keys(r.patch).length > 0).length);

        if (i + BATCH < richTargets.length) {
          await new Promise((r) => setTimeout(r, DELAY));
        }
      }
    }

    loadRichForRecent();
    return () => { cancelled = true; };
  }, [allEvents]);

  // ── Trigger lazy per rich data di una partita specifica (es. card selezionata fuori ultime 5) ──
  const playerIdRef = useRef(playerId);
  playerIdRef.current = playerId;

  const requestRichDetails = useCallback((eventId: number) => {
    setDetailsMap((prev) => {
      const existing = prev.get(eventId);
      if (!existing || existing.commentsStatus !== 'idle') return prev;

      // Avvia il fetch asincrono e aggiorna lo stato quando completo
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
        setDetailsMap((p) => {
          const cur = p.get(eventId);
          if (!cur) return p;
          const next = new Map(p);
          next.set(eventId, { ...cur, ...patch });
          return next;
        });
      });

      // Segna subito commentsStatus come 'loading' per evitare doppi fetch
      const next = new Map(prev);
      next.set(eventId, { ...existing, commentsStatus: 'loading' });
      return next;
    });
  }, []);

  // detailsLoadedIds: partite con officialStats pronte (quasi subito dopo il seed)
  const detailsLoadedIds = useMemo(
    () => new Set(
      [...detailsMap.entries()]
        .filter(([, details]) => details.officialStatsStatus !== 'idle')
        .map(([eventId]) => eventId),
    ),
    [detailsMap],
  );

  const isBackgroundLoading = !allLineupsLoaded || richLoadedCount < Math.min(5, allEvents.length);

  return {
    allEvents,
    detailsMap,
    detailsLoadedIds,
    lineupsLoadedIds,
    loadingEvents,
    initialStatsLoaded,
    allLineupsLoaded,
    isBackgroundLoading,
    requestRichDetails,
  };
}
