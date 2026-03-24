import type { AggregatedStats } from '@/types';

interface StatsOverviewProps {
  stats: AggregatedStats;
  showCommitted: boolean;
  showSuffered: boolean;
}

export default function StatsOverview({ stats, showCommitted, showSuffered }: StatsOverviewProps) {
  return (
    <div className="space-y-4">
      {/* Falli commessi */}
      {showCommitted && (
        <div className="grid grid-cols-3 gap-3">
          <StatCard
            label="Falli commessi"
            value={stats.totalFoulsCommitted}
            color="text-negative"
          />
          <StatCard
            label="Media / partita"
            value={stats.avgFoulsCommittedPerMatch}
            color="text-negative"
          />
          <StatCard
            label="Media / 90 min"
            value={stats.avgFoulsCommittedPer90}
            color="text-negative"
          />
        </div>
      )}

      {/* Falli subiti */}
      {showSuffered && (
        <div className="grid grid-cols-3 gap-3">
          <StatCard
            label="Falli subiti"
            value={stats.totalFoulsSuffered}
            color="text-neon"
          />
          <StatCard
            label="Media / partita"
            value={stats.avgFoulsSufferedPerMatch}
            color="text-neon"
          />
          <StatCard
            label="Media / 90 min"
            value={stats.avgFoulsSufferedPer90}
            color="text-neon"
          />
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number | string; color: string }) {
  return (
    <div className="bg-surface border border-border rounded-lg p-4">
      <p className="text-text-muted text-xs uppercase tracking-wide">{label}</p>
      <p className={`${color} text-2xl font-bold mt-1`}>{value}</p>
    </div>
  );
}
