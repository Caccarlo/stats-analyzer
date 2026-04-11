import type { MatchEvent } from '@/types';
import { getTeamImageUrl } from '@/api/sofascore';

interface MatchRowProps {
  event: MatchEvent;
  onNavigateTeam: (teamId: number, teamName: string, event: MatchEvent) => void;
}

function formatTime(ts: number): string {
  const d = new Date(ts * 1000);
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
}

function StatusBadge({ event }: { event: MatchEvent }) {
  const type = event.status.type;

  if (type === 'finished') {
    return (
      <span className="text-[10px] text-text-muted uppercase tracking-wide leading-none">FT</span>
    );
  }

  if (type === 'inprogress') {
    return (
      <span className="flex items-center gap-1 whitespace-nowrap">
        <span className="w-1.5 h-1.5 rounded-full bg-neon animate-pulse flex-shrink-0" />
        <span className="text-[10px] text-neon font-semibold uppercase tracking-wide leading-none">
          Live
        </span>
      </span>
    );
  }

  return null;
}

function Score({ event }: { event: MatchEvent }) {
  const type = event.status.type;

  if (type === 'finished' || type === 'inprogress') {
    const h = event.homeScore?.current ?? 0;
    const a = event.awayScore?.current ?? 0;
    return (
      <span
        className={`text-sm font-bold tabular-nums leading-none whitespace-nowrap ${type === 'inprogress' ? 'text-neon' : 'text-text-primary'}`}
      >
        {`${h} - ${a}`}
      </span>
    );
  }

  return (
    <span className="text-xs text-text-secondary tabular-nums leading-none whitespace-nowrap">
      {formatTime(event.startTimestamp)}
    </span>
  );
}

function TeamName({
  team,
  onClick,
}: {
  team: { id: number; name: string; shortName?: string };
  onClick: () => void;
}) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="text-xs text-text-primary hover:text-neon transition-colors text-left leading-tight truncate max-w-[90px]"
      title={team.name}
    >
      {team.shortName ?? team.name}
    </button>
  );
}

export default function MatchRow({ event, onNavigateTeam }: MatchRowProps) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 hover:bg-surface/40 transition-colors">
      <div className="flex items-center gap-1.5 flex-1 min-w-0 justify-end">
        <TeamName
          team={event.homeTeam}
          onClick={() => onNavigateTeam(event.homeTeam.id, event.homeTeam.name, event)}
        />
        <img
          src={getTeamImageUrl(event.homeTeam.id)}
          alt=""
          className="w-5 h-5 object-contain flex-shrink-0"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = 'none';
          }}
        />
      </div>

      <div className="flex items-center justify-center gap-1 flex-shrink-0 w-[78px]">
        <Score event={event} />
        <StatusBadge event={event} />
      </div>

      <div className="flex items-center gap-1.5 flex-1 min-w-0">
        <img
          src={getTeamImageUrl(event.awayTeam.id)}
          alt=""
          className="w-5 h-5 object-contain flex-shrink-0"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = 'none';
          }}
        />
        <TeamName
          team={event.awayTeam}
          onClick={() => onNavigateTeam(event.awayTeam.id, event.awayTeam.name, event)}
        />
      </div>
    </div>
  );
}
