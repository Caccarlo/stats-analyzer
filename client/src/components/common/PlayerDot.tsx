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
        <circle r={32} fill={color} opacity={0.2} />
      )}

      {/* Pallino */}
      <circle
        r={highlighted ? 24 : 20}
        fill={color}
        stroke={highlighted ? '#fff' : 'rgba(255,255,255,0.3)'}
        strokeWidth={highlighted ? 3 : 2}
      />

      {/* Numero maglia */}
      {number && (
        <text
          textAnchor="middle"
          dominantBaseline="central"
          fill={highlighted ? '#000' : '#fff'}
          fontSize={highlighted ? 25 : 16}
          fontWeight="bold"
        >
          {number}
        </text>
      )}

      {/* Cognome sotto il pallino */}
      {label && (
        <text
          y={55}
          textAnchor="middle"
          fill="#e0e0e0"
          fontSize={30}
          fontWeight="500"
        >
          {label}
        </text>
      )}
    </g>
  );
}
