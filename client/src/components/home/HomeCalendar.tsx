import { useCallback, useEffect, useState } from 'react';
import { useCalendarData, todayISO } from '@/hooks/useCalendarData';
import { useNavigation } from '@/context/NavigationContext';
import { createMatchupNavigationTarget } from '@/api/sofascore';
import type { MatchEvent } from '@/types';
import CalendarStrip from './CalendarStrip';
import DaySchedule from './DaySchedule';
import { usePriorityImageRevealState } from '@/components/common/PriorityImage';

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

  const { navigateTo, selectLeague, openMatchup } = useNavigation();
  const { groups, loading, error } = useCalendarData(selectedDate);
  const [readyDate, setReadyDate] = useState<string | null>(null);
  const markDayReady = useCallback((date: string) => {
    setReadyDate((current) => (current === date ? current : date));
  }, []);
  const isEmptyDay = !loading && !error && groups.length === 0;
  const isDayReady = readyDate === selectedDate || isEmptyDay;
  const revealSession = !isDayReady && !loading && !error && groups.length > 0
    ? `home-schedule-reveal:${selectedDate}`
    : null;
  const revealState = usePriorityImageRevealState(
    revealSession,
  );

  useEffect(() => {
    if (loading || error) {
      return;
    }

    if (groups.length === 0) {
      return;
    }

    if (revealState.snapshotReady && !revealState.pending) {
      queueMicrotask(() => {
        markDayReady(selectedDate);
      });
    }
  }, [error, groups.length, loading, markDayReady, revealState.pending, revealState.snapshotReady, selectedDate]);

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

  const handleOpenMatchup = (event: MatchEvent) => {
    openMatchup(createMatchupNavigationTarget(event));
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
          loading={loading || (!error && !isDayReady)}
          deferReveal={!loading && !error && groups.length > 0 && !isDayReady}
          error={error}
          onNavigateLeague={handleNavigateLeague}
          onNavigateTeam={handleNavigateTeam}
          onOpenMatchup={handleOpenMatchup}
          imageRevealSession={revealSession ?? undefined}
        />
      </div>
    </div>
  );
}
