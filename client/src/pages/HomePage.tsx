import CountryList from '@/components/navigation/CountryList';
import HomeCalendar from '@/components/home/HomeCalendar';

interface HomePageProps {
  panelIndex?: number;
  isSplitView?: boolean;
  compactDensity?: boolean;
  calendarDate?: string;
  onSelectDate?: (d: string) => void;
  calendarInTopBar?: boolean;
}

export default function HomePage({
  panelIndex = 0,
  isSplitView = false,
  compactDensity = false,
  calendarDate,
  onSelectDate,
  calendarInTopBar = false,
}: HomePageProps) {
  const splitSchedulePaddingClass = 'pr-10';

  const homeCalendar = (
    <HomeCalendar
      panelIndex={panelIndex}
      calendarDate={calendarDate}
      onSelectDate={onSelectDate}
      calendarInTopBar={calendarInTopBar}
      schedulePaddingClass={isSplitView ? splitSchedulePaddingClass : undefined}
    />
  );

  if (panelIndex > 0) {
    return (
      <div className="flex h-full min-h-0 gap-4">
        <aside className="hidden lg:flex h-full min-h-0 w-[190px] xl:w-[210px] shrink-0 self-stretch flex-col overflow-hidden border-r border-border bg-bg-sidebar">
          <p className="px-4 pt-3 pb-1 text-xs text-text-muted uppercase tracking-wide">Paesi</p>
          <CountryList panelIndex={panelIndex} scrollOnlyOthers />
        </aside>

        <div className="min-w-0 min-h-0 flex-1 overflow-y-auto pt-10">
          {homeCalendar}
        </div>
      </div>
    );
  }

  if (isSplitView) {
    return (
      <div className="h-full min-h-0 overflow-y-auto">
        {homeCalendar}
      </div>
    );
  }

  return (
    homeCalendar
  );
}
