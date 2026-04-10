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
  compact?: boolean;
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

export default function PlayerHeader({ player, nationalStats = [], compact = false }: PlayerHeaderProps) {
  const visibleNationalStats = nationalStats.slice(0, 2);
  const avatarClass = compact ? 'w-[3.25rem] h-[3.25rem]' : 'w-[3.5rem] h-[3.5rem]';
  const titleClass = compact ? 'text-[1.05rem] sm:text-[1.2rem]' : 'text-[1.16rem]';
  const metaClass = compact ? 'text-[10px] sm:text-xs mt-0.5' : 'text-[12px] mt-0.5';

  return (
    <div className={`flex items-center ${compact ? 'gap-2.5' : 'gap-3'}`}>
      <img
        src={getPlayerImageUrl(player.id)}
        alt=""
        className={`${avatarClass} rounded-full bg-border object-cover`}
        onError={(e) => {
          (e.target as HTMLImageElement).src = '';
          (e.target as HTMLImageElement).className = `${avatarClass} rounded-full bg-surface border border-border`;
        }}
      />
      <div className="min-w-0">
        <h2 className={`${titleClass} font-bold text-text-primary uppercase tracking-wide leading-tight`}>
          {player.name}
        </h2>
        <div className={`flex flex-wrap items-center gap-2 text-text-secondary ${metaClass}`}>
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
