import { useRef, useEffect, useState, useCallback } from 'react';
import { todayISO } from '@/hooks/useCalendarData';

const DAY_ABBR = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];
const BATCH_SIZE = 20;

function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function buildInitialDates(center: string): string[] {
  const dates: string[] = [];
  for (let i = -BATCH_SIZE; i <= BATCH_SIZE; i++) {
    dates.push(addDays(center, i));
  }
  return dates;
}

interface CalendarStripProps {
  selectedDate: string;
  onSelectDate: (date: string) => void;
}

export default function CalendarStrip({ selectedDate, onSelectDate }: CalendarStripProps) {
  const today = todayISO();
  const [dates, setDates] = useState<string[]>(() => buildInitialDates(today));
  const scrollRef = useRef<HTMLDivElement>(null);
  const isInitialScrollDone = useRef(false);

  // Scroll al giorno selezionato al mount e quando cambia la data
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    const idx = dates.indexOf(selectedDate);
    if (idx === -1) return;

    const cellWidth = 44; // larghezza approssimativa di ogni cella
    const containerWidth = container.clientWidth;
    const scrollTarget = idx * cellWidth - (containerWidth / 2 - cellWidth / 2);

    if (!isInitialScrollDone.current) {
      container.scrollLeft = Math.max(0, scrollTarget);
      isInitialScrollDone.current = true;
    } else {
      container.scrollTo({ left: Math.max(0, scrollTarget), behavior: 'smooth' });
    }
  }, [selectedDate, dates]);

  // Carica più giorni quando si raggiunge il bordo
  const handleScroll = useCallback(() => {
    const container = scrollRef.current;
    if (!container) return;

    const { scrollLeft, scrollWidth, clientWidth } = container;

    if (scrollLeft < 100) {
      // Aggiungi giorni in testa
      setDates((prev) => {
        const newDates: string[] = [];
        for (let i = BATCH_SIZE; i >= 1; i--) {
          newDates.push(addDays(prev[0], -i));
        }
        return [...newDates, ...prev];
      });
      // Mantieni la posizione di scroll
      const cellWidth = 44;
      container.scrollLeft = scrollLeft + BATCH_SIZE * cellWidth;
    } else if (scrollLeft + clientWidth > scrollWidth - 100) {
      // Aggiungi giorni in coda
      setDates((prev) => {
        const newDates: string[] = [];
        const last = prev[prev.length - 1];
        for (let i = 1; i <= BATCH_SIZE; i++) {
          newDates.push(addDays(last, i));
        }
        return [...prev, ...newDates];
      });
    }
  }, []);

  return (
    <div className="border-b border-border bg-bg flex-shrink-0">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex overflow-x-auto scrollbar-none"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        {dates.map((date) => {
          const d = new Date(date + 'T12:00:00');
          const isToday = date === today;
          const isSelected = date === selectedDate;
          const dayName = DAY_ABBR[d.getDay()];
          const dayNum = d.getDate();

          return (
            <button
              key={date}
              onClick={() => onSelectDate(date)}
              className={`
                flex-shrink-0 flex flex-col items-center justify-center gap-0.5
                w-[44px] py-1 text-xs font-medium transition-colors relative
                ${isSelected
                  ? 'text-neon'
                  : 'text-text-secondary hover:text-text-primary'
                }
              `}
            >
              <span className={`text-[10px] uppercase tracking-wide ${isSelected ? 'text-neon' : 'text-text-muted'}`}>
                {dayName}
              </span>
              <span className={`text-sm font-semibold ${isSelected ? 'text-neon' : ''}`}>
                {dayNum}
              </span>
              {isToday && (
                <span className={`w-1 h-1 rounded-full ${isSelected ? 'bg-neon' : 'bg-text-muted'}`} />
              )}
              {isSelected && (
                <span className="absolute bottom-0 left-3 right-3 h-[2px] bg-neon rounded-full" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
