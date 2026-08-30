import { renderHook, waitFor } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { useShotPrediction } from './useShotPrediction';

const { getShotPredictionMock } = vi.hoisted(() => ({
  getShotPredictionMock: vi.fn(() => new Promise(() => {})),
}));

vi.mock('@/api/sofascore', () => ({
  getShotPrediction: getShotPredictionMock,
  StatsAnalyzerApiError: class StatsAnalyzerApiError extends Error {},
}));

test('non avvia il job finché la sezione Previsioni non è selezionata', async () => {
  const { rerender, unmount } = renderHook(
    ({ enabled }) => useShotPrediction(999, enabled),
    { initialProps: { enabled: false } },
  );

  expect(getShotPredictionMock).not.toHaveBeenCalled();

  rerender({ enabled: true });
  await waitFor(() => expect(getShotPredictionMock).toHaveBeenCalledTimes(1));
  expect(getShotPredictionMock).toHaveBeenCalledWith(999, false);
  unmount();
});
