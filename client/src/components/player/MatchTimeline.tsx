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
}

function abbreviateTournament(name: string): string {
  if (!name) return '';
  // Common abbreviations
  const words = name.split(/\s+/);
  if (words.length === 1) return words[0].substring(0, 3).toUpperCase();
  return words.map((w) => w[0]?.toUpperCase() ?? '').join('.');
}

function getFoulCounts(
  details: CachedMatchDetails | undefined,
): { committed: number; suffered: number } | null {
  if (!details) return null; // not loaded yet
  let committed = 0;
  let suffered = 0;
  for (const f of details.fouls) {
    if (f.type === 'committed' || f.type === 'handball') committed++;
    if (f.type === 'suffered') suffered++;
  }
  return { committed, suffered };
}

export default function MatchTimeline({
  events,
  selectedEventIds,
  detailsMap,
  detailsLoadedIds,
  showCommitted,
  showSuffered,
  onToggleMatch,
}: MatchTimelineProps) {
  if (events.length === 0) return null;

  return (
    <div>
      <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-wide mb-3">
        Timeline partite ({events.length})
      </h3>
      <div className="overflow-x-auto pb-2">
        <div className="flex gap-2">
          {events.map((event) => {
            const isSelected = selectedEventIds.has(event.id);
            const details = detailsMap.get(event.id);
            const isLoaded = detailsLoadedIds.has(event.id);
            const counts = getFoulCounts(details);

            const homeCode = event.homeTeam.nameCode ?? event.homeTeam.shortName ?? event.homeTeam.name.substring(0, 3).toUpperCase();
            const awayCode = event.awayTeam.nameCode ?? event.awayTeam.shortName ?? event.awayTeam.name.substring(0, 3).toUpperCase();
            const tournamentAbbr = abbreviateTournament(event.tournament?.uniqueTournament?.name ?? event.tournament?.name ?? '');
            const round = event.roundInfo?.round;

            return (
              <button
                key={event.id}
                onClick={() => onToggleMatch(event.id)}
                className={`flex-shrink-0 flex flex-col items-center justify-center px-3 py-2 rounded-lg border text-center transition-colors cursor-pointer min-w-[100px] ${
                  isSelected
                    ? 'border-neon bg-neon/5'
                    : 'border-border bg-surface hover:bg-surface-hover'
                }`}
              >
                {/* Row 1: Tournament + Round */}
                <span className="text-[10px] text-text-muted leading-tight truncate max-w-full">
                  {tournamentAbbr}
                  {round != null && ` G.${round}`}
                </span>

                {/* Row 2: Teams */}
                <span className="text-xs text-text-primary font-medium leading-tight mt-0.5">
                  {homeCode} - {awayCode}
                </span>

                {/* Row 3: Foul badges */}
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
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium ${counts.committed > 0 ? 'bg-negative/15 text-negative' : 'bg-border text-text-muted'}`}>
                            {counts.committed}
                          </span>
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium ${counts.suffered > 0 ? 'bg-neon/15 text-neon' : 'bg-border text-text-muted'}`}>
                            {counts.suffered}
                          </span>
                        </>
                      ) : showCommitted ? (
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium ${counts.committed > 0 ? 'bg-negative/15 text-negative' : 'bg-border text-text-muted'}`}>
                          {counts.committed}
                        </span>
                      ) : showSuffered ? (
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium ${counts.suffered > 0 ? 'bg-neon/15 text-neon' : 'bg-border text-text-muted'}`}>
                          {counts.suffered}
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] bg-border text-text-muted">
                          0
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] bg-border text-text-muted">
                      0
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
