import type { CountryGroup } from '@/hooks/useCalendarData';
import type { MatchEvent } from '@/types';
import CountrySection from './CountrySection';

interface DayScheduleProps {
  groups: CountryGroup[];
  loading: boolean;
  deferReveal?: boolean;
  error: string | null;
  onNavigateLeague: (leagueId: number, leagueName: string, seasonId: number) => void;
  onNavigateTeam: (teamId: number, teamName: string, event: MatchEvent) => void;
  onOpenMatchup?: (event: MatchEvent) => void;
  imageRevealSession?: string;
}

export default function DaySchedule({
  groups,
  loading,
  deferReveal = false,
  error,
  onNavigateLeague,
  onNavigateTeam,
  onOpenMatchup,
  imageRevealSession,
}: DayScheduleProps) {
  const renderGroups = () => (
    <>
      {groups.map((g) => (
        <CountrySection
          key={g.categoryId}
          group={g}
          onNavigateLeague={onNavigateLeague}
          onNavigateTeam={onNavigateTeam}
          onOpenMatchup={onOpenMatchup}
          imageRevealSession={imageRevealSession}
        />
      ))}
    </>
  );

  if (loading && groups.length === 0) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-5 h-5 border-2 border-neon border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-4 py-8 text-center text-text-muted text-sm">{error}</div>
    );
  }

  if (groups.length === 0) {
    return (
      <div className="px-4 py-8 text-center text-text-muted text-sm">
        Nessuna partita in programma per questa giornata.
      </div>
    );
  }

  const showLoader = loading || deferReveal;
  const contentIsHidden = deferReveal;

  return (
    <div>
      {showLoader && (
        <div className="flex items-center justify-center py-12">
          <div className="w-5 h-5 border-2 border-neon border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      <div
        className={contentIsHidden ? 'opacity-0 pointer-events-none overflow-hidden max-h-screen' : 'opacity-100 transition-opacity duration-150'}
        aria-hidden={contentIsHidden ? 'true' : undefined}
      >
        {renderGroups()}
      </div>
    </div>
  );
}
