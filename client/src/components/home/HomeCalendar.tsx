import { useState } from 'react';
import { useCalendarData, todayISO } from '@/hooks/useCalendarData';
import { useNavigation } from '@/context/NavigationContext';
import type { MatchEvent } from '@/types';
import CalendarStrip from './CalendarStrip';
import DaySchedule from './DaySchedule';

interface HomeCalendarProps {
  panelIndex?: number;
  /** Date state lifted to App when CalendarStrip is rendered in the topBar */
  calendarDate?: string;
  onSelectDate?: (d: string) => void;
  /** When true the CalendarStrip is already rendered in the topBar; skip it here */
  calendarInTopBar?: boolean;
  schedulePaddingClass?: string;
}

export default function HomeCalendar({
  panelIndex = 0,
  calendarDate: extDate,
  onSelectDate: extSetDate,
  calendarInTopBar = false,
  schedulePaddingClass,
}: HomeCalendarProps) {
  const [internalDate, setInternalDate] = useState<string>(() => todayISO());
  const selectedDate = extDate ?? internalDate;
  const setSelectedDate = extSetDate ?? setInternalDate;

  const { navigateTo, selectLeague } = useNavigation();
  const { groups, loading, error } = useCalendarData(selectedDate);

  const handleNavigateLeague = (leagueId: number, leagueName: string, seasonId: number) => {
    selectLeague(panelIndex, leagueId, leagueName, seasonId);
  };

  const handleNavigateTeam = (teamId: number, teamName: string, event: MatchEvent) => {
    const ut = event.tournament?.uniqueTournament;
    navigateTo(panelIndex, 'team', {
      teamId,
      teamName,
      leagueId: ut?.id,
      leagueName: ut?.name,
      seasonId: event.season?.id,
      countryCategoryId: ut?.category?.id,
      countryId: ut?.category?.alpha2 ?? (ut?.category?.id != null ? String(ut.category.id) : undefined),
      countryName: ut?.category?.name,
    });
  };

  return (
    <div>
      {!calendarInTopBar && (
        <div className={schedulePaddingClass}>
          <CalendarStrip selectedDate={selectedDate} onSelectDate={setSelectedDate} />
        </div>
      )}
      <div className={schedulePaddingClass}>
        <DaySchedule
          groups={groups}
          loading={loading}
          error={error}
          onNavigateLeague={handleNavigateLeague}
          onNavigateTeam={handleNavigateTeam}
        />
      </div>
    </div>
  );
}
