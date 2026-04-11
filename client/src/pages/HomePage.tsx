import CountryList from '@/components/navigation/CountryList';
import HomeCalendar from '@/components/home/HomeCalendar';

interface HomePageProps {
  panelIndex?: number;
  calendarDate?: string;
  onSelectDate?: (d: string) => void;
  calendarInTopBar?: boolean;
}

export default function HomePage({ panelIndex = 0, calendarDate, onSelectDate, calendarInTopBar = false }: HomePageProps) {
  if (panelIndex > 0) {
    return (
      <div className="mt-4">
        <p className="text-text-secondary text-sm mb-3 px-4">Seleziona un paese per iniziare:</p>
        <CountryList panelIndex={panelIndex} />
      </div>
    );
  }

  return (
    <HomeCalendar
      panelIndex={panelIndex}
      calendarDate={calendarDate}
      onSelectDate={onSelectDate}
      calendarInTopBar={calendarInTopBar}
    />
  );
}
