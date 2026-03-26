import type { PlayerPosition, Player } from '@/types';
import { homeToScreen, awayToScreen } from '@/utils/positionMapping';
import PlayerDot from '@/components/common/PlayerDot';

interface FieldMapProps {
  homePositions: PlayerPosition[];
  awayPositions: PlayerPosition[];
  selectedPlayerId: number;
  involvedPlayerIds: Set<number>;
  onPlayerClick?: (player: Player) => void;
}

const FIELD_W = 680;
const FIELD_H = 1050;

export default function FieldMap({
  homePositions,
  awayPositions,
  selectedPlayerId,
  involvedPlayerIds,
  onPlayerClick,
}: FieldMapProps) {
  // Filtra: mostra solo il giocatore selezionato + quelli coinvolti nei falli
  const relevantIds = new Set([selectedPlayerId, ...involvedPlayerIds]);

  const homeDots = homePositions.filter((p) => relevantIds.has(p.player.id));
  const awayDots = awayPositions.filter((p) => relevantIds.has(p.player.id));

  if (homeDots.length === 0 && awayDots.length === 0) return null;

  const field = { width: FIELD_W, height: FIELD_H };

  return (
    <div>
      <svg
        viewBox={`0 0 ${FIELD_W} ${FIELD_H}`}
        className="w-full max-w-[238px] rounded-lg border border-field-lines"
        style={{ aspectRatio: '68/105', background: '#1a3320' }}
      >
        {/* Linee campo */}
        <rect x="10" y="10" width="660" height="1030" fill="none" stroke="#2a5535" strokeWidth="2" />
        <line x1="10" y1="525" x2="670" y2="525" stroke="#2a5535" strokeWidth="2" />
        <circle cx="340" cy="525" r="91.5" fill="none" stroke="#2a5535" strokeWidth="2" />
        <rect x="138" y="10" width="404" height="165" fill="none" stroke="#2a5535" strokeWidth="2" />
        <rect x="218" y="10" width="244" height="55" fill="none" stroke="#2a5535" strokeWidth="2" />
        <rect x="138" y="875" width="404" height="165" fill="none" stroke="#2a5535" strokeWidth="2" />
        <rect x="218" y="985" width="244" height="55" fill="none" stroke="#2a5535" strokeWidth="2" />

        {/* Giocatori casa (metà superiore) */}
        {homeDots.map((p) => {
          const pos = homeToScreen(p.averageX, p.averageY, field);
          const isSelected = p.player.id === selectedPlayerId;
          return (
            <PlayerDot
              key={p.player.id}
              x={pos.x}
              y={pos.y}
              label={p.player.shortName ?? p.player.name.split(' ').pop()}
              number={p.player.jerseyNumber}
              color={isSelected ? '#4ade80' : '#e0e0e0'}
              highlighted={isSelected}
              onClick={onPlayerClick ? () => onPlayerClick(p.player) : undefined}
            />
          );
        })}

        {/* Giocatori ospiti (metà inferiore) */}
        {awayDots.map((p) => {
          const pos = awayToScreen(p.averageX, p.averageY, field);
          const isSelected = p.player.id === selectedPlayerId;
          return (
            <PlayerDot
              key={p.player.id}
              x={pos.x}
              y={pos.y}
              label={p.player.shortName ?? p.player.name.split(' ').pop()}
              number={p.player.jerseyNumber}
              color={isSelected ? '#4ade80' : '#e0e0e0'}
              highlighted={isSelected}
              onClick={onPlayerClick ? () => onPlayerClick(p.player) : undefined}
            />
          );
        })}
      </svg>
    </div>
  );
}
