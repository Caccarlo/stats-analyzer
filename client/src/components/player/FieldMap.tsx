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
const SHOT_MARKER_RADIUS = 12;
const HALF_PITCH_LENGTH = 515;
const INNER_W = 660;
const INNER_H = 660;
const PORTRAIT_MIDLINE_Y = 525;
const LANDSCAPE_MIDLINE_X = 525;
const PORTRAIT_GOAL_LINE_TOP = 10;
const PORTRAIT_GOAL_LINE_BOTTOM = 1040;
const LANDSCAPE_GOAL_LINE_LEFT = 10;
const LANDSCAPE_GOAL_LINE_RIGHT = 1040;
const GOAL_MOUTH_START = 218;
const GOAL_MOUTH_SIZE = 244;

function clampPct(value: number | undefined): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return 50;
  return Math.min(100, Math.max(0, value));
}

function normalizeGoalMouthRatio(value: number | undefined): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0.5;
  if (value >= 0 && value <= 1) return value;
  if (value >= -1 && value <= 1) return (value + 1) / 2;
  if (value >= 0 && value <= 100) return value / 100;
  if (value >= -50 && value <= 50) return (value + 50) / 100;
  return Math.min(1, Math.max(0, value / 100));
}

function getVisibleShots(shots: MatchShot[], showShots: boolean, showShotsOnTarget: boolean): MatchShot[] {
  return shots.filter((shot) => {
    if (showShots) return true;
    if (showShotsOnTarget) return shot.isOnTarget;
    return false;
  });
}

function getShotOrigin(shot: MatchShot): ShotmapCoordinate | null {
  return shot.draw?.start ?? shot.playerCoordinates ?? null;
}

function getShotHalfPitchTarget(shot: MatchShot): ShotmapCoordinate | null {
  return shot.draw?.end ?? shot.draw?.block ?? shot.draw?.goal ?? null;
}

