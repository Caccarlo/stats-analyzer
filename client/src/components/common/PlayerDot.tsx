interface PlayerDotProps {
  x: number;
  y: number;
  label?: string;
  number?: string;
  color?: string;
  highlighted?: boolean;
  onClick?: () => void;
  sizeScale?: number;
}

export default function PlayerDot({
  x,
  y,
  number,
  color = '#e0e0e0',
  highlighted = false,
  onClick,
  sizeScale = 1,
}: PlayerDotProps) {
  const DOT_RADIUS = 24 * sizeScale;
  const NUMBER_SIZE = 21 * sizeScale;
  const HIGHLIGHT_RADIUS = DOT_RADIUS + 6 * sizeScale;
  const STROKE_WIDTH = highlighted ? 2.5 * sizeScale : 1.75 * sizeScale;

  return (
    <g
      transform={`translate(${x}, ${y})`}
      onClick={onClick}
      className={onClick ? 'cursor-pointer' : ''}
    >
      {/* Alone per giocatore evidenziato */}
      {highlighted && (
        <circle r={HIGHLIGHT_RADIUS} fill={color} opacity={0.2} />
      )}

      {/* Pallino */}
      <circle
        r={DOT_RADIUS}
        fill={color}
        stroke={highlighted ? '#fff' : 'rgba(255,255,255,0.3)'}
        strokeWidth={STROKE_WIDTH}
      />

      {/* Numero maglia */}
      {number && (
        <text
          textAnchor="middle"
          dominantBaseline="central"
          fill="#000"
          fontSize={NUMBER_SIZE}
          fontWeight="bold"
        >
          {number}
        </text>
      )}
    </g>
  );
}
