import { getTeamImageUrl } from '@/api/sofascore';
import type { MatchDurationMetadata, MatchEvent, Team } from '@/types';
import type { CachedMatchDetails } from '@/hooks/useMatchDetails';
import { getPlayerMatchIsHome } from '@/utils/playerMatchVenue';
import { getMatchRoundLabel } from '@/utils/matchRoundLabel';
import { clampMinute, getMatchDuration, getNominalMatchDuration, isLikelyFullMatch } from '@/utils/matchDuration';

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

function buildPlayedSegment(
  startMinute: number,
  endMinute: number,
  matchDuration: number,
): { startPct: number; endPct: number } | null {
  const clampedStart = clampMinute(startMinute, matchDuration);
  const clampedEnd = clampMinute(endMinute, matchDuration);
  const safeEnd = Math.max(clampedStart, clampedEnd);

  if (safeEnd <= clampedStart) return null;

  return {
    startPct: (clampedStart / matchDuration) * 100,
    endPct: (safeEnd / matchDuration) * 100,
  };
}

function getPlayedSegment(
  details: CachedMatchDetails | undefined,
  matchDuration: number,
  nominalMatchDuration: number,
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
  const clampedMinutesPlayed = clampMinute(minutesPlayed, matchDuration);
  const fullMatch = isLikelyFullMatch(minutesPlayed, nominalMatchDuration);

  if (typeof inMinute === 'number' && typeof outMinute === 'number') {
    return buildPlayedSegment(inMinute, Math.max(inMinute, outMinute), matchDuration);
  }

  if (typeof inMinute === 'number') {
    return buildPlayedSegment(inMinute, inMinute + clampedMinutesPlayed, matchDuration);
  }

  if (typeof outMinute === 'number') {
    return buildPlayedSegment(outMinute - clampedMinutesPlayed, outMinute, matchDuration);
  }

  if (details.isStarter === false || details.onBench) {
    return buildPlayedSegment(matchDuration - clampedMinutesPlayed, matchDuration, matchDuration);
  }

  if (fullMatch) {
    return buildPlayedSegment(0, matchDuration, matchDuration);
  }

  return buildPlayedSegment(0, clampedMinutesPlayed, matchDuration);
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

function abbreviateTournamentName(name: string): string {
  if (!name) return '';
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  if (words.length === 1) return words[0].substring(0, 3).toUpperCase();
  return words.map((word) => word[0]?.toUpperCase() ?? '').join('.');
}

function getCompactVenueMeta(event: MatchEvent): {
  compactTournament: string | null;
  roundLabel: string | null;
} {
  const tournamentName = event.tournament?.name?.trim();
  const compactTournament = tournamentName
    ? abbreviateTournamentName(tournamentName)
    : null;
  const roundLabel = getMatchRoundLabel(event.roundInfo, 'compact');

  return {
    compactTournament,
    roundLabel,
  };
}

function getVenueMetaLabel(event: MatchEvent): string | null {
  const tournamentName = event.tournament?.name?.trim();
  const roundLabel = getMatchRoundLabel(event.roundInfo, 'full');

  if (tournamentName && roundLabel) return `${tournamentName} · ${roundLabel}`;
  if (tournamentName) return tournamentName;
  return roundLabel;
}

function VenueBadge({
  isHome,
  tournamentLabel,
  roundLabel,
  titleLabel,
}: {
  isHome: boolean | null;
  tournamentLabel?: string | null;
  roundLabel?: string | null;
  titleLabel?: string | null;
}) {
  if (isHome === null) return null;

  return (
    <div
      className="absolute top-1.5 left-1 right-8 z-10 flex items-center gap-1 text-text-secondary pointer-events-none"
      title={isHome ? 'Partita in casa' : 'Partita in trasferta'}
      aria-label={isHome ? 'Partita in casa' : 'Partita in trasferta'}
    >
      <span className="flex h-[11px] w-[11px] flex-shrink-0 items-center justify-center">
      {isHome ? (
        <svg className="h-[11px] w-[11px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 11.5 12 4l9 7.5" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M6.5 10.5V20h11v-9.5" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M10 20v-5h4v5" />
        </svg>
      ) : (
        <span className="text-[11px] leading-none">✈</span>
      )}
      </span>
      {(tournamentLabel || roundLabel) ? (
        <span className="flex min-w-0 items-center gap-1 text-[8px] font-medium leading-none" title={titleLabel ?? undefined}>
          {tournamentLabel ? (
            <span className="min-w-0 overflow-hidden whitespace-nowrap">
              {tournamentLabel}
            </span>
          ) : null}
          {roundLabel ? (
            <span className="flex-shrink-0 whitespace-nowrap">
              {roundLabel}
            </span>
          ) : null}
        </span>
      ) : null}
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
            const nominalMatchDuration = getNominalMatchDuration(durationMetadata);
            const playedSegment = getPlayedSegment(details, matchDuration, nominalMatchDuration);
            const playedMinutesLabel = getPlayedMinutesLabel(details, matchDuration);
            const isHome = getPlayerMatchIsHome(event, details, playerTeamId);
            const opponentTeam = isHome ? event.awayTeam : event.homeTeam;
            const scoreline = `${getTeamTag(event.homeTeam)} ${event.homeScore.current} - ${event.awayScore.current} ${getTeamTag(event.awayTeam)}`;
            const venueMeta = getCompactVenueMeta(event);
            const venueMetaTitle = getVenueMetaLabel(event);

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

                <VenueBadge
                  isHome={isHome}
                  tournamentLabel={venueMeta.compactTournament}
                  roundLabel={venueMeta.roundLabel}
                  titleLabel={venueMetaTitle}
                />

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

                <div className="relative z-10 mt-4 mb-0.5">
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
