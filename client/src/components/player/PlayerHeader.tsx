import { getPlayerImageUrl, getTeamImageUrl } from '@/api/sofascore';
import type { Player } from '@/types';

const positionLabels: Record<string, string> = {
  G: 'Portiere',
  D: 'Difensore',
  M: 'Centrocampista',
  F: 'Attaccante',
};

interface PlayerHeaderProps {
  player: Player;
}

export default function PlayerHeader({ player }: PlayerHeaderProps) {
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
        <div className="flex items-center gap-2 text-text-secondary text-sm mt-1">
          {player.team && (
            <>
              <img
                src={getTeamImageUrl(player.team.id)}
                alt=""
                className="w-5 h-5 object-contain"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
              <span>{player.team.name}</span>
              <span className="text-text-muted">·</span>
            </>
          )}
          <span>{positionLabels[player.position] ?? player.position}</span>
          {player.jerseyNumber && (
            <>
              <span className="text-text-muted">·</span>
              <span>#{player.jerseyNumber}</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
