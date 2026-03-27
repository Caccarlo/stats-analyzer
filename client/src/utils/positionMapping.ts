// Campo da calcio: 105m x 68m → aspect-ratio 68/105
// Home team: porta in alto, attacco verso il basso
// Away team: porta in basso, attacco verso l'alto

export interface FieldDimensions {
  width: number;
  height: number;
}

// Coordinate SofaScore:
// avgX: 0 = propria porta, 100 = porta avversaria
// avgY: 0 = destra, 100 = sinistra

export function homeToScreen(
  avgX: number,
  avgY: number,
  field: FieldDimensions
): { x: number; y: number } {
  return {
    x: (avgY / 100) * field.width,
    y: (avgX / 100) * field.height,
  };
}

export function awayToScreen(
  avgX: number,
  avgY: number,
  field: FieldDimensions
): { x: number; y: number } {
  return {
    x: (1 - avgY / 100) * field.width,
    y: (1 - avgX / 100) * field.height,
  };
}

// Mapping formazioni → coordinate percentuali sul campo
// x: 0-100 (sinistra-destra), y: 0-100 (porta-attacco)

export const FORMATIONS: Record<string, { x: number; y: number }[]> = {
  '4-4-2': [
    { x: 50, y: 93 },
    { x: 85, y: 75 }, { x: 62, y: 78 }, { x: 38, y: 78 }, { x: 15, y: 75 },
    { x: 85, y: 50 }, { x: 62, y: 52 }, { x: 38, y: 52 }, { x: 15, y: 50 },
    { x: 62, y: 22 }, { x: 38, y: 22 },
  ],
  '4-3-3': [
    { x: 50, y: 93 },
    { x: 85, y: 75 }, { x: 62, y: 78 }, { x: 38, y: 78 }, { x: 15, y: 75 },
    { x: 65, y: 50 }, { x: 50, y: 55 }, { x: 35, y: 50 },
    { x: 78, y: 22 }, { x: 50, y: 18 }, { x: 22, y: 22 },
  ],
  '4-2-3-1': [
    { x: 50, y: 93 },
    { x: 85, y: 75 }, { x: 62, y: 78 }, { x: 38, y: 78 }, { x: 15, y: 75 },
    { x: 60, y: 55 }, { x: 40, y: 55 },
    { x: 78, y: 35 }, { x: 50, y: 32 }, { x: 22, y: 35 },
    { x: 50, y: 15 },
  ],
  '4-3-1-2': [
    { x: 50, y: 93 },
    { x: 85, y: 75 }, { x: 62, y: 78 }, { x: 38, y: 78 }, { x: 15, y: 75 },
    { x: 65, y: 55 }, { x: 50, y: 58 }, { x: 35, y: 55 },
    { x: 50, y: 38 },
    { x: 60, y: 20 }, { x: 40, y: 20 },
  ],
  '4-1-4-1': [
    { x: 50, y: 93 },
    { x: 85, y: 75 }, { x: 62, y: 78 }, { x: 38, y: 78 }, { x: 15, y: 75 },
    { x: 50, y: 60 },
    { x: 85, y: 42 }, { x: 62, y: 45 }, { x: 38, y: 45 }, { x: 15, y: 42 },
    { x: 50, y: 18 },
  ],
  '4-4-1-1': [
    { x: 50, y: 93 },
    { x: 85, y: 75 }, { x: 62, y: 78 }, { x: 38, y: 78 }, { x: 15, y: 75 },
    { x: 85, y: 50 }, { x: 62, y: 52 }, { x: 38, y: 52 }, { x: 15, y: 50 },
    { x: 50, y: 32 },
    { x: 50, y: 18 },
  ],
  '4-1-2-1-2': [
    { x: 50, y: 93 },
    { x: 85, y: 75 }, { x: 62, y: 78 }, { x: 38, y: 78 }, { x: 15, y: 75 },
    { x: 50, y: 60 },
    { x: 65, y: 45 }, { x: 35, y: 45 },
    { x: 50, y: 32 },
    { x: 60, y: 18 }, { x: 40, y: 18 },
  ],
  '3-5-2': [
    { x: 50, y: 93 },
    { x: 70, y: 78 }, { x: 50, y: 80 }, { x: 30, y: 78 },
    { x: 88, y: 55 }, { x: 65, y: 50 }, { x: 50, y: 52 }, { x: 35, y: 50 }, { x: 12, y: 55 },
    { x: 60, y: 20 }, { x: 40, y: 20 },
  ],
  '3-4-3': [
    { x: 50, y: 93 },
    { x: 70, y: 78 }, { x: 50, y: 80 }, { x: 30, y: 78 },
    { x: 85, y: 52 }, { x: 60, y: 50 }, { x: 40, y: 50 }, { x: 15, y: 52 },
    { x: 75, y: 22 }, { x: 50, y: 18 }, { x: 25, y: 22 },
  ],
  '3-4-2-1': [
    { x: 50, y: 93 },
    { x: 70, y: 78 }, { x: 50, y: 80 }, { x: 30, y: 78 },
    { x: 85, y: 55 }, { x: 60, y: 52 }, { x: 40, y: 52 }, { x: 15, y: 55 },
    { x: 62, y: 32 }, { x: 38, y: 32 },
    { x: 50, y: 15 },
  ],
  '3-4-1-2': [
    { x: 50, y: 93 },
    { x: 70, y: 78 }, { x: 50, y: 80 }, { x: 30, y: 78 },
    { x: 85, y: 55 }, { x: 60, y: 52 }, { x: 40, y: 52 }, { x: 15, y: 55 },
    { x: 50, y: 35 },
    { x: 60, y: 18 }, { x: 40, y: 18 },
  ],
  '5-3-2': [
    { x: 50, y: 93 },
    { x: 88, y: 70 }, { x: 68, y: 78 }, { x: 50, y: 80 }, { x: 32, y: 78 }, { x: 12, y: 70 },
    { x: 65, y: 48 }, { x: 50, y: 50 }, { x: 35, y: 48 },
    { x: 60, y: 22 }, { x: 40, y: 22 },
  ],
  '5-4-1': [
    { x: 50, y: 93 },
    { x: 88, y: 70 }, { x: 68, y: 78 }, { x: 50, y: 80 }, { x: 32, y: 78 }, { x: 12, y: 70 },
    { x: 80, y: 48 }, { x: 58, y: 50 }, { x: 42, y: 50 }, { x: 20, y: 48 },
    { x: 50, y: 18 },
  ],
};

export function getFormationPositions(formation: string): { x: number; y: number }[] {
  if (FORMATIONS[formation]) {
    return FORMATIONS[formation];
  }

  // Fallback: distribuzione uniforme basata sui numeri del modulo
  const parts = formation.split('-').map(Number);
  const positions: { x: number; y: number }[] = [];

  // Portiere
  positions.push({ x: 50, y: 93 });

  const totalRows = parts.length;
  for (let row = 0; row < totalRows; row++) {
    const count = parts[row];
    const y = 80 - (row / (totalRows - 1)) * 65; // da 80 (difesa) a 15 (attacco)
    for (let col = 0; col < count; col++) {
      const x = count === 1 ? 50 : 15 + (col / (count - 1)) * 70;
      positions.push({ x, y });
    }
  }

  return positions;
}
