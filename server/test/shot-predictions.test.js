const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  MODEL_VERSION,
  ShotModelError,
  extractTotalShots,
  temporalWeight,
  effectiveSampleSize,
  poissonCdf,
  negativeBinomialCdf,
  buildMarketLines,
  annotatePointInTimeRatings,
  fitLeagueModel,
  seasonYearValue,
  createShotPredictionService,
} = require('../shot-predictions');

function makeObservation(index, overrides = {}) {
  return {
    eventId: index,
    startTimestamp: 1_700_000_000 + index * 86_400,
    competitionId: 23,
    competitionName: 'Serie A',
    homeTeamId: index % 2 === 0 ? 1 : 2,
    homeTeamName: index % 2 === 0 ? 'A' : 'B',
    awayTeamId: index % 2 === 0 ? 2 : 1,
    awayTeamName: index % 2 === 0 ? 'B' : 'A',
    homeShots: 12 + (index % 4),
    awayShots: 9 + (index % 3),
    ...overrides,
  };
}

function finishedEvent({ id, startTimestamp, season, homeTeamId, awayTeamId, tournamentId = 23 }) {
  return {
    id,
    startTimestamp,
    tournament: { uniqueTournament: { id: tournamentId, name: tournamentId === 23 ? 'Serie A' : 'Altra' } },
    season,
    homeTeam: { id: homeTeamId, name: `Team ${homeTeamId}` },
    awayTeam: { id: awayTeamId, name: `Team ${awayTeamId}` },
    status: { type: 'finished', code: 100, description: 'Ended' },
  };
}

test('parser usa il periodo ALL e la chiave totalShotsOnGoal', () => {
  const parsed = extractTotalShots({
    statistics: [
      { period: '1ST', groups: [{ statisticsItems: [{ key: 'totalShotsOnGoal', homeValue: 4, awayValue: 3 }] }] },
      { period: 'ALL', groups: [{ statisticsItems: [{ name: 'Total shots', key: 'totalShotsOnGoal', homeValue: 17, awayValue: 8 }] }] },
    ],
  });
  assert.deepEqual(parsed, { home: 17, away: 8 });
});

test('parser rifiuta statistiche tiri incomplete', () => {
  assert.equal(extractTotalShots({ statistics: [{ period: 'ALL', groups: [] }] }), null);
  assert.equal(extractTotalShots({
    statistics: [{ period: 'ALL', groups: [{ statisticsItems: [{ key: 'totalShotsOnGoal', homeValue: 7 }] }] }],
  }), null);
});

test('le stagioni abbreviate sono ordinate cronologicamente, incluse quelle del Novecento', () => {
  assert.equal(seasonYearValue({ year: '26/27' }), 2026);
  assert.equal(seasonYearValue({ name: '2025/26' }), 2025);
  assert.equal(seasonYearValue({ year: '70/71' }), 1970);
  assert.equal(seasonYearValue({ year: '1999-00' }), 1999);
});

test('peso temporale dimezza esattamente a ogni emivita', () => {
  assert.equal(temporalWeight(0, 180), 1);
  assert.equal(temporalWeight(180, 180), 0.5);
  assert.equal(temporalWeight(360, 180), 0.25);
  assert.equal(effectiveSampleSize([1, 1, 1, 1]), 4);
  assert.ok(effectiveSampleSize([1, 0.5, 0.25]) < 3);
});

test('CDF Poisson e binomiale negativa sono monotone e limitate', () => {
  let previousPoisson = 0;
  let previousNb = 0;
  for (let value = 0; value < 70; value += 1) {
    const poisson = poissonCdf(value, 26.4);
    const negativeBinomial = negativeBinomialCdf(value, 26.4, 20);
    assert.ok(poisson >= previousPoisson && poisson <= 1);
    assert.ok(negativeBinomial >= previousNb && negativeBinomial <= 1);
    previousPoisson = poisson;
    previousNb = negativeBinomial;
  }
});

