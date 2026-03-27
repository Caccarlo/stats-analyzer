interface PlayerDotProps {
  x: number;
  y: number;
  label?: string;
  number?: string;
  color?: string;
  highlighted?: boolean;
  onClick?: () => void;
}

export default function PlayerDot({
  x,
  y,
  number,
  color = '#e0e0e0',
  highlighted = false,
  onClick,
}: PlayerDotProps) {
  const DOT_RADIUS = 30; // tutti i pallini hanno la stessa dimensione
  const NUMBER_SIZE = 30; // tutti i numeri hanno la stessa dimensione

  return (
    <g
      transform={`translate(${x}, ${y})`}
      onClick={onClick}
      className={onClick ? 'cursor-pointer' : ''}
    >
      {/* Alone per giocatore evidenziato */}
      {highlighted && (
        <circle r={DOT_RADIUS + 8} fill={color} opacity={0.2} />
      )}

      {/* Pallino */}
      <circle
        r={DOT_RADIUS}
        fill={color}
        stroke={highlighted ? '#fff' : 'rgba(255,255,255,0.3)'}
        strokeWidth={highlighted ? 3 : 2}
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