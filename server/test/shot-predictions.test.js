const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  MODEL_VERSION,
  temporalWeight,
  effectiveSampleSize,
  poissonCdf,
  negativeBinomialCdf,
  buildMarketLines,
  annotatePointInTimeRatings,
  fitLeagueModel,
  seasonYearValue,
  selectModelParametersOffThread,
  createShotPredictionService,
} = require('../shot-predictions');

function makeObservation(index, overrides = {}) {
  return {
    eventId: `football-data:I1:${index}`,
    startTimestamp: 1_700_000_000 + index * 86_400,
    competitionId: 23,
    competitionName: 'Serie A',
    homeTeamId: index % 2 === 0 ? 'cagliari' : 'inter',
    homeTeamName: index % 2 === 0 ? 'Cagliari' : 'Inter',
    awayTeamId: index % 2 === 0 ? 'inter' : 'cagliari',
    awayTeamName: index % 2 === 0 ? 'Inter' : 'Cagliari',
    homeShots: 12 + (index % 4),
    awayShots: 9 + (index % 3),
    ...overrides,
  };
}

function makeArchiveDataset(targetTimestamp) {
  const teams = ['cagliari', 'inter', 'milan', 'roma'];
  return Array.from({ length: 200 }, (_, index) => {
    const homeTeamId = teams[index % teams.length];
    const awayTeamId = teams[(index + 1) % teams.length];
    return makeObservation(index, {
      startTimestamp: targetTimestamp - (200 - index) * 86_400,
      homeTeamId,
      homeTeamName: homeTeamId[0].toUpperCase() + homeTeamId.slice(1),
      awayTeamId,
      awayTeamName: awayTeamId[0].toUpperCase() + awayTeamId.slice(1),
    });
  });
}

test('le stagioni abbreviate sono ordinate cronologicamente, incluse quelle del Novecento', () => {
  assert.equal(seasonYearValue({ year: '26/27' }), 2026);
  assert.equal(seasonYearValue({ name: '2025/26' }), 2025);
  assert.equal(seasonYearValue({ year: '70/71' }), 1970);
  assert.equal(seasonYearValue({ year: '1999-00' }), 1999);
});

test('peso temporale e campione effettivo restano stabili', () => {
  assert.equal(temporalWeight(0, 180), 1);
  assert.equal(temporalWeight(180, 180), 0.5);
  assert.equal(temporalWeight(360, 180), 0.25);
  assert.equal(effectiveSampleSize([1, 1, 1, 1]), 4);
  assert.ok(effectiveSampleSize([1, 0.5, 0.25]) < 3);
});

test('CDF e mercato producono sette linee consecutive a mezzo tiro', () => {
  assert.ok(poissonCdf(10, 20) < poissonCdf(20, 20));
  assert.ok(negativeBinomialCdf(10, 20, 8) < negativeBinomialCdf(20, 20, 8));
  const markets = buildMarketLines(24.7, { type: 'poisson' });
  assert.equal(markets.length, 7);
  assert.equal(markets.filter((market) => market.isMain).length, 1);
  markets.forEach((market, index) => {
    if (index > 0) assert.equal(market.line - markets[index - 1].line, 1);
    assert.ok(Math.abs(market.underProbability + market.overProbability - 1) < 1e-10);
  });
});

test('il cutoff esclude target e partite successive da ogni stima', () => {
  const targetTimestamp = 1_700_000_000 + 80 * 86_400;
  const base = Array.from({ length: 80 }, (_, index) => makeObservation(index));
  const original = annotatePointInTimeRatings([
    ...base,
    makeObservation(80, { homeShots: 2, awayShots: 2 }),
    makeObservation(81, { homeShots: 2, awayShots: 2 }),
  ]);
  const mutated = annotatePointInTimeRatings([
    ...base,
    makeObservation(80, { homeShots: 99, awayShots: 99 }),
    makeObservation(81, { homeShots: 88, awayShots: 88 }),
  ]);
  const firstModel = fitLeagueModel(original, targetTimestamp, 180, 10, 'none');
  const secondModel = fitLeagueModel(mutated, targetTimestamp, 180, 10, 'none');
  assert.deepEqual(firstModel.predict('cagliari', 'inter'), secondModel.predict('cagliari', 'inter'));
  assert.equal(firstModel.matches, 80);
  assert.equal(secondModel.matches, 80);
});

