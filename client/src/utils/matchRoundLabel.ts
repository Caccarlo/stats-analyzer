import type { MatchEvent } from '@/types';

const ROUND_LABELS = {
  full: {
    'playoff-round': 'Playoff',
    'round-of-32': 'Sedicesimi',
    'round-of-16': 'Ottavi',
    'quarterfinals': 'Quarti',
    'semifinals': 'Semifinale',
    'final': 'Finale',
  },
  compact: {
    'playoff-round': 'Playoff',
    'round-of-32': 'R32',
    'round-of-16': 'Ottavi',
    'quarterfinals': 'Quarti',
    'semifinals': 'Semi',
    'final': 'Finale',
  },
} as const;

type RoundVariant = keyof typeof ROUND_LABELS;

function isSimpleNumericRoundName(name: string): boolean {
  return /^round\s+\d+$/i.test(name.trim());
}

export function getMatchRoundLabel(
  roundInfo: MatchEvent['roundInfo'],
  variant: RoundVariant = 'full',
): string | null {
  if (!roundInfo) return null;

  const slug = roundInfo.slug?.trim().toLowerCase();
  if (slug && slug in ROUND_LABELS[variant]) {
    return ROUND_LABELS[variant][slug as keyof typeof ROUND_LABELS[typeof variant]];
  }

  const rawName = roundInfo.name?.trim();
  if (rawName && !isSimpleNumericRoundName(rawName)) {
    return rawName;
  }

  if (typeof roundInfo.round === 'number') {
    return `G.${roundInfo.round}`;
  }

  return null;
}
