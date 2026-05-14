import { useState } from 'react';
import { getCategoryImageUrl } from '@/api/sofascore';
import PriorityImage from '@/components/common/PriorityImage';
import type { CountryGroup } from '@/hooks/useCalendarData';
import type { MatchEvent } from '@/types';
import LeagueSection from './LeagueSection';

interface CountrySectionProps {
  group: CountryGroup;
  onNavigateLeague: (leagueId: number, leagueName: string, seasonId: number) => void;
  onNavigateTeam: (teamId: number, teamName: string, event: MatchEvent) => void;
  onOpenMatchup?: (event: MatchEvent) => void;
  imageRevealSession?: string;
}

export default function CountrySection({
  group,
  onNavigateLeague,
  onNavigateTeam,
  onOpenMatchup,
  imageRevealSession,
}: CountrySectionProps) {
  const [expanded, setExpanded] = useState(group.defaultExpanded);
  const [expansionPriorityToken, setExpansionPriorityToken] = useState(0);

  const totalMatches = group.tournaments.reduce((sum, t) => sum + t.events.length, 0);

  const handleToggle = () => {
    if (!expanded) {
      setExpansionPriorityToken((token) => token + 1);
    }
    setExpanded((value) => !value);
  };

  return (
    <div className="border-b border-border last:border-0">
      {/* Header paese */}
      <div
        className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-surface/20 transition-colors select-none"
        onClick={handleToggle}
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
        <PriorityImage
          src={getCategoryImageUrl(group.categoryId)}
          alt=""
          className="w-4 h-4 object-contain flex-shrink-0"
          width={16}
          height={16}
          revealSession={imageRevealSession}
          hideOnError
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
              onOpenMatchup={onOpenMatchup}
              expansionPriorityToken={expansionPriorityToken}
              imageRevealSession={imageRevealSession}
            />
          ))}
        </div>
      )}
    </div>
  );
}
