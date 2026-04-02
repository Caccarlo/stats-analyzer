import { getPlayerImageUrl, getTeamImageUrl } from '@/api/sofascore';
import type { Player, NationalTeamStat } from '@/types';

const positionLabels: Record<string, string> = {
  G: 'Portiere',
  D: 'Difensore',
  M: 'Centrocampista',
  F: 'Attaccante',
};

interface PlayerHeaderProps {
  player: Player;
  nationalStats?: NationalTeamStat[];
}

function TeamBadge({ teamId, teamName }: { teamId: number; teamName: string }) {
  return (
    <img
      src={getTeamImageUrl(teamId)}
      alt=""
      title={teamName}
      className="w-5 h-5 object-contain"
      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
    />
  );
}

export default function PlayerHeader({ player, nationalStats = [] }: PlayerHeaderProps) {
  const visibleNationalStats = nationalStats.slice(0, 2);

  return (
    <div className="flex items-center gap-4">
      <img
        src={getPlayerImageUrl(player.id)}
        alt=""
        className="w-16 h-16 rounded-full bg-border object-cover"
        onError={(e) => {
          (e.target as HTMLImageElement).src = '';
          (e.target as HTMLImageElement).className = 'w-16 h-16 rounded-full bg-surface border border-border';
        }}
      />
      <div>
        <h2 className="text-xl font-bold text-text-primary uppercase tracking-wide">
          {player.name}
        </h2>
        <div className="flex flex-wrap items-center gap-2 text-text-secondary text-sm mt-1">
          {player.team && (
            <>
              <TeamBadge teamId={player.team.id} teamName={player.team.name} />
              <span>{player.team.name}</span>
            </>
          )}

          {visibleNationalStats.length > 0 && (
            <>
              {player.team && <span className="text-text-muted">|</span>}
              <span className="flex items-center gap-2">
                {visibleNationalStats.map((stat, index) => (
                  <span key={`${stat.team.id}-${stat.debutTimestamp}`} className="flex items-center gap-2">
                    {index > 0 && <span className="text-text-muted">-&gt;</span>}
                    <TeamBadge teamId={stat.team.id} teamName={stat.team.name} />
                  </span>
                ))}
              </span>
            </>
          )}

          {(player.team || visibleNationalStats.length > 0) && (
            <span className="text-text-muted">&middot;</span>
          )}

          <span>{positionLabels[player.position] ?? player.position}</span>

          {player.jerseyNumber && (
            <>
              <span className="text-text-muted">&middot;</span>
              <span>#{player.jerseyNumber}</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