test('mercato contiene sette linee consecutive a mezzo tiro e quote reciproche', () => {
  const markets = buildMarketLines(29.2, { type: 'poisson' });
  assert.equal(markets.length, 7);
  assert.equal(markets.filter((market) => market.isMain).length, 1);
  const mainDistance = Math.abs(markets.find((market) => market.isMain).underProbability - 0.5);
  markets.forEach((market, index) => {
    assert.equal(market.line % 1, 0.5);
    if (index > 0) assert.equal(market.line - markets[index - 1].line, 1);
    assert.ok(Math.abs(market.underProbability + market.overProbability - 1) < 1e-12);
    assert.ok(Math.abs(market.underFairOdds - 1 / market.underProbability) < 1e-12);
    assert.ok(Math.abs(market.overFairOdds - 1 / market.overProbability) < 1e-12);
    assert.ok(mainDistance <= Math.abs(market.underProbability - 0.5));
  });
});

test('il cutoff esclude target e partite successive da ogni stima', () => {
  const base = Array.from({ length: 80 }, (_, index) => makeObservation(index));
  const targetTimestamp = makeObservation(80).startTimestamp;
  const original = annotatePointInTimeRatings([
    ...base,
    makeObservation(80, { homeShots: 1, awayShots: 1 }),
    makeObservation(81, { homeShots: 2, awayShots: 2 }),
  ]);
  const mutated = annotatePointInTimeRatings([
    ...base,
    makeObservation(80, { homeShots: 99, awayShots: 99 }),
    makeObservation(81, { homeShots: 88, awayShots: 88 }),
  ]);
  const firstModel = fitLeagueModel(original, targetTimestamp, 180, 10, 'none');
  const secondModel = fitLeagueModel(mutated, targetTimestamp, 180, 10, 'none');
  assert.deepEqual(firstModel.predict(1, 2), secondModel.predict(1, 2));
  assert.equal(firstModel.matches, 80);
  assert.equal(secondModel.matches, 80);
});

