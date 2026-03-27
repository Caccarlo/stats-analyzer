import { useRef, useLayoutEffect } from 'react';

type CardEntry = {
  panelIndex: number;
  cardIndex: number;
  element: HTMLElement;
};

const registry: CardEntry[] = [];

function syncAllHeights() {
  // Group entries by cardIndex
  const byIndex = new Map<number, CardEntry[]>();
  for (const entry of registry) {
    const arr = byIndex.get(entry.cardIndex) || [];
    arr.push(entry);
    byIndex.set(entry.cardIndex, arr);
  }

  for (const [, entries] of byIndex) {
    // Reset min-height to measure natural content height
    entries.forEach((e) => {
      e.element.style.minHeight = '';
    });

    // Only sync when both panels have a card at this index
    if (entries.length < 2) continue;

    const heights = entries.map((e) => e.element.getBoundingClientRect().height);
    const max = Math.max(...heights);
    entries.forEach((e) => {
      e.element.style.minHeight = `${max}px`;
    });
  }
}

export function useSplitCardSync(
  panelIndex: number,
  cardIndex: number,
  active: boolean,
  contentKey?: unknown,
) {
  const ref = useRef<HTMLDivElement>(null);

  // Register/unregister element in the shared registry
  useLayoutEffect(() => {
    if (!active || !ref.current) {
      if (ref.current) ref.current.style.minHeight = '';
      return;
    }

    const entry: CardEntry = { panelIndex, cardIndex, element: ref.current };
    registry.push(entry);
    syncAllHeights();

    return () => {
      const idx = registry.indexOf(entry);
      if (idx >= 0) registry.splice(idx, 1);
      entry.element.style.minHeight = '';
      syncAllHeights();
    };
  }, [panelIndex, cardIndex, active]);

  // Re-sync when card content changes (e.g., details finish loading)
  useLayoutEffect(() => {
    if (active) syncAllHeights();
  }, [contentKey, active]);

  return ref;
}
