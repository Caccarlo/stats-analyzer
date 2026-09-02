import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getShotPredictionDetails,
  getShotPredictionStatus,
  getTeamShotAverageCatalog,
  getTeamShotAverages,
  startShotPrediction,
} from '@/api/predictions';

const target = {
  id: 9999,
  startTimestamp: 1_800_000_000,
  tournament: { uniqueTournament: { id: 23, name: 'Serie A' } },
  season: { id: 2026, name: '2026/27', year: '2026/27' },
  homeTeam: { id: 1, name: 'Cagliari' },
  awayTeam: { id: 2, name: 'Inter' },
};

describe('prediction API boundary', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('usa esclusivamente route locali e credenziali same-origin', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: 'building', progress: {} }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await startShotPrediction(target.id, target);
    await getShotPredictionStatus(target.id);
    await getShotPredictionDetails(target.id, 'under:25.5', 'home', 1);
    await getTeamShotAverageCatalog(target.homeTeam.id, target.homeTeam.name);
    await getTeamShotAverages(target.homeTeam.id, 23, 2026, 'home', target.homeTeam.name);

    expect(fetchMock).toHaveBeenCalledTimes(5);
    fetchMock.mock.calls.forEach(([url, init]) => {
      expect(String(url)).toMatch(/^\/api\/(?:predictions|teams)\//);
      expect(String(url)).not.toContain('sofascore');
      expect(init).toMatchObject({ credentials: 'same-origin' });
    });
  });
});