test('la V1 leggera usa soltanto le due squadre, le due stagioni corrette e le sedi pertinenti', async () => {
  const cacheDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'shot-model-lite-test-'));
  const seasons = [
    { id: 95_836, name: '26/27', year: '26/27' },
    { id: 76_457, name: '25/26', year: '25/26' },
    { id: 91_130, name: '70/71', year: '70/71' },
  ];
  const target = {
    id: 999,
    startTimestamp: 1_800_000_000,
    tournament: { uniqueTournament: { id: 23, name: 'Serie A' } },
    season: seasons[0],
    homeTeam: { id: 1, name: 'Team 1' },
    awayTeam: { id: 2, name: 'Team 2' },
    status: { type: 'notstarted', code: 0, description: 'Not started' },
  };
  const statistics = new Map();
  const homeEvents = [];
  const awayEvents = [];
  for (let index = 0; index < 10; index += 1) {
    const season = index < 5 ? seasons[1] : seasons[0];
    const homeEvent = finishedEvent({
      id: 1_000 + index,
      startTimestamp: 1_760_000_000 + index * 86_400,
      season,
      homeTeamId: 1,
      awayTeamId: 10 + index,
    });
    const awayEvent = finishedEvent({
      id: 2_000 + index,
      startTimestamp: 1_761_000_000 + index * 86_400,
      season,
      homeTeamId: 20 + index,
      awayTeamId: 2,
    });
    homeEvents.push(homeEvent);
    awayEvents.push(awayEvent);
    statistics.set(homeEvent.id, {
      statistics: [{ period: 'ALL', groups: [{ statisticsItems: [{ key: 'totalShotsOnGoal', homeValue: 14 + index % 3, awayValue: 9 }] }] }],
    });
    statistics.set(awayEvent.id, {
      statistics: [{ period: 'ALL', groups: [{ statisticsItems: [{ key: 'totalShotsOnGoal', homeValue: 11, awayValue: 10 + index % 3 }] }] }],
    });
  }

  const ancientHome = finishedEvent({ id: 3_001, startTimestamp: 20_000_000, season: seasons[2], homeTeamId: 1, awayTeamId: 31 });
  const wrongVenueHome = finishedEvent({ id: 3_002, startTimestamp: 1_770_000_000, season: seasons[0], homeTeamId: 31, awayTeamId: 1 });
  const wrongVenueAway = finishedEvent({ id: 3_003, startTimestamp: 1_770_100_000, season: seasons[0], homeTeamId: 2, awayTeamId: 32 });
  const otherCompetition = finishedEvent({ id: 3_004, startTimestamp: 1_770_200_000, season: seasons[0], homeTeamId: 1, awayTeamId: 32, tournamentId: 35 });
  const afterCutoff = finishedEvent({ id: 3_005, startTimestamp: target.startTimestamp + 86_400, season: seasons[0], homeTeamId: 1, awayTeamId: 32 });
  const targetAsFinished = { ...target, status: { type: 'finished', code: 100, description: 'Ended' } };
  [ancientHome, wrongVenueHome, wrongVenueAway, otherCompetition, afterCutoff, targetAsFinished].forEach((event) => {
    statistics.set(event.id, {
      statistics: [{ period: 'ALL', groups: [{ statisticsItems: [{ key: 'totalShotsOnGoal', homeValue: 99, awayValue: 98 }] }] }],
    });
  });

  const requestedEndpoints = [];
  const fetchSofaScore = async (endpoint) => {
    requestedEndpoints.push(endpoint);
    if (endpoint === 'event/999') return { event: target };
    if (endpoint === 'unique-tournament/23/seasons') return { seasons };
    if (endpoint === 'team/1/events/last/0') {
      return { events: [...homeEvents, ancientHome, wrongVenueHome, otherCompetition, afterCutoff, targetAsFinished], hasNextPage: false };
    }
    if (endpoint === 'team/2/events/last/0') {
      return { events: [...awayEvents, wrongVenueAway, targetAsFinished], hasNextPage: false };
    }
    if (endpoint === 'team/1/team-statistics/seasons') {
      return { uniqueTournamentSeasons: [{ uniqueTournament: { id: 23, name: 'Serie A' }, seasons }] };
    }
    const leaguePage = endpoint.match(/^unique-tournament\/23\/season\/(\d+)\/events\/last\/(\d+)$/);
    if (leaguePage) {
      const requestedSeasonId = Number(leaguePage[1]);
      return {
        events: Number(leaguePage[2]) === 0
          ? [...homeEvents, ...awayEvents].filter((event) => event.season.id === requestedSeasonId)
          : [],
        hasNextPage: false,
      };
    }
    const statistic = endpoint.match(/^event\/(\d+)\/statistics$/);
    if (statistic && statistics.has(Number(statistic[1]))) return statistics.get(Number(statistic[1]));
    throw new Error(`Endpoint inatteso: ${endpoint}`);
  };

  try {
    const service = createShotPredictionService({
      fetchSofaScore,
      cacheDir,
      upstreamMinIntervalMs: 0,
    });
    assert.equal((await service.getPrediction(target.id)).status, 'building');
    await service.jobs.get(`999:${MODEL_VERSION}`).promise;
    const ready = await service.getPrediction(target.id);
    assert.equal(ready.status, 'ready');
    assert.equal(ready.prediction.modelVersion, MODEL_VERSION);
    assert.equal(ready.prediction.diagnostics.matchesUsed, 20);
    assert.deepEqual(ready.prediction.diagnostics.seasonsUsed.map((season) => season.id), [95_836, 76_457]);
    assert.equal(ready.prediction.diagnostics.strength.retained, false);
    assert.equal(ready.prediction.diagnostics.backtest.sampleSize, 0);
    assert.equal(ready.prediction.distribution.type, 'poisson');

    const requestedStatisticIds = requestedEndpoints
      .map((endpoint) => endpoint.match(/^event\/(\d+)\/statistics$/)?.[1])
      .filter(Boolean)
      .map(Number);
    assert.deepEqual(new Set(requestedStatisticIds), new Set([...homeEvents, ...awayEvents].map((event) => event.id)));
    assert.equal(requestedEndpoints.some((endpoint) => endpoint.includes('/season/91130/')), false);
    assert.equal(requestedEndpoints.some((endpoint) => endpoint.startsWith('unique-tournament/23/season/')), false);

    const details = await service.getDetails(target.id, 'expected-total', 'home', 1, 25);
    assert.equal(details.matches.total, 10);
    assert.match(details.calculation.formula, /μ_casa = L_H × A_casa × V_trasferta/);
    assert.ok(details.matches.items.every((match) => match.venue === 'home'));
    assert.ok(details.matches.items.every((match) => match.startTimestamp < target.startTimestamp));

    const catalog = await service.getAverageCatalog(1);
    assert.deepEqual(catalog.competitions[0].seasons.map((season) => season.id), [95_836, 76_457]);
    assert.equal(requestedEndpoints.some((endpoint) => endpoint.startsWith('unique-tournament/23/season/')), false);
    const averages = await service.getShotAverages(1, 23, seasons[0].id, 'home');
    assert.equal(averages.matches, 5);
    assert.ok(averages.shotsFor > averages.shotsAgainst);
    assert.equal(requestedEndpoints.some((endpoint) => endpoint === 'unique-tournament/23/season/95836/events/last/0'), true);
  } finally {
    await fs.promises.rm(cacheDir, { recursive: true, force: true });
  }
});

