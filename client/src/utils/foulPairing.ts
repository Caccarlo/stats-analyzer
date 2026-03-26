import type { MatchComment, FoulMatchup } from '@/types';

const ZONE_TRANSLATIONS: Record<string, string> = {
  'in the defensive half': 'nella propria metà campo',
  'in their own half': 'nella propria metà campo',
  'in the attacking half': 'nella metà campo avversaria',
  'on the left wing': 'sulla fascia sinistra',
  'on the right wing': 'sulla fascia destra',
};

function translateZone(text: string): string {
  const lower = text.toLowerCase();
  for (const [en, it] of Object.entries(ZONE_TRANSLATIONS)) {
    if (lower.includes(en)) return it;
  }
  return '';
}

function extractMinute(text: string): number | undefined {
  // Prova a estrarre il minuto dal testo del commento (es. "45' +2")
  const match = text.match(/(\d+)'/);
  return match ? parseInt(match[1], 10) : undefined;
}

export function extractFoulsForPlayer(
  comments: MatchComment[],
  playerId: number
): FoulMatchup[] {
  const results: FoulMatchup[] = [];

  for (let i = 0; i < comments.length; i++) {
    const comment = comments[i];

    // CASO 1: Il giocatore ha COMMESSO un fallo (freeKickLost)
    if (comment.type === 'freeKickLost' && comment.player?.id === playerId) {
      // Fallo di mano → nessuna vittima
      if (comment.text.toLowerCase().includes('handball')) {
        results.push({
          type: 'handball',
          minute: extractMinute(comment.text),
          zoneText: translateZone(comment.text),
          rawText: comment.text,
        });
        continue;
      }

      // Cercare la vittima: controllare idx-1 E idx+1
      const prev = i > 0 ? comments[i - 1] : null;
      const next = i < comments.length - 1 ? comments[i + 1] : null;
      let victim = null;
      let zoneText = '';

      if (prev?.type === 'freeKickWon') {
        victim = prev.player ?? null;
        zoneText = prev.text;
      } else if (next?.type === 'freeKickWon') {
        victim = next.player ?? null;
        zoneText = next.text;
      }

      results.push({
        type: 'committed',
        minute: extractMinute(comment.text),
        playerFouled: victim ?? undefined,
        zoneText: translateZone(zoneText || comment.text),
        rawText: comment.text,
      });
    }

    // CASO 2: Il giocatore ha SUBITO un fallo (freeKickWon)
    if (comment.type === 'freeKickWon' && comment.player?.id === playerId) {
      const prev = i > 0 ? comments[i - 1] : null;
      const next = i < comments.length - 1 ? comments[i + 1] : null;
      let fouler = null;

      if (prev?.type === 'freeKickLost') {
        fouler = prev.player ?? null;
      } else if (next?.type === 'freeKickLost') {
        fouler = next.player ?? null;
      }

      results.push({
        type: 'suffered',
        minute: extractMinute(comment.text),
        playerFouling: fouler ?? undefined,
        zoneText: translateZone(comment.text),
        rawText: comment.text,
      });
    }
  }

  return results;
}

export function extractSubstitutionInfo(
  comments: MatchComment[],
  playerId: number
): { inMinute?: number; outMinute?: number } {
  let inMinute: number | undefined;
  let outMinute: number | undefined;

  for (const comment of comments) {
    if (comment.type !== 'substitution') continue;

    if (comment.playerIn?.id === playerId) {
      inMinute = extractMinute(comment.text) ?? comment.time;
    }
    if (comment.playerOut?.id === playerId) {
      outMinute = extractMinute(comment.text) ?? comment.time;
    }
  }

  return { inMinute, outMinute };
}
