import { afterEach, expect, test, vi } from 'vitest';
import { getCategories, getScheduledEvents } from './sofascore';

afterEach(() => {
  vi.unstubAllGlobals();
});

test('il calendario ricostruisce i top five senza usare la rotta giornaliera rimossa', async () => {
  const events = [{ id: 123, startTimestamp: 1_788_048_000 }];
  const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async (input) => {
    const url = String(input);
    if (url.endsWith('/seasons')) {
      return new Response(JSON.stringify({ seasons: [{ id: 99, name: '2026/27', year: '26/27' }] }), {
        status: 200,
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
  expect(fetchMock).toHaveBeenCalledTimes(15);
  expect(fetchMock.mock.calls.every(([input]) => !String(input).includes('/sport/football/scheduled-events/'))).toBe(true);
  expect(String(fetchMock.mock.calls[0][0])).toContain('api.sofascore.com/api/v1/unique-tournament/23/seasons');
});

test('dopo il fallback non ritenta un 403 terminale del proxy', async () => {
  const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => new Response(
    JSON.stringify({ error: { code: 403, reason: 'Forbidden' } }),
    { status: 403, headers: { 'Content-Type': 'application/json' } },
  ));
  vi.stubGlobal('fetch', fetchMock);

  await expect(getCategories()).rejects.toThrow('Richieste SofaScore sospese');
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(String(fetchMock.mock.calls[0][0])).toContain('api.sofascore.com/api/v1');
  expect(String(fetchMock.mock.calls[1][0])).toContain('/api/sofascore/sport/football/categories');
});