test('l’archivio locale riattiva storico, backtest e distribuzione senza chiamate SofaScore per le statistiche', async () => {
  const cacheDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'shot-model-archive-test-'));
  const targetTimestamp = 1_800_000_000;
  const target = {
    id: 9_999,
    startTimestamp: targetTimestamp,
    tournament: { uniqueTournament: { id: 23, name: 'Serie A' } },
    season: { id: 95_836, name: '2026/27', year: '2026/27' },
    homeTeam: { id: 1, name: 'Cagliari' },
    awayTeam: { id: 2, name: 'Inter' },
    status: { type: 'finished', code: 100, description: 'Ended' },
  };
  const teams = ['cagliari', 'inter', 'milan', 'roma'];
  const observations = Array.from({ length: 200 }, (_, index) => {
    const homeTeamId = teams[index % teams.length];
    const awayTeamId = teams[(index + 1) % teams.length];
    return makeObservation(index, {
      eventId: `football-data:I1:${index}`,
      startTimestamp: targetTimestamp - (200 - index) * 86_400,
      homeTeamId,
      homeTeamName: homeTeamId[0].toUpperCase() + homeTeamId.slice(1),
      awayTeamId,
      awayTeamName: awayTeamId[0].toUpperCase() + awayTeamId.slice(1),
      homeShots: 11 + (index % 7),
      awayShots: 8 + (index % 6),
    });
  });
  const requested = [];
  const archive = {
    getPredictionDataset: async () => ({
      observations,
      excludedMissing: 0,
      seasons: [
        { id: 2026, name: '2026/27', year: '2026/27' },
        { id: 2025, name: '2025/26', year: '2025/26' },
      ],
      homeMatches: 50,
      awayMatches: 50,
      homeModelTeamId: 'cagliari',
      awayModelTeamId: 'inter',
      dataSource: 'football-data.co.uk',
    }),
    getAverageCatalog: async () => ({ teamId: 1, competitions: [] }),
    getShotAverages: async () => ({ status: 'ready', matches: 0 }),
  };

  try {
    const service = createShotPredictionService({
      fetchSofaScore: async (endpoint) => {
        requested.push(endpoint);
        throw new Error(`Chiamata statistica inattesa: ${endpoint}`);
      },
      fetchTargetEvent: async (endpoint) => {
        requested.push(endpoint);
        return { event: target };
      },
      shotDataArchive: archive,
      cacheDir,
      upstreamMinIntervalMs: 0,
      now: () => (targetTimestamp + 86_400) * 1000,
    });
    await service.primeTarget(target.id, target);
    assert.equal((await service.getPrediction(target.id)).status, 'building');
    await service.jobs.get(`${target.id}:${MODEL_VERSION}`).promise;
    const ready = await service.getPrediction(target.id);
    assert.equal(ready.status, 'ready');
    assert.equal(ready.prediction.diagnostics.dataSource, 'football-data.co.uk');
    assert.ok(ready.prediction.diagnostics.backtest.sampleSize > 0);
    assert.ok(['poisson', 'negative-binomial'].includes(ready.prediction.distribution.type));
    assert.deepEqual(requested, []);

    const details = await service.getDetails(target.id, 'expected-total', 'home', 1, 25);
    assert.equal(details.matches.total, 100);
    assert.equal(typeof details.matches.items[0].eventId, 'string');
    assert.ok(details.matches.items.every((match) => match.startTimestamp < target.startTimestamp));
  } finally {
    await fs.promises.rm(cacheDir, { recursive: true, force: true });
  }
});

