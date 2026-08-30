import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { todayISO, useCalendarData } from './useCalendarData';

const { getScheduledEventsMock } = vi.hoisted(() => ({
  getScheduledEventsMock: vi.fn(),
}));

vi.mock('@/api/sofascore', () => ({
  getScheduledEvents: getScheduledEventsMock,
}));

afterEach(() => {
  vi.useRealTimers();
});

test('dopo un errore iniziale il calendario non continua a interrogare SofaScore', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-30T12:00:00+02:00'));
  getScheduledEventsMock.mockRejectedValueOnce(new Error('SofaScore sospeso'));

  const { result } = renderHook(() => useCalendarData(todayISO()));
  await vi.waitFor(() => expect(getScheduledEventsMock).toHaveBeenCalledTimes(1));
  await vi.waitFor(() => expect(result.current.error).toBe('SofaScore sospeso'));

  await act(async () => {
    await vi.advanceTimersByTimeAsync(5 * 60_000);
  });
  expect(getScheduledEventsMock).toHaveBeenCalledTimes(1);
});
