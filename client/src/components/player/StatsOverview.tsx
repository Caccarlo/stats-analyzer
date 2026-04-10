import type { AggregatedStats } from '@/types';

interface StatsOverviewProps {
  stats: AggregatedStats;
  showCommitted: boolean;
  showSuffered: boolean;
  showCards: boolean;
  committedLine: number;
  sufferedLine: number;
  committedHitRate: { over: number; total: number };
  sufferedHitRate: { over: number; total: number };
  compact?: boolean;
}

export default function StatsOverview({
  stats,
  showCommitted,
  showSuffered,
  showCards,
  committedLine,
  sufferedLine,
  committedHitRate,
  sufferedHitRate,
  compact = false,
}: StatsOverviewProps) {
  const sectionGapClass = compact ? 'space-y-2.5' : 'space-y-3';
  const gridGapClass = compact ? 'gap-1.5' : 'gap-2';

  return (
    <div className={sectionGapClass}>
      {showCommitted && (
        <div className={`grid grid-cols-4 ${gridGapClass}`}>
          <StatCard
            label="Falli commessi"
            value={stats.totalFoulsCommitted}
            color="text-negative"
            compact={compact}
          />
          <StatCard
            label="Media / partita"
            value={stats.avgFoulsCommittedPerMatch}
            color="text-negative"
            compact={compact}
          />
          <StatCard
            label="Media / 90 min"
            value={stats.avgFoulsCommittedPer90}
            color="text-negative"
            compact={compact}
          />
          <HitRateCard
            line={committedLine}
            hitRate={committedHitRate}
            color="text-negative"
            compact={compact}
          />
        </div>
      )}

      {showSuffered && (
        <div className={`grid grid-cols-4 ${gridGapClass}`}>
          <StatCard
            label="Falli subiti"
            value={stats.totalFoulsSuffered}
            color="text-neon"
            compact={compact}
          />
          <StatCard
            label="Media / partita"
            value={stats.avgFoulsSufferedPerMatch}
            color="text-neon"
            compact={compact}
          />
          <StatCard
            label="Media / 90 min"
            value={stats.avgFoulsSufferedPer90}
            color="text-neon"
            compact={compact}
          />
          <HitRateCard
            line={sufferedLine}
            hitRate={sufferedHitRate}
            color="text-neon"
            compact={compact}
          />
        </div>
      )}

      {showCards && (
        <div className={`grid grid-cols-4 ${gridGapClass}`}>
          <StatCard
            label="Cartellini gialli"
            value={stats.totalYellowCards}
            color="text-yellow-400"
            compact={compact}
          />
          <StatCard
            label="Cartellini rossi"
            value={stats.totalRedCards}
            color="text-negative"
            compact={compact}
          />
          <StatCard
            label="Gialli / partita"
            value={stats.avgYellowCardsPerMatch}
            color="text-yellow-400"
            compact={compact}
          />
          <StatCard
            label="Rossi / partita"
            value={stats.avgRedCardsPerMatch}
            color="text-negative"
            compact={compact}
          />
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  color,
  compact,
}: {
  label: string;
  value: number | string;
  color: string;
  compact: boolean;
}) {
  return (
    <div className={`bg-surface border border-border rounded-lg ${compact ? 'p-1.25' : 'p-1.5'}`}>
      <p className={`text-text-muted uppercase tracking-wide ${compact ? 'text-[9px] leading-tight' : 'text-[10px]'}`}>{label}</p>
      <p className={`${color} font-bold mt-0.5 ${compact ? 'text-[0.95rem] sm:text-[1.02rem]' : 'text-[1rem]'}`}>{value}</p>
    </div>
  );
}

function HitRateCard({
  line,
  hitRate,
  color,
  compact,
}: {
  line: number;
  hitRate: { over: number; total: number };
  color: string;
  compact: boolean;
}) {
  const pct = hitRate.total > 0 ? Math.round((hitRate.over / hitRate.total) * 100) : null;

  return (
    <div className={`bg-surface border border-border rounded-lg ${compact ? 'p-1.25' : 'p-1.5'}`}>
      <p className={`text-text-muted uppercase tracking-wide ${compact ? 'text-[9px] leading-tight' : 'text-[10px]'}`}>Over {line}</p>
      <p className={`${color} font-bold mt-0.5 ${compact ? 'text-[0.95rem] sm:text-[1.02rem]' : 'text-[1rem]'}`}>
        {pct !== null ? `${pct}%` : 'â€”'}
        {hitRate.total > 0 && (
          <span className={`text-text-muted font-normal ml-1 ${compact ? 'text-[9px]' : 'text-[10px]'}`}>
            {hitRate.over}/{hitRate.total}
          </span>
        )}
      </p>
    </div>
  );
}