test('una partita già iniziata viene rifiutata senza raccogliere lo storico', async () => {
  const cacheDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'shot-model-past-test-'));
  const target = {
    id: 999,
    startTimestamp: 1_700_000_000,
    tournament: { uniqueTournament: { id: 23, name: 'Serie A' } },
    season: { id: 76_457, name: '25/26', year: '25/26' },
    homeTeam: { id: 1, name: 'Team 1' },
    awayTeam: { id: 2, name: 'Team 2' },
  };
  const requestedEndpoints = [];
  try {
    const service = createShotPredictionService({
      cacheDir,
      upstreamMinIntervalMs: 0,
      fetchSofaScore: async (endpoint) => {
        requestedEndpoints.push(endpoint);
        if (endpoint === 'event/999') return { event: target };
        throw new Error(`Endpoint inatteso: ${endpoint}`);
      },
    });
    assert.equal((await service.getPrediction(target.id)).status, 'building');
    await service.jobs.get(`999:${MODEL_VERSION}`).promise;
    await assert.rejects(() => service.getPrediction(target.id), (error) => error.code === 'future_matches_only');
    assert.deepEqual(requestedEndpoints, ['event/999']);
  } finally {
    await fs.promises.rm(cacheDir, { recursive: true, force: true });
  }
});

test('un 403 interrompe la raccolta senza creare un cooldown persistente', async () => {
  const cacheDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'shot-model-circuit-test-'));
  const seasons = [
    { id: 95_836, name: '26/27', year: '26/27' },
    { id: 76_457, name: '25/26', year: '25/26' },
  ];
  const target = {
    id: 999,
    startTimestamp: 1_800_000_000,
    tournament: { uniqueTournament: { id: 23, name: 'Serie A' } },
    season: seasons[0],
    homeTeam: { id: 1, name: 'Team 1' },
    awayTeam: { id: 2, name: 'Team 2' },
  };
  const homeEvents = Array.from({ length: 8 }, (_, index) => finishedEvent({
    id: 10_000 + index,
    startTimestamp: 1_760_000_000 + index * 86_400,
    season: seasons[index < 4 ? 1 : 0],
    homeTeamId: 1,
    awayTeamId: 10 + index,
  }));
  const awayEvents = Array.from({ length: 8 }, (_, index) => finishedEvent({
    id: 20_000 + index,
    startTimestamp: 1_761_000_000 + index * 86_400,
    season: seasons[index < 4 ? 1 : 0],
    homeTeamId: 20 + index,
    awayTeamId: 2,
  }));
  let statisticsCalls = 0;
  const fetchSofaScore = async (endpoint) => {
    if (endpoint === 'event/999') return { event: target };
    if (endpoint === 'unique-tournament/23/seasons') return { seasons };
    if (endpoint === 'team/1/events/last/0') return { events: homeEvents, hasNextPage: false };
    if (endpoint === 'team/2/events/last/0') return { events: awayEvents, hasNextPage: false };
    if (/^event\/\d+\/statistics$/.test(endpoint)) {
      statisticsCalls += 1;
      const error = new ShotModelError('Forbidden');
      error.upstreamStatus = 403;
      throw error;
    }
    throw new Error(`Endpoint inatteso: ${endpoint}`);
  };

  try {
    const service = createShotPredictionService({
      fetchSofaScore,
      cacheDir,
      upstreamMinIntervalMs: 0,
      upstreamCooldownMs: 60_000,
      upstreamForbiddenCooldownMs: 0,
    });
    assert.equal((await service.getPrediction(target.id)).status, 'building');
    await service.jobs.get(`999:${MODEL_VERSION}`).promise;
    assert.equal(statisticsCalls, 1);
    await assert.rejects(
      () => service.getPrediction(target.id),
      (error) => error.code === 'upstream_forbidden',
    );
    assert.equal((await service.getCircuitStatus()).blocked, false);

    const restartedService = createShotPredictionService({
      fetchSofaScore,
      cacheDir,
      upstreamMinIntervalMs: 0,
      upstreamCooldownMs: 60_000,
      upstreamForbiddenCooldownMs: 0,
    });
    const restartedCircuit = await restartedService.getCircuitStatus();
    assert.equal(restartedCircuit.blocked, false);
    assert.equal(restartedCircuit.upstreamStatus, null);
    assert.equal((await restartedService.getPrediction(target.id)).status, 'building');
    await restartedService.jobs.get(`999:${MODEL_VERSION}`).promise;
    await assert.rejects(
      () => restartedService.getPrediction(target.id),
      (error) => error.code === 'upstream_forbidden',
    );
    assert.equal(statisticsCalls, 2, 'un nuovo tentativo deve poter raggiungere subito SofaScore');
  } finally {
    await fs.promises.rm(cacheDir, { recursive: true, force: true });
  }
});
