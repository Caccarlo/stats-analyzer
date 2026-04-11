import { useState } from 'react';
import { getCategoryImageUrl } from '@/api/sofascore';
import type { CountryGroup } from '@/hooks/useCalendarData';
import type { MatchEvent } from '@/types';
import LeagueSection from './LeagueSection';

interface CountrySectionProps {
  group: CountryGroup;
  onNavigateLeague: (leagueId: number, leagueName: string, seasonId: number) => void;
  onNavigateTeam: (teamId: number, teamName: string, event: MatchEvent) => void;
}

export default function CountrySection({
  group,
  onNavigateLeague,
  onNavigateTeam,
}: CountrySectionProps) {
  const [expanded, setExpanded] = useState(group.defaultExpanded);

  const totalMatches = group.tournaments.reduce((sum, t) => sum + t.events.length, 0);

  return (
    <div className="border-b border-border last:border-0">
      {/* Header paese */}
      <div
        className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-surface/20 transition-colors select-none"
        onClick={() => setExpanded((v) => !v)}
      >
        {/* Chevron */}
        <svg
          className={`w-3 h-3 text-text-muted flex-shrink-0 transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>

        {/* Bandiera paese */}
        <img
          src={getCategoryImageUrl(group.categoryId)}
          alt=""
          className="w-4 h-4 object-contain flex-shrink-0"
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
        />

        {/* Nome paese */}
        <span className="text-xs font-semibold text-text-primary flex-1 min-w-0 truncate">
          {group.categoryName}
        </span>

        {/* Contatore totale partite */}
        <span className="text-[10px] text-text-muted flex-shrink-0 bg-surface rounded px-1.5 py-0.5">
          {totalMatches}
        </span>
      </div>

      {/* Campionati */}
      {expanded && (
        <div className="pl-3">
          {group.tournaments.map((t) => (
            <LeagueSection
              key={t.tournamentId}
              tournamentId={t.tournamentId}
              tournamentName={t.tournamentName}
              events={t.events}
              defaultExpanded={t.defaultExpanded}
              onNavigateLeague={() => onNavigateLeague(t.tournamentId, t.tournamentName, t.seasonId)}
              onNavigateTeam={onNavigateTeam}
            />
          ))}
        </div>
      )}
    </div>
  );
}
