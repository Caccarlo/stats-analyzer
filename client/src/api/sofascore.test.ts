import { afterEach, expect, test, vi } from 'vitest';
import { getCategories, getScheduledEvents } from './sofascore';

afterEach(() => {
  vi.unstubAllGlobals();
});

test('il calendario prova il relay locale quando il canale diretto risponde 404', async () => {
  const events = [{ id: 123, startTimestamp: 1_788_048_000 }];
  const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async (input) => {
    const url = String(input);
    if (url.includes('www.sofascore.com/api/v1')) {
      return new Response(JSON.stringify({ error: { code: 404 } }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ events }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);

  await expect(getScheduledEvents('2026-08-30', true)).resolves.toEqual(events);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(String(fetchMock.mock.calls[1][0])).toContain('/api/sofascore/sport/football/scheduled-events/2026-08-30');
});

test('dopo il fallback non ritenta un 403 terminale del proxy', async () => {
  const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => new Response(
    JSON.stringify({ error: { code: 403, reason: 'Forbidden' } }),
    { status: 403, headers: { 'Content-Type': 'application/json' } },
  ));
  vi.stubGlobal('fetch', fetchMock);

  await expect(getCategories()).rejects.toThrow('Richieste SofaScore sospese');
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(String(fetchMock.mock.calls[0][0])).toContain('www.sofascore.com/api/v1');
  expect(String(fetchMock.mock.calls[1][0])).toContain('/api/sofascore/sport/football/categories');

  await expect(getScheduledEvents('2026-08-30', true)).rejects.toThrow('Richieste SofaScore sospese');
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
