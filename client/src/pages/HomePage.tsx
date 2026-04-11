import CountryList from '@/components/navigation/CountryList';
import HomeCalendar from '@/components/home/HomeCalendar';

interface HomePageProps {
  panelIndex?: number;
  calendarDate?: string;
  onSelectDate?: (d: string) => void;
  calendarInTopBar?: boolean;
}

export default function HomePage({ panelIndex = 0, calendarDate, onSelectDate, calendarInTopBar = false }: HomePageProps) {
  const homeCalendar = (
    <HomeCalendar
      panelIndex={panelIndex}
      calendarDate={calendarDate}
      onSelectDate={onSelectDate}
      calendarInTopBar={calendarInTopBar}
    />
  );

  if (panelIndex > 0) {
    return (
      <div className="flex h-full min-h-0 gap-4">
        <aside className="hidden lg:flex h-full min-h-0 w-[190px] xl:w-[210px] shrink-0 self-stretch -mt-4 -mb-4 -ml-4 overflow-hidden border-r border-border bg-bg-sidebar">
          <CountryList panelIndex={panelIndex} scrollOnlyOthers />
        </aside>

        <div className="min-w-0 min-h-0 flex-1 overflow-hidden">
          {homeCalendar}
        </div>
      </div>
    );
  }

  return (
    homeCalendar
  );
}
