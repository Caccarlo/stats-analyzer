import { useState, useEffect, useMemo } from 'react';
import { getScheduledEvents } from '@/api/sofascore';
import type { MatchEvent } from '@/types';

// === Tipi ===

export interface TournamentGroup {
  tournamentId: number;
  tournamentName: string;
  categoryId: number;
  categoryName: string;
  categoryAlpha2?: string;
  seasonId: number;
  events: MatchEvent[];
  defaultExpanded: boolean;
}

export interface CountryGroup {
  categoryId: number;
  categoryName: string;
  categoryAlpha2?: string;
  tournaments: TournamentGroup[];  // primari first, poi altri alfabetici
  defaultExpanded: boolean;        // sempre true
}

// === Costanti top-7 ===

const TOP_CATEGORY_IDS = [31, 1, 32, 30, 7, 1465, 1468]; // IT, EN, ES, DE, FR, EU, WO

// Tornei primari per categoria, in ordine di importanza
const PRIMARY_TOURNAMENT_IDS: Record<number, number[]> = {
  31:   [23],              // IT: Serie A
  1:    [17],              // EN: Premier League
  32:   [8],               // ES: LaLiga
  30:   [35],              // DE: Bundesliga
  7:    [34],              // FR: Ligue 1
  1465: [7, 679, 17015],   // EU: UCL, Europa League, Conference League
  1468: [16, 955],         // WO: World Cup, Club World Cup
};

// === Helper date ===

export function todayISO(): string {
  return formatLocalDateISO(new Date());
}

function formatLocalDateISO(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isEventOnSelectedDate(event: MatchEvent, selectedDate: string): boolean {
  if (!event.startTimestamp) return false;
  return formatLocalDateISO(new Date(event.startTimestamp * 1000)) === selectedDate;
}

// === Raggruppamento e ordinamento ===

function buildGroups(events: MatchEvent[]): CountryGroup[] {
  // Raggruppa per uniqueTournament.id
  const tournamentMap = new Map<number, {
    tournamentId: number;
    tournamentName: string;
    categoryId: number;
    categoryName: string;
    categoryAlpha2?: string;
    seasonId: number;
    events: MatchEvent[];
  }>();

  for (const event of events) {
    const ut = event.tournament?.uniqueTournament;
    if (!ut) continue;
    const cat = ut.category;
    const tid = ut.id;
    if (!tournamentMap.has(tid)) {
      tournamentMap.set(tid, {
        tournamentId: tid,
        tournamentName: ut.name,
        categoryId: cat?.id ?? 0,
        categoryName: cat?.name ?? '',
        categoryAlpha2: cat?.alpha2,
        seasonId: event.season?.id ?? 0,
        events: [],
      });
    }
    tournamentMap.get(tid)!.events.push(event);
  }

  // Ordina le partite di ogni torneo per startTimestamp
  for (const t of tournamentMap.values()) {
    t.events.sort((a, b) => a.startTimestamp - b.startTimestamp);
  }

  // Raggruppa i tornei per categoryId
  const categoryMap = new Map<number, {
    categoryId: number;
    categoryName: string;
    categoryAlpha2?: string;
    tournaments: typeof tournamentMap extends Map<number, infer V> ? V[] : never;
  }>();

  for (const t of tournamentMap.values()) {
    if (!categoryMap.has(t.categoryId)) {
      categoryMap.set(t.categoryId, {
        categoryId: t.categoryId,
        categoryName: t.categoryName,
        categoryAlpha2: t.categoryAlpha2,
        tournaments: [],
      });
    }
    categoryMap.get(t.categoryId)!.tournaments.push(t);
  }

  // Calcola metadati per ogni categoria e determina il tier
  const withMeta = [...categoryMap.values()].map((cat) => {
    const catIdx = TOP_CATEGORY_IDS.indexOf(cat.categoryId);
    const isTopCat = catIdx !== -1;
    const primaries = isTopCat ? (PRIMARY_TOURNAMENT_IDS[cat.categoryId] ?? []) : [];

    // Tier 1: top-7 con almeno un torneo primario tra quelli presenti oggi
    const hasPrimaryToday = primaries.some((pid) => tournamentMap.has(pid));
    const tier = isTopCat ? (hasPrimaryToday ? 1 : 2) : 3;

    // Ordina i tornei dentro il paese: primari prima (per indice), poi altri alfabetici
    const sortedTournaments = cat.tournaments.slice().sort((a, b) => {
      const ai = primaries.indexOf(a.tournamentId);
      const bi = primaries.indexOf(b.tournamentId);
      const aPrimIdx = ai === -1 ? Infinity : ai;
      const bPrimIdx = bi === -1 ? Infinity : bi;
      if (aPrimIdx !== bPrimIdx) return aPrimIdx - bPrimIdx;
      return a.tournamentName.localeCompare(b.tournamentName, 'it');
    });

    return { cat, catIdx, isTopCat, tier, primaries, sortedTournaments };
  });

  // Ordina le categorie per tier → catIdx (top-7) o alphabetical (tier3)
  withMeta.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    if (a.tier < 3) return a.catIdx - b.catIdx;
    return a.cat.categoryName.localeCompare(b.cat.categoryName, 'it');
  });

  // Costruisce CountryGroup con defaultExpanded per i tornei
  return withMeta.map(({ cat, primaries, sortedTournaments }) => {
    // Il primo torneo primario presente è auto-espanso; fallback: il primo in assoluto
    let firstExpandedSet = false;
    const tournaments: TournamentGroup[] = sortedTournaments.map((t, i) => {
      const isPrimary = primaries.includes(t.tournamentId);
      let defaultExpanded = false;
      if (!firstExpandedSet && (isPrimary || i === 0)) {
        defaultExpanded = true;
        firstExpandedSet = true;
      }
      return { ...t, defaultExpanded };
    });

    return {
      categoryId: cat.categoryId,
      categoryName: cat.categoryName,
      categoryAlpha2: cat.categoryAlpha2,
      tournaments,
      defaultExpanded: true,
    };
  });
}

// === Hook ===

export function useCalendarData(selectedDate: string) {
  const [eventsMap, setEventsMap] = useState<Map<string, MatchEvent[]>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Carica eventi per la data selezionata
  useEffect(() => {
    let cancelled = false;

    // Se già in cache locale, non mostrare loading
    if (!eventsMap.has(selectedDate)) {
      setLoading(true);
    }
    setError(null);

    getScheduledEvents(selectedDate).then((events) => {
      if (!cancelled) {
        setEventsMap((prev) => {
          const next = new Map(prev);
          next.set(selectedDate, events);
          return next;
        });
        setLoading(false);
      }
    }).catch(() => {
      if (!cancelled) {
        setError('Errore nel caricamento delle partite');
        setLoading(false);
      }
    });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate]);

  // Auto-refresh ogni 60s quando si visualizza la data di oggi
  useEffect(() => {
    const today = todayISO();
    if (selectedDate !== today) return;

    const interval = setInterval(() => {
      getScheduledEvents(today, true).then((events) => {
        setEventsMap((prev) => {
          const next = new Map(prev);
          next.set(today, events);
          return next;
        });
      }).catch(() => {});
    }, 60_000);

    return () => clearInterval(interval);
  }, [selectedDate]);

  const groups: CountryGroup[] = useMemo(
    () => buildGroups((eventsMap.get(selectedDate) ?? []).filter((event) => isEventOnSelectedDate(event, selectedDate))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [eventsMap, selectedDate]
  );

  return { groups, loading, error };
}
