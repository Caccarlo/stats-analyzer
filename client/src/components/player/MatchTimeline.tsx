import { getTeamImageUrl } from '@/api/sofascore';
import type { MatchEvent, Team } from '@/types';
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
  playerTeamId?: number;
}

function getFoulCounts(
  details: CachedMatchDetails | undefined,
): { committed: number | null; suffered: number | null } | null {
  if (!details) return null;
  if (details.officialStatsStatus === 'loaded') {
    return {
      committed: typeof details.officialStats?.fouls === 'number' ? details.officialStats.fouls : 0,
      suffered: typeof details.officialStats?.wasFouled === 'number' ? details.officialStats.wasFouled : 0,
    };
  }
  const committed = details.officialStats?.fouls;
  const suffered = details.officialStats?.wasFouled;
  if (typeof committed !== 'number' && typeof suffered !== 'number') return null;
  return {
    committed: typeof committed === 'number' ? committed : null,
    suffered: typeof suffered === 'number' ? suffered : null,
  };
}

function renderCount(value: number | null) {
  return value != null ? value : '—';
}

function getTeamTag(team: Team): string {
  return team.nameCode ?? team.shortName ?? team.name;
}

function OpponentCrest({ team }: { team: Team }) {
  return (
    <div className="flex items-center justify-center min-h-[30px]">
      <img
        src={getTeamImageUrl(team.id)}
        alt={team.name}
        className="w-[18px] h-[18px] object-contain"
        onError={(e) => {
          (e.target as HTMLImageElement).style.display = 'none';
        }}
      />
    </div>
  );
}

function VenueBadge({ isHome }: { isHome: boolean }) {
  return (
    <div
      className="absolute top-2 left-2 flex items-center justify-center text-text-secondary"
      title={isHome ? 'Partita in casa' : 'Partita in trasferta'}
      aria-label={isHome ? 'Partita in casa' : 'Partita in trasferta'}
    >
      {isHome ? (
        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 11.5 12 4l9 7.5" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M6.5 10.5V20h11v-9.5" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M10 20v-5h4v5" />
        </svg>
      ) : (
        <span className="text-[11px] leading-none">✈</span>
      )}
    </div>
  );
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
  playerTeamId,
}: MatchTimelineProps) {
  if (events.length === 0) return null;

  return (
    <div>
      <div className="flex items-center gap-3 mb-3">
        <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-wide">
          Timeline partite ({events.length})
        </h3>
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
            const isHome = playerTeamId != null ? event.homeTeam.id === playerTeamId : false;
            const opponentTeam = isHome ? event.awayTeam : event.homeTeam;
            const scoreline = `${getTeamTag(event.homeTeam)} ${event.homeScore.current} - ${event.awayScore.current} ${getTeamTag(event.awayTeam)}`;

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
                <VenueBadge isHome={isHome} />

                {/* Cartellino in alto a destra */}
                {cardInfo && (
                  <div className="absolute top-1.5 right-1.5">
                    {cardInfo.type === 'yellow' && (
                      <div
                        className="rounded-sm"
                        style={{ width: '9px', height: '12px', backgroundColor: '#facc15' }}
                        title="Cartellino giallo"
                      />
                    )}
                    {cardInfo.type === 'red' && (
                      <div
                        className="rounded-sm"
                        style={{ width: '9px', height: '12px', backgroundColor: '#ef4444' }}
                        title="Cartellino rosso"
                      />
                    )}
                    {cardInfo.type === 'yellowRed' && (
                      <div className="relative" style={{ width: '14px', height: '14px' }} title="Doppio cartellino">
                        <div
                          className="absolute rounded-sm"
                          style={{ width: '9px', height: '12px', backgroundColor: '#facc15', bottom: 0, left: 0 }}
                        />
                        <div
                          className="absolute rounded-sm"
                          style={{ width: '9px', height: '12px', backgroundColor: '#ef4444', top: 0, right: 0 }}
                        />
                      </div>
                    )}
                  </div>
                )}

                <div className="mt-2 mb-0.5">
                  <OpponentCrest team={opponentTeam} />
                </div>
                <div className="text-[11px] leading-tight text-text-secondary font-medium whitespace-nowrap">
                  {scoreline}
                </div>

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
                            {renderCount(counts.committed)}
                          </span>
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium ${counts.suffered != null && counts.suffered > 0 ? 'bg-neon/15 text-neon' : 'bg-border text-text-muted'}`}>
                            {renderCount(counts.suffered)}
                          </span>
                        </>
                      ) : showCommitted ? (
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium ${counts.committed != null && counts.committed > 0 ? 'bg-negative/15 text-negative' : 'bg-border text-text-muted'}`}>
                          {renderCount(counts.committed)}
                        </span>
                      ) : showSuffered ? (
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium ${counts.suffered != null && counts.suffered > 0 ? 'bg-neon/15 text-neon' : 'bg-border text-text-muted'}`}>
                          {renderCount(counts.suffered)}
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
