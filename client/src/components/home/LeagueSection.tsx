import { useState } from 'react';
import { getTournamentImageUrl } from '@/api/sofascore';
import type { MatchEvent } from '@/types';
import MatchRow from './MatchRow';

interface LeagueSectionProps {
  tournamentId: number;
  tournamentName: string;
  events: MatchEvent[];
  defaultExpanded: boolean;
  onNavigateLeague: () => void;
  onNavigateTeam: (teamId: number, teamName: string, event: MatchEvent) => void;
}

export default function LeagueSection({
  tournamentId,
  tournamentName,
  events,
  defaultExpanded,
  onNavigateLeague,
  onNavigateTeam,
}: LeagueSectionProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div className="border-b border-border/50 last:border-0">
      <div
        className="flex items-center gap-2 px-3 py-1.5 hover:bg-surface/30 transition-colors select-none cursor-default"
        onClick={() => setExpanded((v) => !v)}
      >
        <svg
          className={`w-3.5 h-3.5 text-text-muted flex-shrink-0 transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>

        <img
          src={getTournamentImageUrl(tournamentId)}
          alt=""
          className="w-4 h-4 object-contain flex-shrink-0"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = 'none';
          }}
        />

        <div className="flex-1 min-w-0">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onNavigateLeague();
            }}
            className="inline-block max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-xs font-medium text-text-secondary hover:text-neon transition-colors text-left leading-tight cursor-pointer align-middle"
            title={tournamentName}
          >
            {tournamentName}
          </button>
        </div>

        <span className="text-[10px] text-text-muted flex-shrink-0 bg-surface rounded px-1.5 py-0.5">
          {events.length}
        </span>
      </div>

      {expanded && (
        <div className="pb-1">
          {events.map((event) => (
            <MatchRow key={event.id} event={event} onNavigateTeam={onNavigateTeam} />
          ))}
        </div>
      )}
    </div>
  );
}