function formatShotType(value?: string): string {
  if (!value) return 'Tiro';
  const normalized = value.toLowerCase();
  const map: Record<string, string> = {
    goal: 'Gol',
    save: 'Parata',
    miss: 'Fuori',
    post: 'Palo',
    block: 'Murato',
    own: 'Autogol',
    header: 'Colpo di testa',
  };
  if (map[normalized]) return map[normalized];
  return normalized.replace(/[-_]/g, ' ');
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
  return typeof value === 'number' ? value.toFixed(2) : '—';
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

function mapHalfPitchOriginPortrait(point: ShotmapCoordinate, isHome: boolean): { x: number; y: number } {
  const depth = clampPct(point.x) / 100;
  const lateral = clampPct(point.y) / 100;

  if (isHome) {
    return {
      x: 10 + lateral * INNER_W,
      y: PORTRAIT_MIDLINE_Y + depth * HALF_PITCH_LENGTH,
    };
  }

  return {
    x: 10 + (1 - lateral) * INNER_W,
    y: PORTRAIT_MIDLINE_Y - depth * HALF_PITCH_LENGTH,
  };
}

function mapHalfPitchOriginLandscape(point: ShotmapCoordinate, isHome: boolean): { x: number; y: number } {
  const depth = clampPct(point.x) / 100;
  const lateral = clampPct(point.y) / 100;

  if (isHome) {
    return {
      x: LANDSCAPE_MIDLINE_X + depth * HALF_PITCH_LENGTH,
      y: 10 + (1 - lateral) * INNER_H,
    };
  }

  return {
    x: LANDSCAPE_MIDLINE_X - depth * HALF_PITCH_LENGTH,
    y: 10 + lateral * INNER_H,
  };
}

function mapGoalTargetPortrait(shot: MatchShot, isHome: boolean): { x: number; y: number } {
  const ratio = normalizeGoalMouthRatio(shot.goalMouthCoordinates?.x);

  if (isHome) {
    return {
      x: GOAL_MOUTH_START + ratio * GOAL_MOUTH_SIZE,
      y: PORTRAIT_GOAL_LINE_BOTTOM,
    };
  }

  return {
    x: GOAL_MOUTH_START + (1 - ratio) * GOAL_MOUTH_SIZE,
    y: PORTRAIT_GOAL_LINE_TOP,
  };
}

function mapGoalTargetLandscape(shot: MatchShot, isHome: boolean): { x: number; y: number } {
  const ratio = normalizeGoalMouthRatio(shot.goalMouthCoordinates?.x);

  if (isHome) {
    return {
      x: LANDSCAPE_GOAL_LINE_RIGHT,
      y: GOAL_MOUTH_START + (1 - ratio) * GOAL_MOUTH_SIZE,
    };
  }

  return {
    x: LANDSCAPE_GOAL_LINE_LEFT,
    y: GOAL_MOUTH_START + ratio * GOAL_MOUTH_SIZE,
  };
}

function getShotEndPortrait(shot: MatchShot, isHome: boolean): { x: number; y: number } | null {
  if (shot.isOnTarget) return mapGoalTargetPortrait(shot, isHome);
  const target = getShotHalfPitchTarget(shot);
  return target ? mapHalfPitchOriginPortrait(target, isHome) : null;
}

function getShotEndLandscape(shot: MatchShot, isHome: boolean): { x: number; y: number } | null {
  if (shot.isOnTarget) return mapGoalTargetLandscape(shot, isHome);
  const target = getShotHalfPitchTarget(shot);
  return target ? mapHalfPitchOriginLandscape(target, isHome) : null;
}

function drawFieldBasePortrait() {
  return (
    <>
      <rect x="10" y="10" width="660" height="1030" fill="none" stroke="#2a5535" strokeWidth="2" />
      <line x1="10" y1="525" x2="670" y2="525" stroke="#2a5535" strokeWidth="2" />
      <circle cx="340" cy="525" r="91.5" fill="none" stroke="#2a5535" strokeWidth="2" />
      <rect x="138" y="10" width="404" height="165" fill="none" stroke="#2a5535" strokeWidth="2" />
      <rect x="218" y="10" width="244" height="55" fill="none" stroke="#2a5535" strokeWidth="2" />
      <rect x="138" y="875" width="404" height="165" fill="none" stroke="#2a5535" strokeWidth="2" />
      <rect x="218" y="985" width="244" height="55" fill="none" stroke="#2a5535" strokeWidth="2" />
    </>
  );
}

function drawFieldBaseLandscape() {
  return (
    <>
      <rect x="10" y="10" width="1030" height="660" fill="none" stroke="#2a5535" strokeWidth="2" />
      <line x1="525" y1="10" x2="525" y2="670" stroke="#2a5535" strokeWidth="2" />
      <circle cx="525" cy="340" r="91.5" fill="none" stroke="#2a5535" strokeWidth="2" />
      <rect x="10" y="138" width="165" height="404" fill="none" stroke="#2a5535" strokeWidth="2" />
      <rect x="10" y="218" width="55" height="244" fill="none" stroke="#2a5535" strokeWidth="2" />
      <rect x="875" y="138" width="165" height="404" fill="none" stroke="#2a5535" strokeWidth="2" />
      <rect x="985" y="218" width="55" height="244" fill="none" stroke="#2a5535" strokeWidth="2" />
    </>
  );
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
  const popupW = 320;
  const popupH = 120;
  const bodyPart = formatBodyPart(shot.bodyPart);

  return (
    <g pointerEvents="none">
      <rect
        x={x}
        y={y}
        width={popupW}
        height={popupH}
        rx="14"
        fill="rgba(9,14,20,0.96)"
        stroke="rgba(255,255,255,0.18)"
      />
      <text x={x + 16} y={y + 28} fill="#e5eefc" fontSize="18" fontWeight="700">
        {bodyPart ? `${bodyPart} · ${formatShotType(shot.shotType)}` : formatShotType(shot.shotType)}
      </text>
      <text x={x + 16} y={y + 58} fill="#f8fafc" fontSize="16" fontWeight="600">
        xG {formatMetric(shot.xg)}
      </text>
      <text x={x + 140} y={y + 58} fill="#7dd3fc" fontSize="16" fontWeight="600">
        xGOT {formatMetric(shot.xgot)}
      </text>
      <text x={x + 16} y={y + 88} fill="#cbd5e1" fontSize="15">
        {shot.time != null ? `${shot.time}'` : 'Tiro selezionato'}
      </text>
      <text x={x + 16} y={y + 108} fill="#94a3b8" fontSize="13">
        {shot.isOnTarget ? 'Tiro in porta' : 'Tiro fuori o murato'}
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
          {drawFieldBaseLandscape()}

          {visibleShots.map((shot) => {
            const origin = getShotOrigin(shot);
            if (!origin) return null;

            const isHomeShot = shot.isHome ?? shotIsHomeFallback;
            const start = mapHalfPitchOriginLandscape(origin, isHomeShot);
            const end = getShotEndLandscape(shot, isHomeShot);
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
                    stroke={shot.isOnTarget ? '#7dd3fc' : '#f8fafc'}
                    strokeOpacity={selected ? 0.96 : 0.82}
                    strokeWidth={selected ? 7 : 5}
                    strokeLinecap="round"
                  />
                )}
                {shot.isGoal ? (
                  <text
                    x={start.x}
                    y={start.y}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize="28"
                  >
                    ⚽
                  </text>
                ) : (
                  <circle
                    cx={start.x}
                    cy={start.y}
                    r={selected ? SHOT_MARKER_RADIUS + 3 : SHOT_MARKER_RADIUS}
                    fill={shot.isOnTarget ? '#7dd3fc' : '#f8fafc'}
                    stroke="#0f172a"
                    strokeWidth={selected ? 4 : 2.5}
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
            const origin = getShotOrigin(selectedShot);
            if (!origin) return null;
            const anchor = mapHalfPitchOriginLandscape(origin, selectedShot.isHome ?? shotIsHomeFallback);
            const popupX = Math.min(Math.max(anchor.x + 18, 18), FIELD_L_W - 338);
            const popupY = Math.min(Math.max(anchor.y - 128, 18), FIELD_L_H - 138);
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
        {drawFieldBasePortrait()}

        {visibleShots.map((shot) => {
          const origin = getShotOrigin(shot);
          if (!origin) return null;

          const isHomeShot = shot.isHome ?? shotIsHomeFallback;
          const start = mapHalfPitchOriginPortrait(origin, isHomeShot);
          const end = getShotEndPortrait(shot, isHomeShot);
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
                  stroke={shot.isOnTarget ? '#7dd3fc' : '#f8fafc'}
                  strokeOpacity={selected ? 0.96 : 0.82}
                  strokeWidth={selected ? 7 : 5}
                  strokeLinecap="round"
                />
              )}
              {shot.isGoal ? (
                <text
                  x={start.x}
                  y={start.y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize="28"
                >
                  ⚽
                </text>
              ) : (
                <circle
                  cx={start.x}
                  cy={start.y}
                  r={selected ? SHOT_MARKER_RADIUS + 3 : SHOT_MARKER_RADIUS}
                  fill={shot.isOnTarget ? '#7dd3fc' : '#f8fafc'}
                  stroke="#0f172a"
                  strokeWidth={selected ? 4 : 2.5}
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
          const origin = getShotOrigin(selectedShot);
          if (!origin) return null;
          const anchor = mapHalfPitchOriginPortrait(origin, selectedShot.isHome ?? shotIsHomeFallback);
          const popupX = Math.min(Math.max(anchor.x + 18, 18), FIELD_W - 338);
          const popupY = Math.min(Math.max(anchor.y - 128, 18), FIELD_H - 138);
          return <ShotPopup x={popupX} y={popupY} shot={selectedShot} />;
        })()}
      </svg>
    </div>
  );
}
