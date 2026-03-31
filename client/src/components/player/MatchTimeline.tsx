import type { MatchEvent } from '@/types';
import type { CachedMatchDetails } from '@/hooks/useMatchDetails';

interface MatchTimelineProps {
  events: MatchEvent[];
  selectedEventIds: Set<number>;
  detailsMap: Map<number, CachedMatchDetails>;
  detailsLoadedIds: Set<number>;
  showCommitted: boolean;
  showSuffered: boolean;
  onToggleMatch: (eventId: number) => void;
  toggleMode: 'select' | 'deselect';
  onToggleAll: () => void;
  isBackgroundLoading?: boolean;
}

function abbreviateTournament(name: string): string {
  if (!name) return '';
  const words = name.split(/\s+/);
  if (words.length === 1) return words[0].substring(0, 3).toUpperCase();
  return words.map((w) => w[0]?.toUpperCase() ?? '').join('.');
}

function getFoulCounts(
  details: CachedMatchDetails | undefined,
): { committed: number | null; suffered: number | null } | null {
  if (!details) return null;
  const committed = details.officialStats?.fouls;
  const suffered = details.officialStats?.wasFouled;
  if (typeof committed !== 'number' && typeof suffered !== 'number') return null;
  return {
    committed: typeof committed === 'number' ? committed : null,
    suffered: typeof suffered === 'number' ? suffered : null,
  };
}

export default function MatchTimeline({
  events,
  selectedEventIds,
  detailsMap,
  detailsLoadedIds,
  showCommitted,
  showSuffered,
  onToggleMatch,
  toggleMode,
  onToggleAll,
  isBackgroundLoading = false,
}: MatchTimelineProps) {
  if (events.length === 0) return null;

  return (
    <div>
      {/* Header: titolo + spinner background + toggle seleziona/deseleziona tutte */}
      <div className="flex items-center gap-3 mb-3">
        <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-wide">
          Timeline partite ({events.length})
        </h3>
        {isBackgroundLoading && (
          <div
            className="w-3.5 h-3.5 border-2 border-neon border-t-transparent rounded-full animate-spin flex-shrink-0"
            title="Caricamento dettagli in corso..."
          />
        )}
        <button
          onClick={onToggleAll}
          className="flex items-center gap-2 group"
          aria-label={toggleMode === 'select' ? 'Seleziona tutte le partite' : 'Deseleziona tutte le partite'}
        >
          <div
            className={`relative w-8 h-4 rounded-full transition-colors duration-200 ${
              toggleMode === 'deselect' ? 'bg-neon' : 'bg-border group-hover:bg-border/80'
            }`}
          >
            <div
              className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform duration-200 ${
                toggleMode === 'deselect' ? 'translate-x-4' : 'translate-x-0.5'
              }`}
            />
          </div>
          <span className="text-xs text-text-secondary group-hover:text-text-primary transition-colors">
            {toggleMode === 'select' ? 'Seleziona tutte' : 'Deseleziona tutte'}
          </span>
        </button>
      </div>

      <div className="overflow-x-auto pb-2">
        <div className="flex gap-2">
          {events.map((event) => {
            const isSelected = selectedEventIds.has(event.id);
            const details = detailsMap.get(event.id);
            const isLoaded = detailsLoadedIds.has(event.id);
            const counts = getFoulCounts(details);
            const cardInfo = details?.cardInfo ?? null;

            const homeCode = event.homeTeam.nameCode ?? event.homeTeam.shortName ?? event.homeTeam.name.substring(0, 3).toUpperCase();
            const awayCode = event.awayTeam.nameCode ?? event.awayTeam.shortName ?? event.awayTeam.name.substring(0, 3).toUpperCase();
            const tournamentAbbr = abbreviateTournament(event.tournament?.uniqueTournament?.name ?? event.tournament?.name ?? '');
            const round = event.roundInfo?.round;

            return (
              <button
                key={event.id}
                onClick={() => onToggleMatch(event.id)}
                className={`relative flex-shrink-0 flex flex-col items-center justify-center px-3 py-2 rounded-lg border text-center transition-colors cursor-pointer min-w-[100px] ${
                  isSelected
                    ? 'border-neon bg-neon/5'
                    : 'border-border bg-surface hover:bg-surface-hover'
                }`}
              >
                {/* Cartellino in alto a destra */}
                {cardInfo && (
                  <div className="absolute top-1.5 right-1.5">
                    {cardInfo.type === 'yellow' && (
                      <div
                        className="rounded-sm"
                        style={{ width: '10px', height: '14px', backgroundColor: '#facc15' }}
                        title="Cartellino giallo"
                      />
                    )}
                    {cardInfo.type === 'red' && (
                      <div
                        className="rounded-sm"
                        style={{ width: '10px', height: '14px', backgroundColor: '#ef4444' }}
                        title="Cartellino rosso"
                      />
                    )}
                    {cardInfo.type === 'yellowRed' && (
                      <div className="relative" style={{ width: '16px', height: '16px' }} title="Doppio cartellino">
                        <div
                          className="absolute rounded-sm"
                          style={{ width: '10px', height: '14px', backgroundColor: '#facc15', bottom: 0, left: 0 }}
                        />
                        <div
                          className="absolute rounded-sm"
                          style={{ width: '10px', height: '14px', backgroundColor: '#ef4444', top: 0, right: 0 }}
                        />
                      </div>
                    )}
                  </div>
                )}

                {/* Torneo + giornata */}
                <span className="text-[10px] text-text-muted leading-tight truncate max-w-full">
                  {tournamentAbbr}
                  {round != null && ` G.${round}`}
                </span>

                {/* Squadre */}
                <span className="text-xs text-text-primary font-medium leading-tight mt-0.5">
                  {homeCode} - {awayCode}
                </span>

                {/* Badge falli */}
                <div className="mt-1 flex items-center gap-1">
                  {!isLoaded ? (
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] bg-border text-text-muted">
                      <span className="w-2 h-2 border border-text-muted border-t-transparent rounded-full animate-spin mr-1" />
                      ...
                    </span>
                  ) : counts != null ? (
                    <>
                      {showCommitted && showSuffered ? (
                        <>
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium ${counts.committed != null && counts.committed > 0 ? 'bg-negative/15 text-negative' : 'bg-border text-text-muted'}`}>
                            {counts.committed ?? '—'}
                          </span>
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium ${counts.suffered != null && counts.suffered > 0 ? 'bg-neon/15 text-neon' : 'bg-border text-text-muted'}`}>
                            {counts.suffered ?? '—'}
                          </span>
                        </>
                      ) : showCommitted ? (
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium ${counts.committed != null && counts.committed > 0 ? 'bg-negative/15 text-negative' : 'bg-border text-text-muted'}`}>
                          {counts.committed ?? '—'}
                        </span>
                      ) : showSuffered ? (
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium ${counts.suffered != null && counts.suffered > 0 ? 'bg-neon/15 text-neon' : 'bg-border text-text-muted'}`}>
                          {counts.suffered ?? '—'}
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] bg-border text-text-muted">
                          0
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] bg-border text-text-muted">
                      —
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
