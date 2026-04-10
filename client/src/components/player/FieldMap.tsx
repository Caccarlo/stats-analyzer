import type { PlayerPosition } from '@/types';
import { homeToScreen, awayToScreen } from '@/utils/positionMapping';
import PlayerDot from '@/components/common/PlayerDot';

interface FieldMapProps {
  homePositions: PlayerPosition[];
  awayPositions: PlayerPosition[];
  selectedPlayerId: number;
  activePlayerId: number;
  involvedPlayerIds: Set<number>;
  onActivePlayerChange: (id: number) => void;
  orientation?: 'portrait' | 'landscape';
  dotScale?: number;
}

const FIELD_W = 680;
const FIELD_H = 1050;
const FIELD_L_W = 1050;
const FIELD_L_H = 680;

// Landscape: campo ruotato 90° in senso orario, home a sinistra, away a destra
function homeToScreenLandscape(avgX: number, avgY: number): { x: number; y: number } {
  return {
    x: (avgX / 100) * FIELD_L_W,
    y: (1 - avgY / 100) * FIELD_L_H,
  };
}

function awayToScreenLandscape(avgX: number, avgY: number): { x: number; y: number } {
  return {
    x: (1 - avgX / 100) * FIELD_L_W,
    y: (avgY / 100) * FIELD_L_H,
  };
}

export default function FieldMap({
  homePositions,
  awayPositions,
  selectedPlayerId,
  activePlayerId,
  involvedPlayerIds,
  onActivePlayerChange,
  orientation = 'portrait',
  dotScale = 1,
}: FieldMapProps) {
  const relevantIds = new Set([selectedPlayerId, activePlayerId, ...involvedPlayerIds]);
  const homeDots = homePositions.filter((p) => relevantIds.has(p.player.id));
  const awayDots = awayPositions.filter((p) => relevantIds.has(p.player.id));

  if (homeDots.length === 0 && awayDots.length === 0) return null;

  const field = { width: FIELD_W, height: FIELD_H };

  if (orientation === 'landscape') {
    const allDots = [
      ...homeDots.map((p) => ({ p, pos: homeToScreenLandscape(p.averageX, p.averageY) })),
      ...awayDots.map((p) => ({ p, pos: awayToScreenLandscape(p.averageX, p.averageY) })),
    ].sort((a, b) => (a.p.player.id === activePlayerId ? 1 : 0) - (b.p.player.id === activePlayerId ? 1 : 0));

    return (
      <div className="w-full">
        <svg
          viewBox={`0 0 ${FIELD_L_W} ${FIELD_L_H}`}
          className="w-full rounded-lg border border-field-lines"
          style={{ aspectRatio: '105/68', background: '#1a3320' }}
        >
          {/* Linee campo landscape — campo ruotato 90° CW */}
          <rect x="10" y="10" width="1030" height="660" fill="none" stroke="#2a5535" strokeWidth="2" />
          {/* Linea di centrocampo (verticale) */}
          <line x1="525" y1="10" x2="525" y2="670" stroke="#2a5535" strokeWidth="2" />
          <circle cx="525" cy="340" r="91.5" fill="none" stroke="#2a5535" strokeWidth="2" />
          {/* Area di rigore sinistra (home) */}
          <rect x="10" y="138" width="165" height="404" fill="none" stroke="#2a5535" strokeWidth="2" />
          <rect x="10" y="218" width="55" height="244" fill="none" stroke="#2a5535" strokeWidth="2" />
          {/* Area di rigore destra (away) */}
          <rect x="875" y="138" width="165" height="404" fill="none" stroke="#2a5535" strokeWidth="2" />
          <rect x="985" y="218" width="55" height="244" fill="none" stroke="#2a5535" strokeWidth="2" />

          {allDots.map(({ p, pos }) => (
            <PlayerDot
              key={p.player.id}
              x={pos.x}
              y={pos.y}
              number={p.player.jerseyNumber}
              color={p.player.id === selectedPlayerId ? '#4ade80' : '#e0e0e0'}
              highlighted={p.player.id === activePlayerId}
              onClick={() => onActivePlayerChange(p.player.id)}
              sizeScale={dotScale}
            />
          ))}
        </svg>
      </div>
    );
  }

  // Portrait (default)
  const allDots = [
    ...homeDots.map((p) => ({ p, pos: homeToScreen(p.averageX, p.averageY, field) })),
    ...awayDots.map((p) => ({ p, pos: awayToScreen(p.averageX, p.averageY, field) })),
  ].sort((a, b) => (a.p.player.id === activePlayerId ? 1 : 0) - (b.p.player.id === activePlayerId ? 1 : 0));

  return (
    <div>
      <svg
        viewBox={`0 0 ${FIELD_W} ${FIELD_H}`}
        className="w-full rounded-lg border border-field-lines"
        style={{ aspectRatio: '68/105', background: '#1a3320' }}
      >
        {/* Linee campo portrait */}
        <rect x="10" y="10" width="660" height="1030" fill="none" stroke="#2a5535" strokeWidth="2" />
        <line x1="10" y1="525" x2="670" y2="525" stroke="#2a5535" strokeWidth="2" />
        <circle cx="340" cy="525" r="91.5" fill="none" stroke="#2a5535" strokeWidth="2" />
        <rect x="138" y="10" width="404" height="165" fill="none" stroke="#2a5535" strokeWidth="2" />
        <rect x="218" y="10" width="244" height="55" fill="none" stroke="#2a5535" strokeWidth="2" />
        <rect x="138" y="875" width="404" height="165" fill="none" stroke="#2a5535" strokeWidth="2" />
        <rect x="218" y="985" width="244" height="55" fill="none" stroke="#2a5535" strokeWidth="2" />

        {allDots.map(({ p, pos }) => (
          <PlayerDot
            key={p.player.id}
            x={pos.x}
            y={pos.y}
            number={p.player.jerseyNumber}
            color={p.player.id === selectedPlayerId ? '#4ade80' : '#e0e0e0'}
            highlighted={p.player.id === activePlayerId}
            onClick={() => onActivePlayerChange(p.player.id)}
            sizeScale={dotScale}
          />
        ))}
      </svg>
    </div>
  );
}
