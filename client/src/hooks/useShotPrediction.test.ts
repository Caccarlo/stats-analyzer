import { renderHook, waitFor } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { useShotPrediction } from './useShotPrediction';

const { startShotPredictionMock, getShotPredictionStatusMock } = vi.hoisted(() => ({
  startShotPredictionMock: vi.fn(() => new Promise(() => {})),
  getShotPredictionStatusMock: vi.fn(() => new Promise(() => {})),
}));

vi.mock('@/api/predictions', () => ({
  startShotPrediction: startShotPredictionMock,
  getShotPredictionStatus: getShotPredictionStatusMock,
  StatsAnalyzerApiError: class StatsAnalyzerApiError extends Error {},
}));

test('non avvia il job finché la sezione Previsioni non è selezionata', async () => {
  const target = {
    id: 999,
    startTimestamp: 1_800_000_000,
    tournament: { uniqueTournament: { id: 23, name: 'Serie A' } },
    season: { id: 101, name: '2026/27', year: '2026/27' },
    homeTeam: { id: 1, name: 'Casa FC' },
    awayTeam: { id: 2, name: 'Ospiti FC' },
  };
  const { rerender, unmount } = renderHook(
    ({ enabled }) => useShotPrediction(999, enabled, target),
    { initialProps: { enabled: false } },
  );

  expect(startShotPredictionMock).not.toHaveBeenCalled();

  rerender({ enabled: true });
  await waitFor(() => expect(startShotPredictionMock).toHaveBeenCalledTimes(1));
  expect(startShotPredictionMock).toHaveBeenCalledWith(999, target, false);
  expect(getShotPredictionStatusMock).not.toHaveBeenCalled();
  unmount();
});