test('il backtest cronologico viene eseguito in un worker separato', async () => {
  const observations = annotatePointInTimeRatings(makeArchiveDataset(1_800_000_000));
  const result = await selectModelParametersOffThread(observations);
  assert.ok([60, 90, 120, 180, 270, 365].includes(result.halfLifeDays));
  assert.ok([5, 10, 20].includes(result.shrinkageMatches));
  assert.ok(['poisson', 'negative-binomial'].includes(result.distributionType));
});

test('il servizio richiede Football-Data e non può essere creato senza archivio', () => {
  assert.throws(
    () => createShotPredictionService({}),
    (error) => error.code === 'shot_archive_unavailable',
  );
});

test('il modulo del modello non contiene alcun trasporto HTTP verso SofaScore', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'shot-predictions.js'), 'utf8');
  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.doesNotMatch(source, /\/api\/sofascore\//);
  assert.doesNotMatch(source, /api\.sofascore\.com/);
});

test('previsione, dettagli e medie usano solo Football-Data e lo snapshot primato', async () => {
  const cacheDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'shot-model-football-data-test-'));
  const targetTimestamp = 1_800_000_000;
  const target = {
    id: 9_999,
    startTimestamp: targetTimestamp,
    tournament: { uniqueTournament: { id: 23, name: 'Serie A' } },
    season: { id: 2026, name: '2026/27', year: '2026/27' },
    homeTeam: { id: 1, name: 'Cagliari' },
    awayTeam: { id: 2, name: 'Inter' },
  };
  const observations = makeArchiveDataset(targetTimestamp);
  let datasetCalls = 0;
  const archive = {
    getPredictionDataset: async () => {
      datasetCalls += 1;
      return {
        observations,
        excludedMissing: 0,
        seasons: [
          { id: 2026, name: '2026/27', year: '2026/27' },
          { id: 2025, name: '2025/26', year: '2025/26' },
        ],
        homeMatches: 100,
        awayMatches: 100,
        homeModelTeamId: 'cagliari',
        awayModelTeamId: 'inter',
        dataSource: 'football-data.co.uk',
      };
    },
    getAverageCatalog: async (teamId) => ({
      teamId,
      competitions: [{ id: 23, name: 'Serie A', seasons: [{ id: 2026, name: '2026/27' }] }],
      dataSource: 'football-data.co.uk',
    }),
    getShotAverages: async (teamId, _teamName, competitionId, seasonId, venue) => ({
      status: 'ready', teamId, competitionId, seasonId, venue, matches: 10,
      excludedMissing: 0, shotsFor: 13, shotsAgainst: 10, totalShots: 23,
      dataSource: 'football-data.co.uk',
    }),
  };

  try {
    const service = createShotPredictionService({
      shotDataArchive: archive,
      cacheDir,
      now: () => (targetTimestamp + 86_400) * 1000,
    });

    assert.equal(await service.canPoll(target.id), false);
    await assert.rejects(
      service.primeTarget(target.id, { ...target, season: null }),
      (error) => error.code === 'invalid_target_snapshot',
    );
    await service.primeTarget(target.id, target);
    assert.equal(await service.canPoll(target.id), true);
    assert.equal((await service.getPrediction(target.id)).status, 'building');
    await service.jobs.get(`${target.id}:${MODEL_VERSION}`).promise;

    const ready = await service.getPrediction(target.id);
    assert.equal(ready.status, 'ready');
    assert.equal(ready.prediction.diagnostics.dataSource, 'football-data.co.uk');
    assert.ok(ready.prediction.diagnostics.backtest.sampleSize > 0);
    assert.equal(datasetCalls, 1);

    const details = await service.getDetails(target.id, 'expected-total', 'home', 1, 25);
    assert.equal(details.matches.total, 100);
    assert.ok(details.matches.items.every((match) => match.startTimestamp < target.startTimestamp));
    assert.equal((await service.getAverageCatalog(1, 'Cagliari')).dataSource, 'football-data.co.uk');
    assert.equal((await service.getShotAverages(1, 23, 2026, 'home', 'Cagliari')).dataSource, 'football-data.co.uk');
  } finally {
    await fs.promises.rm(cacheDir, { recursive: true, force: true });
  }
});
