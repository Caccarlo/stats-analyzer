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
  label,
  number,
  color = '#e0e0e0',
  highlighted = false,
  onClick,
}: PlayerDotProps) {
  return (
    <g
      transform={`translate(${x}, ${y})`}
      onClick={onClick}
      className={onClick ? 'cursor-pointer' : ''}
    >
      {/* Alone per giocatore evidenziato */}
      {highlighted && (
        <circle r={16} fill={color} opacity={0.2} />
      )}

      {/* Pallino */}
      <circle
        r={highlighted ? 12 : 10}
        fill={color}
        stroke={highlighted ? '#fff' : 'rgba(255,255,255,0.3)'}
        strokeWidth={highlighted ? 2 : 1}
      />

      {/* Numero maglia */}
      {number && (
        <text
          textAnchor="middle"
          dominantBaseline="central"
          fill={highlighted ? '#000' : '#fff'}
          fontSize={highlighted ? 9 : 8}
          fontWeight="bold"
        >
          {number}
        </text>
      )}

      {/* Cognome sotto il pallino */}
      {label && (
        <text
          y={18}
          textAnchor="middle"
          fill="#e0e0e0"
          fontSize={7}
          fontWeight="500"
        >
          {label}
        </text>
      )}
    </g>
  );
}
