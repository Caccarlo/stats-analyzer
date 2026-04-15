import type { MatchShot, PlayerPosition, ShotmapCoordinate } from '@/types';
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
  shots?: MatchShot[];
  shotIsHomeFallback?: boolean;
  showShots?: boolean;
  showShotsOnTarget?: boolean;
  selectedShotId?: number | string | null;
  onShotSelect?: (id: number | string | null) => void;
}

const FIELD_W = 680;
const FIELD_H = 1050;
const FIELD_L_W = 1050;
const FIELD_L_H = 680;
const DOT_RADIUS_BASE = 30;
const SHOT_MARKER_RADIUS = 15;
const INNER_H = FIELD_H - 20;
const INNER_W = FIELD_W - 20;
const SHOT_POPUP_W = 440;
const SHOT_POPUP_H = 150;

type ShotOutcome = 'goal' | 'saved' | 'blocked' | 'miss' | 'post' | 'other';

function getVisibleShots(shots: MatchShot[], showShots: boolean, showShotsOnTarget: boolean): MatchShot[] {
  return shots.filter((shot) => {
    if (showShots) return true;
    if (showShotsOnTarget) return isShotOnTargetDisplay(shot);
    return false;
  });
}

function getShotStart(shot: MatchShot): ShotmapCoordinate | null {
  if (shot.draw?.start) return shot.draw.start;
  if (!shot.playerCoordinates) return null;
  return {
    x: shot.playerCoordinates.y,
    y: shot.playerCoordinates.x,
  };
}

function getShotEnd(shot: MatchShot): ShotmapCoordinate | null {
  const outcome = getShotOutcome(shot);

  if (outcome === 'blocked') {
    if (shot.draw?.block) return shot.draw.block;
    return shot.draw?.end ?? null;
  }

  if (shot.draw?.end) return shot.draw.end;

  if ((outcome === 'goal' || outcome === 'saved') && shot.draw?.goal) {
    return {
      x: shot.draw.goal.x,
      y: 0,
    };
  }

  if ((outcome === 'goal' || outcome === 'saved') && typeof shot.goalMouthCoordinates?.y === 'number') {
    return {
      x: shot.goalMouthCoordinates.y,
      y: 0,
    };
  }

  return null;
}

function shotPointToPortrait(point: ShotmapCoordinate, isHomeShot: boolean): { x: number; y: number } {
  const halfX = 10 + (point.x / 100) * INNER_W;
  const halfY = 10 + (point.y / 100) * INNER_H;

  if (isHomeShot) {
    return {
      x: FIELD_W - halfX,
      y: FIELD_H - halfY,
    };
  }

  return {
    x: halfX,
    y: halfY,
  };
}

