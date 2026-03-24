import { useState, useEffect, useCallback } from 'react';
import { getPlayerEvents } from '@/api/sofascore';
import type { MatchEvent } from '@/types';
import MatchCard from './MatchCard';

interface MatchListProps {
  playerId: number;
  selectedTournamentIds: Set<number>;
  showCommitted: boolean;
  showSuffered: boolean;
}

export default function MatchList({
  playerId,
  selectedTournamentIds,
  showCommitted,
  showSuffered,
}: MatchListProps) {
  const [events, setEvents] = useState<MatchEvent[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);

  // Reset quando cambia il giocatore
  useEffect(() => {
    setEvents([]);
    setPage(0);
    setHasMore(true);
  }, [playerId]);

  // Carica partite
  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    getPlayerEvents(playerId, page)
      .then(({ events: newEvents, hasNextPage }) => {
        if (cancelled) return;
        setEvents((prev) => (page === 0 ? newEvents : [...prev, ...newEvents]));
        setHasMore(hasNextPage);
      })
      .catch(console.error)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [playerId, page]);

  // Filtra per tornei selezionati e partite terminate
  const filteredEvents = events.filter((e) => {
    if (e.status?.code !== 100) return false;
    if (selectedTournamentIds.size === 0) return true;
    return selectedTournamentIds.has(e.tournament?.uniqueTournament?.id);
  });

  // Raggruppa per squadra (per giocatori che hanno cambiato squadra)
  const groupedByTeam = groupByTeam(filteredEvents, playerId);

  const isDesktop = typeof window !== 'undefined' && window.innerWidth >= 1024;

  return (
    <div>
      <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-wide mb-4">
        Partite ({filteredEvents.length})
      </h3>

      {groupedByTeam.map((group, groupIdx) => (
        <div key={groupIdx}>
          {/* Divisore squadra (se il giocatore ha cambiato squadra) */}
          {groupedByTeam.length > 1 && (
            <div className="flex items-center gap-3 mb-3 mt-6 first:mt-0">
              <div className="h-px flex-1 bg-border" />
              <span className="text-text-muted text-xs font-medium">{group.teamName}</span>
              <div className="h-px flex-1 bg-border" />
            </div>
          )}

          {/* Card in columns */}
          <div className="columns-1 md:columns-2 xl:columns-3 gap-3">
            {group.events.map((event, i) => (
              <MatchCard
                key={event.id}
                event={event}
                playerId={playerId}
                playerTeamId={group.teamId}
                showCommitted={showCommitted}
                showSuffered={showSuffered}
                defaultOpen={isDesktop && i < 5}
              />
            ))}
          </div>
        </div>
      ))}

      {/* Loading */}
      {loading && (
        <div className="flex items-center gap-2 text-text-muted mt-4">
          <div className="w-4 h-4 border-2 border-neon border-t-transparent rounded-full animate-spin" />
          Caricamento partite...
        </div>
      )}

      {/* Load more */}
      {!loading && hasMore && (
        <button
          onClick={() => setPage((p) => p + 1)}
          className="mt-4 px-4 py-2 bg-surface border border-border rounded-lg text-text-secondary text-sm hover:border-neon transition-colors"
        >
          Carica altre partite
        </button>
      )}

      {/* Nessuna partita */}
      {!loading && filteredEvents.length === 0 && events.length > 0 && (
        <p className="text-text-muted text-sm">
          Nessuna partita trovata per i filtri selezionati.
        </p>
      )}
    </div>
  );
}

interface TeamGroup {
  teamId: number;
  teamName: string;
  events: MatchEvent[];
}

function groupByTeam(events: MatchEvent[], playerId: number): TeamGroup[] {
  if (events.length === 0) return [];

  const groups: TeamGroup[] = [];
  let currentTeamId = -1;
  let currentGroup: TeamGroup | null = null;

  for (const event of events) {
    // Determina per quale squadra giocava il giocatore in questa partita
    // Non abbiamo un dato diretto, quindi usiamo l'euristica:
    // la squadra corrente sarà quella che appare più spesso
    const teamId = event.homeTeam.id; // Placeholder — verrà raffinato
    const teamName = event.homeTeam.name;

    // Per ora mettiamo tutto in un unico gruppo
    if (!currentGroup) {
      currentGroup = { teamId, teamName, events: [] };
      groups.push(currentGroup);
    }
    currentGroup.events.push(event);
  }

  return groups;
}
