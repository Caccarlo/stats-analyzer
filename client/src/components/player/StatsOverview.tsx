import type { AggregatedStats } from '@/types';

interface StatsOverviewProps {
  stats: AggregatedStats;
  showCommitted: boolean;
  showSuffered: boolean;
  showCards: boolean;
}

export default function StatsOverview({ stats, showCommitted, showSuffered, showCards }: StatsOverviewProps) {
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
      {showCards && (
        <div className="grid grid-cols-4 gap-3">
          <StatCard
            label="Cartellini gialli"
            value={stats.totalYellowCards}
            color="text-yellow-400"
          />
          <StatCard
            label="Cartellini rossi"
            value={stats.totalRedCards}
            color="text-negative"
          />
          <StatCard
            label="Gialli / partita"
            value={stats.avgYellowCardsPerMatch}
            color="text-yellow-400"
          />
          <StatCard
            label="Rossi / partita"
            value={stats.avgRedCardsPerMatch}
            color="text-negative"
          />
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number | string; color: string }) {
  return (
    <div className="bg-surface border border-border rounded-lg p-1">
      <p className="text-text-muted text-xs uppercase tracking-wide">{label}</p>
      <p className={`${color} text-lg font-bold mt-1`}>{value}</p>
    </div>
  );
}
