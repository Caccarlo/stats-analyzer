import { afterEach, expect, test, vi } from 'vitest';
import { getCategories } from './sofascore';

afterEach(() => {
  vi.unstubAllGlobals();
});

test('dopo il fallback non ritenta un 403 terminale del proxy', async () => {
  const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => new Response(
    JSON.stringify({ error: { code: 403, reason: 'Forbidden' } }),
    { status: 403, headers: { 'Content-Type': 'application/json' } },
  ));
  vi.stubGlobal('fetch', fetchMock);

  await expect(getCategories()).rejects.toThrow('proxy API error 403');
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(String(fetchMock.mock.calls[0][0])).toContain('www.sofascore.com/api/v1');
  expect(String(fetchMock.mock.calls[1][0])).toContain('/api/sofascore/sport/football/categories');
});
