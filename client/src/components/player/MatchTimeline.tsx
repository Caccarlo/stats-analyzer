import { getTeamImageUrl } from '@/api/sofascore';
import type { MatchDurationMetadata, MatchEvent, Team } from '@/types';
import type { CachedMatchDetails } from '@/hooks/useMatchDetails';
import { getPlayerMatchIsHome } from '@/utils/playerMatchVenue';

interface MatchTimelineProps {
  events: MatchEvent[];
  selectedEventIds: Set<number>;
  detailsMap: Map<number, CachedMatchDetails>;
  eventDurationMetadataMap: Map<number, MatchDurationMetadata | null>;
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

function hasExplicitOvertime(score: MatchDurationMetadata['homeScore'] | undefined): boolean {
  return Boolean(
    score &&
    (
      typeof score.period3 === 'number' ||
      typeof score.period4 === 'number' ||
      typeof score.extra1 === 'number' ||
      typeof score.extra2 === 'number'
    )
  );
}

function getMatchDuration(metadata: MatchDurationMetadata | null | undefined): number {
  const baseDuration =
    typeof metadata?.defaultPeriodCount === 'number' &&
    typeof metadata.defaultPeriodLength === 'number' &&
    metadata.defaultPeriodCount > 0 &&
    metadata.defaultPeriodLength > 0
      ? metadata.defaultPeriodCount * metadata.defaultPeriodLength
      : 90;

  const stoppageTime =
    (metadata?.time?.injuryTime1 ?? 0) +
    (metadata?.time?.injuryTime2 ?? 0) +
    (metadata?.time?.injuryTime3 ?? 0) +
    (metadata?.time?.injuryTime4 ?? 0);

  const overtimeDuration =
    typeof metadata?.defaultOvertimeLength === 'number' &&
    metadata.defaultOvertimeLength > 0 &&
    (hasExplicitOvertime(metadata.homeScore) || hasExplicitOvertime(metadata.awayScore))
      ? metadata.defaultOvertimeLength * 2
      : 0;

  return Math.max(1, baseDuration + stoppageTime + overtimeDuration);
}

function clampMinute(value: number, max: number): number {
  return Math.min(max, Math.max(0, value));
}

function getPlayedSegment(
  details: CachedMatchDetails | undefined,
  matchDuration: number,
): { startPct: number; endPct: number } | null {
  const minutesPlayed = details?.officialStats?.minutesPlayed;
  if (
    details?.officialStatsStatus !== 'loaded' ||
    typeof minutesPlayed !== 'number' ||
    minutesPlayed <= 0
  ) {
    return null;
  }

  const inMinute = details.substituteInMinute;
  const outMinute = details.substituteOutMinute;

  if (typeof inMinute === 'number') {
    const startMinute = clampMinute(inMinute, matchDuration);
    const derivedEndMinute =
      typeof outMinute === 'number' && outMinute >= startMinute
        ? clampMinute(outMinute, matchDuration)
        : matchDuration;
    return {
      startPct: (startMinute / matchDuration) * 100,
      endPct: (Math.max(startMinute, derivedEndMinute) / matchDuration) * 100,
    };
  }

  if (typeof outMinute === 'number') {
    const endMinute = clampMinute(outMinute, matchDuration);
    return {
      startPct: 0,
      endPct: (endMinute / matchDuration) * 100,
    };
  }

  if (details.isStarter === false) {
    const startMinute = clampMinute(matchDuration - minutesPlayed, matchDuration);
    return {
      startPct: (startMinute / matchDuration) * 100,
      endPct: 100,
    };
  }

  return {
    startPct: 0,
    endPct: (clampMinute(minutesPlayed, matchDuration) / matchDuration) * 100,
  };
}

function getPlayedMinutesLabel(
  details: CachedMatchDetails | undefined,
  matchDuration: number,
): string | null {
  const officialMinutes = details?.officialStats?.minutesPlayed;
  if (typeof officialMinutes === 'number' && officialMinutes > 0) {
    return `${officialMinutes}'`;
  }

  const inMinute = details?.substituteInMinute;
  const outMinute = details?.substituteOutMinute;

  if (typeof inMinute === 'number' && typeof outMinute === 'number' && outMinute >= inMinute) {
    return `${outMinute - inMinute}'`;
  }
  if (typeof inMinute === 'number') {
    return `${Math.max(0, matchDuration - inMinute)}'`;
  }
  if (typeof outMinute === 'number' && outMinute > 0) {
    return `${outMinute}'`;
  }

  return null;
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

function VenueBadge({ isHome }: { isHome: boolean | null }) {
  if (isHome === null) return null;

  return (
    <div
      className="absolute top-2 left-2 z-10 flex items-center justify-center text-text-secondary"
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
  eventDurationMetadataMap,
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
            const durationMetadata = eventDurationMetadataMap.get(event.id);
            const isLoaded = detailsLoadedIds.has(event.id);
            const counts = getFoulCounts(details);
            const cardInfo = details?.cardInfo ?? null;
            const matchDuration = getMatchDuration(durationMetadata);
            const playedSegment = getPlayedSegment(details, matchDuration);
            const playedMinutesLabel = getPlayedMinutesLabel(details, matchDuration);
            const isHome = getPlayerMatchIsHome(event, details, playerTeamId);
            const opponentTeam = isHome ? event.awayTeam : event.homeTeam;
            const scoreline = `${getTeamTag(event.homeTeam)} ${event.homeScore.current} - ${event.awayScore.current} ${getTeamTag(event.awayTeam)}`;

            return (
              <button
                key={event.id}
                onClick={() => onToggleMatch(event.id)}
                className={`relative overflow-hidden flex-shrink-0 flex flex-col items-center justify-center px-3 py-2 rounded-lg border text-center transition-colors cursor-pointer min-w-[100px] ${
                  isSelected
                    ? 'border-neon bg-neon/5'
                    : 'border-border bg-surface hover:bg-surface-hover'
                }`}
              >
                {playedSegment !== null && playedSegment.endPct > playedSegment.startPct && (
                  <div
                    className="absolute inset-px z-0 rounded-[7px] pointer-events-none"
                    style={{
                      background: `linear-gradient(to right, transparent 0%, transparent ${playedSegment.startPct.toFixed(1)}%, rgba(255,255,255,0.06) ${playedSegment.startPct.toFixed(1)}%, rgba(255,255,255,0.06) ${playedSegment.endPct.toFixed(1)}%, transparent ${playedSegment.endPct.toFixed(1)}%)`,
                    }}
                  />
                )}

                <VenueBadge isHome={isHome} />

                {playedMinutesLabel && (
                  <div className="absolute top-1.5 right-1.5 z-10 text-[8px] leading-none font-medium tabular-nums text-white/75 drop-shadow-[0_1px_1px_rgba(0,0,0,0.6)] pointer-events-none">
                    {playedMinutesLabel}
                  </div>
                )}

                {/* Cartellino in alto a destra */}
                {cardInfo && (
                  <div className="absolute top-1 right-5 z-10">
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

                <div className="relative z-10 mt-2 mb-0.5">
                  <OpponentCrest team={opponentTeam} />
                </div>
                <div className="relative z-10 text-[11px] leading-tight text-text-secondary font-medium whitespace-nowrap">
                  {scoreline}
                </div>

                {/* Badge falli */}
                <div className="relative z-10 mt-1 flex items-center gap-1">
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