function portraitToLandscape(point: { x: number; y: number }): { x: number; y: number } {
  return {
    x: point.y,
    y: FIELD_L_H - point.x,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getShotOutcome(shot: MatchShot): ShotOutcome {
  const shotType = shot.shotType?.toLowerCase();

  if (shot.isGoal || shotType === 'goal' || shotType === 'own') return 'goal';
  if (shotType === 'save' || shotType === 'shot-on-target') return 'saved';
  if (shotType === 'block') return 'blocked';
  if (shotType === 'post') return 'post';
  if (shotType === 'miss') return 'miss';
  if (shot.isOnTarget) return 'saved';
  if (shot.draw?.block && !shot.draw?.end && !shot.draw?.goal) return 'blocked';
  return 'other';
}

function isShotOnTargetDisplay(shot: MatchShot): boolean {
  const outcome = getShotOutcome(shot);
  return outcome === 'goal' || outcome === 'saved';
}

function getShotDisplayColor(shot: MatchShot): string {
  return isShotOnTargetDisplay(shot) ? '#7dd3fc' : '#f8fafc';
}

function formatShotOutcome(outcome: ShotOutcome): string {
  const map: Record<ShotOutcome, string> = {
    goal: 'Gol',
    saved: 'Parato',
    blocked: 'Murato',
    miss: 'Fuori',
    post: 'Palo',
    other: 'Tiro',
  };
  return map[outcome];
}

function formatShotMinute(shot: MatchShot): string | null {
  if (typeof shot.time !== 'number') return null;
  if (typeof shot.addedTime === 'number' && shot.addedTime > 0) {
    return `${shot.time}'+${shot.addedTime}`;
  }
  return `${shot.time}'`;
}

function formatBodyPart(value?: string): string | null {
  if (!value) return null;
  const normalized = value.toLowerCase();
  const map: Record<string, string> = {
    'right-foot': 'Destro',
    'left-foot': 'Sinistro',
    head: 'Testa',
    chest: 'Petto',
    other: 'Altro',
  };
  return map[normalized] ?? normalized.replace(/[-_]/g, ' ');
}

function formatMetric(value?: number): string {
  return typeof value === 'number' ? value.toFixed(2) : '-';
}

function formatShotTitle(shot: MatchShot): string {
  const minute = formatShotMinute(shot);
  const bodyPart = formatBodyPart(shot.bodyPart)?.toLowerCase();
  const outcome = formatShotOutcome(getShotOutcome(shot)).toLowerCase();
  return [minute, bodyPart, outcome].filter(Boolean).join(' ');
}

function spreadOverlappingDots(
  dots: { id: number; x: number; y: number }[],
  minSep: number,
): { id: number; x: number; y: number }[] {
  const result = dots.map((d) => ({ ...d }));
  for (let iter = 0; iter < 5; iter++) {
    let moved = false;
    for (let i = 0; i < result.length; i++) {
      for (let j = i + 1; j < result.length; j++) {
        const dx = result[j].x - result[i].x;
        const dy = result[j].y - result[i].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < minSep) {
          moved = true;
          const overlap = minSep - dist;
          let nx: number;
          let ny: number;
          if (dist < 1) {
            nx = 1;
            ny = 0;
          } else {
            nx = dx / dist;
            ny = dy / dist;
          }
          const shift = overlap / 2;
          result[i].x -= nx * shift;
          result[i].y -= ny * shift;
          result[j].x += nx * shift;
          result[j].y += ny * shift;
        }
      }
    }
    if (!moved) break;
  }
  return result;
}

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

function ShotPopup({
  x,
  y,
  shot,
}: {
  x: number;
  y: number;
  shot: MatchShot;
}) {
  const title = formatShotTitle(shot);
  const centerX = x + SHOT_POPUP_W / 2;
  const titleY = y + 56;
  const metricsY = y + 110;

  return (
    <g pointerEvents="none">
      <rect
        x={x}
        y={y}
        width={SHOT_POPUP_W}
        height={SHOT_POPUP_H}
        rx="18"
        fill="rgba(8,12,18,0.98)"
        stroke="rgba(255,255,255,0.22)"
      />
      <text x={centerX} y={titleY} fill="#f8fafc" fontSize="34" fontWeight="700" textAnchor="middle">
        {title}
      </text>
      <text x={centerX - 12} y={metricsY} fill="#f8fafc" fontSize="28" fontWeight="600" textAnchor="end">
        xG {formatMetric(shot.xg)}
      </text>
      <text x={centerX + 12} y={metricsY} fill="#7dd3fc" fontSize="28" fontWeight="600" textAnchor="start">
        xGOT {formatMetric(shot.xgot)}
      </text>
    </g>
  );
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
  shots = [],
  shotIsHomeFallback = true,
  showShots = false,
  showShotsOnTarget = false,
  selectedShotId = null,
  onShotSelect,
}: FieldMapProps) {
  const relevantIds = new Set([selectedPlayerId, activePlayerId, ...involvedPlayerIds]);
  const homeDots = homePositions.filter((p) => relevantIds.has(p.player.id));
  const awayDots = awayPositions.filter((p) => relevantIds.has(p.player.id));
  const visibleShots = getVisibleShots(shots, showShots, showShotsOnTarget);
  const selectedShot = visibleShots.find((shot) => shot.id === selectedShotId) ?? null;

  if (homeDots.length === 0 && awayDots.length === 0 && visibleShots.length === 0) return null;

  const field = { width: FIELD_W, height: FIELD_H };
  const minSep = DOT_RADIUS_BASE * dotScale;

  const portraitShots = visibleShots
    .map((shot) => {
      const startRaw = getShotStart(shot);
      if (!startRaw) return null;
      const endRaw = getShotEnd(shot);
      const isHomeShot = shot.isHome ?? shotIsHomeFallback;
      return {
        shot,
        start: shotPointToPortrait(startRaw, isHomeShot),
        end: endRaw ? shotPointToPortrait(endRaw, isHomeShot) : null,
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  if (orientation === 'landscape') {
    const rawDots = [
      ...homeDots.map((p) => ({ p, pos: homeToScreenLandscape(p.averageX, p.averageY) })),
      ...awayDots.map((p) => ({ p, pos: awayToScreenLandscape(p.averageX, p.averageY) })),
    ];
    const spread = spreadOverlappingDots(rawDots.map(({ p, pos }) => ({ id: p.player.id, x: pos.x, y: pos.y })), minSep);
    const spreadMap = new Map(spread.map((d) => [d.id, d]));
    const allDots = rawDots.sort((a, b) => (a.p.player.id === activePlayerId ? 1 : 0) - (b.p.player.id === activePlayerId ? 1 : 0));

    return (
      <div className="w-full">
        <svg
          viewBox={`0 0 ${FIELD_L_W} ${FIELD_L_H}`}
          className="w-full rounded-lg border border-field-lines"
          style={{ aspectRatio: '105/68', background: '#1a3320' }}
          onClick={() => onShotSelect?.(null)}
        >
          <rect x="10" y="10" width="1030" height="660" fill="none" stroke="#2a5535" strokeWidth="2" />
          <line x1="525" y1="10" x2="525" y2="670" stroke="#2a5535" strokeWidth="2" />
          <circle cx="525" cy="340" r="91.5" fill="none" stroke="#2a5535" strokeWidth="2" />
          <rect x="10" y="144" width="162" height="392" fill="none" stroke="#2a5535" strokeWidth="2" />
          <rect x="10" y="251" width="54" height="178" fill="none" stroke="#2a5535" strokeWidth="2" />
          <rect x="878" y="144" width="162" height="392" fill="none" stroke="#2a5535" strokeWidth="2" />
          <rect x="986" y="251" width="54" height="178" fill="none" stroke="#2a5535" strokeWidth="2" />
          <line x1="10" y1="305" x2="10" y2="375" stroke="white" strokeOpacity="0.7" strokeWidth="3" />
          <line x1="1040" y1="305" x2="1040" y2="375" stroke="white" strokeOpacity="0.7" strokeWidth="3" />

          {portraitShots.map(({ shot, start, end }) => {
            const startL = portraitToLandscape(start);
            const endL = end ? portraitToLandscape(end) : null;
            const selected = selectedShotId === shot.id;

            return (
              <g
                key={shot.id}
                onClick={(event) => {
                  event.stopPropagation();
                  onShotSelect?.(selected ? null : shot.id);
                }}
                className="cursor-pointer"
              >
                {endL && (
                  <line
                  x1={startL.x}
                  y1={startL.y}
                  x2={endL.x}
                  y2={endL.y}
                    stroke={getShotDisplayColor(shot)}
                    strokeOpacity={selected ? 0.98 : 0.88}
                    strokeWidth={selected ? 8 : 6}
                    strokeLinecap="round"
                  />
                )}
                {shot.isGoal ? (
                  <text
                    x={startL.x}
                    y={startL.y}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={selected ? '34' : '30'}
                  >
                    ⚽
                  </text>
                ) : (
                  <circle
                    cx={startL.x}
                    cy={startL.y}
                    r={selected ? SHOT_MARKER_RADIUS + 4 : SHOT_MARKER_RADIUS}
                    fill={getShotDisplayColor(shot)}
                    stroke="#0f172a"
                    strokeWidth={selected ? 4.5 : 3}
                  />
                )}
              </g>
            );
          })}

          {allDots.map(({ p }) => {
            const pos = spreadMap.get(p.player.id)!;
            return (
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
            );
          })}

          {selectedShot && (() => {
            const selected = portraitShots.find((entry) => entry.shot.id === selectedShot.id);
            if (!selected) return null;
            const anchor = portraitToLandscape(selected.start);
            const popupX = clamp(anchor.x + 24, 18, FIELD_L_W - (SHOT_POPUP_W + 18));
            const popupY = clamp(anchor.y - 164, 18, FIELD_L_H - (SHOT_POPUP_H + 18));
            return <ShotPopup x={popupX} y={popupY} shot={selectedShot} />;
          })()}
        </svg>
      </div>
    );
  }

  const rawDots = [
    ...homeDots.map((p) => ({ p, pos: homeToScreen(p.averageX, p.averageY, field) })),
    ...awayDots.map((p) => ({ p, pos: awayToScreen(p.averageX, p.averageY, field) })),
  ];
  const spread = spreadOverlappingDots(rawDots.map(({ p, pos }) => ({ id: p.player.id, x: pos.x, y: pos.y })), minSep);
  const spreadMap = new Map(spread.map((d) => [d.id, d]));
  const allDots = rawDots.sort((a, b) => (a.p.player.id === activePlayerId ? 1 : 0) - (b.p.player.id === activePlayerId ? 1 : 0));

  return (
    <div>
      <svg
        viewBox={`0 0 ${FIELD_W} ${FIELD_H}`}
        className="w-full rounded-lg border border-field-lines"
        style={{ aspectRatio: '68/105', background: '#1a3320' }}
        onClick={() => onShotSelect?.(null)}
      >
        <rect x="10" y="10" width="660" height="1030" fill="none" stroke="#2a5535" strokeWidth="2" />
        <line x1="10" y1="525" x2="670" y2="525" stroke="#2a5535" strokeWidth="2" />
        <circle cx="340" cy="525" r="91.5" fill="none" stroke="#2a5535" strokeWidth="2" />
        <rect x="144" y="10" width="392" height="162" fill="none" stroke="#2a5535" strokeWidth="2" />
        <rect x="251" y="10" width="178" height="54" fill="none" stroke="#2a5535" strokeWidth="2" />
        <rect x="144" y="878" width="392" height="162" fill="none" stroke="#2a5535" strokeWidth="2" />
        <rect x="251" y="986" width="178" height="54" fill="none" stroke="#2a5535" strokeWidth="2" />
        <line x1="305" y1="10" x2="375" y2="10" stroke="white" strokeOpacity="0.7" strokeWidth="3" />
        <line x1="305" y1="1040" x2="375" y2="1040" stroke="white" strokeOpacity="0.7" strokeWidth="3" />

        {portraitShots.map(({ shot, start, end }) => {
          const selected = selectedShotId === shot.id;

          return (
            <g
              key={shot.id}
              onClick={(event) => {
                event.stopPropagation();
                onShotSelect?.(selected ? null : shot.id);
              }}
              className="cursor-pointer"
            >
              {end && (
                <line
                  x1={start.x}
                  y1={start.y}
                  x2={end.x}
                  y2={end.y}
                  stroke={getShotDisplayColor(shot)}
                  strokeOpacity={selected ? 0.98 : 0.88}
                  strokeWidth={selected ? 8 : 6}
                  strokeLinecap="round"
                />
              )}
              {shot.isGoal ? (
                <text
                  x={start.x}
                  y={start.y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={selected ? '34' : '30'}
                >
                  ⚽
                </text>
              ) : (
                <circle
                  cx={start.x}
                  cy={start.y}
                  r={selected ? SHOT_MARKER_RADIUS + 4 : SHOT_MARKER_RADIUS}
                  fill={getShotDisplayColor(shot)}
                  stroke="#0f172a"
                  strokeWidth={selected ? 4.5 : 3}
                />
              )}
            </g>
          );
        })}

        {allDots.map(({ p }) => {
          const pos = spreadMap.get(p.player.id)!;
          return (
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
          );
        })}

        {selectedShot && (() => {
          const selected = portraitShots.find((entry) => entry.shot.id === selectedShot.id);
          if (!selected) return null;
          const popupX = clamp(selected.start.x + 24, 18, FIELD_W - (SHOT_POPUP_W + 18));
          const popupY = clamp(selected.start.y - 164, 18, FIELD_H - (SHOT_POPUP_H + 18));
          return <ShotPopup x={popupX} y={popupY} shot={selectedShot} />;
        })()}
      </svg>
    </div>
  );
}
