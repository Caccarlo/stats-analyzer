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
  const first = firstModel.predict(1, 2);
  const second = secondModel.predict(1, 2);
  assert.deepEqual(first, second);
  assert.equal(firstModel.matches, 80);
  assert.equal(secondModel.matches, 80);
});

test('servizio storico separa previsione, dettagli point-in-time e medie descrittive', async () => {
  const cacheDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'shot-model-test-'));
  const seasons = [
    { id: 30, name: '2025/26', year: '2025/26' },
    { id: 20, name: '2024/25', year: '2024/25' },
    { id: 10, name: '2023/24', year: '2023/24' },
  ];
  const leagueEvents = new Map();
  const statistics = new Map();
  let index = 0;
  for (const season of [...seasons].reverse()) {
    const events = [];
    for (let match = 0; match < 36; match += 1) {
      const homeTeamId = (match % 6) + 1;
      const awayTeamId = ((match + 2) % 6) + 1;
      const event = {
        id: 1_000 + index,
        startTimestamp: 1_650_000_000 + index * 86_400,
        tournament: { uniqueTournament: { id: 23, name: 'Serie A' } },
        season,
        homeTeam: { id: homeTeamId, name: `Team ${homeTeamId}` },
        awayTeam: { id: awayTeamId, name: `Team ${awayTeamId}` },
        status: { type: 'finished', code: 100, description: 'Ended' },
      };
      events.push(event);
      statistics.set(event.id, {
        statistics: [{
          period: 'ALL',
          groups: [{ statisticsItems: [{ key: 'totalShotsOnGoal', homeValue: 12 + index % 5, awayValue: 8 + index % 4 }] }],
        }],
      });
      index += 1;
    }
    leagueEvents.set(season.id, events);
  }

  const targetTimestamp = 1_650_000_000 + index * 86_400;
  const target = {
    id: 999,
    startTimestamp: targetTimestamp,
    tournament: { uniqueTournament: { id: 23, name: 'Serie A' } },
    season: seasons[0],
    homeTeam: { id: 1, name: 'Team 1' },
    awayTeam: { id: 2, name: 'Team 2' },
    status: { type: 'finished', code: 100, description: 'Ended' },
  };
  const promotedTarget = {
    ...target,
    id: 997,
    homeTeam: { id: 99, name: 'Promoted 99' },
  };
  const later = {
    ...target,
    id: 998,
    startTimestamp: targetTimestamp + 86_400,
  };
  leagueEvents.get(seasons[0].id).push(target, later);
  statistics.set(target.id, {
    statistics: [{ period: 'ALL', groups: [{ statisticsItems: [{ key: 'totalShotsOnGoal', homeValue: 99, awayValue: 98 }] }] }],
  });
  statistics.set(later.id, {
    statistics: [{ period: 'ALL', groups: [{ statisticsItems: [{ key: 'totalShotsOnGoal', homeValue: 97, awayValue: 96 }] }] }],
  });
  const lowerSeasons = [
    { id: 50, name: '2024/25', year: '2024/25' },
    { id: 40, name: '2023/24', year: '2023/24' },
  ];
  const lowerEvents = new Map();
  for (const lowerSeason of lowerSeasons) {
    const events = [];
    const homePool = lowerSeason.id === 50 ? [99, 7, 8, 9] : [1, 2, 3, 7];
    const awayPool = [8, 9, 10, 11];
    for (let match = 0; match < 32; match += 1) {
      const event = {
        id: 5_000 + lowerSeason.id * 100 + match,
        startTimestamp: 1_620_000_000 + lowerSeason.id * 100_000 + match * 86_400,
        tournament: { uniqueTournament: { id: 53, name: 'Serie B' } },
        season: lowerSeason,
        homeTeam: { id: homePool[match % homePool.length], name: `Lower ${homePool[match % homePool.length]}` },
        awayTeam: { id: awayPool[match % awayPool.length], name: `Lower ${awayPool[match % awayPool.length]}` },
        status: { type: 'finished', code: 100, description: 'Ended' },
      };
      events.push(event);
      statistics.set(event.id, {
        statistics: [{
          period: 'ALL',
          groups: [{ statisticsItems: [{ key: 'totalShotsOnGoal', homeValue: 13 + match % 4, awayValue: 9 + match % 3 }] }],
        }],
      });
    }
    lowerEvents.set(lowerSeason.id, events);
  }

  const requestedEndpoints = [];
  const fetchSofaScore = async (endpoint) => {
    requestedEndpoints.push(endpoint);
    if (endpoint === 'event/999') return { event: target };
    if (endpoint === 'event/997') return { event: promotedTarget };
    if (endpoint === 'unique-tournament/23/seasons') return { seasons };
    if (endpoint === 'unique-tournament/53/seasons') return { seasons: lowerSeasons };
    if (endpoint === 'team/1/team-statistics/seasons') {
      return { uniqueTournamentSeasons: [{ uniqueTournament: { id: 23, name: 'Serie A' }, seasons }] };
    }
    const eventPage = endpoint.match(/^unique-tournament\/23\/season\/(\d+)\/events\/last\/(\d+)$/);
    if (eventPage) {
      return { events: Number(eventPage[2]) === 0 ? leagueEvents.get(Number(eventPage[1])) : [], hasNextPage: false };
    }
    const lowerEventPage = endpoint.match(/^unique-tournament\/53\/season\/(\d+)\/events\/last\/(\d+)$/);
    if (lowerEventPage) {
      return { events: Number(lowerEventPage[2]) === 0 ? lowerEvents.get(Number(lowerEventPage[1])) : [], hasNextPage: false };
    }
    const statistic = endpoint.match(/^event\/(\d+)\/statistics$/);
    if (statistic && statistics.has(Number(statistic[1]))) return statistics.get(Number(statistic[1]));
    throw new Error(`Endpoint inatteso: ${endpoint}`);
  };

  try {
    const service = createShotPredictionService({ fetchSofaScore, cacheDir, upstreamMinIntervalMs: 0 });
    const building = await service.getPrediction(target.id);
    assert.equal(building.status, 'building');
    await service.jobs.get(`999:${MODEL_VERSION}`).promise;
    const ready = await service.getPrediction(target.id);
    assert.equal(ready.status, 'ready');
    assert.ok(ready.prediction.expected.total < 60, 'il risultato target estremo non deve contaminare la media');
    assert.deepEqual(ready.prediction.diagnostics.seasonsUsed.map((season) => season.id), [30, 20]);

    const details = await service.getDetails(target.id, 'expected-total', 'home', 1, 25);
    assert.ok(details.matches.items.every((match) => match.eventId !== target.id && match.eventId !== later.id));
    assert.ok(details.matches.items.every((match) => match.startTimestamp < target.startTimestamp));

    const catalog = await service.getAverageCatalog(1);
    assert.equal(catalog.competitions[0].id, 23);
    assert.deepEqual(catalog.competitions[0].seasons.map((season) => season.id), [30, 20]);
    const averages = await service.getShotAverages(1, 23, seasons[0].id, 'all');
    assert.ok(averages.shotsFor > 20, 'le medie descrittive devono poter includere target e partita successiva');

    const promotedBuilding = await service.getPrediction(promotedTarget.id);
    assert.equal(promotedBuilding.status, 'building');
    await service.jobs.get(`997:${MODEL_VERSION}`).promise;
    const promotedReady = await service.getPrediction(promotedTarget.id);
    assert.equal(promotedReady.prediction.diagnostics.promotion.applied, true);
    assert.equal(promotedReady.prediction.diagnostics.promotion.teams[0].teamId, 99);
    assert.equal(promotedReady.prediction.diagnostics.promotion.teams[0].cohortSize, 0);
    assert.match(promotedReady.prediction.diagnostics.promotion.note, /stagione precedente/i);
    assert.equal(requestedEndpoints.some((endpoint) => endpoint.includes('/season/10/')), false);
    assert.equal(requestedEndpoints.some((endpoint) => endpoint.includes('/season/40/')), false);
  } finally {
    await fs.promises.rm(cacheDir, { recursive: true, force: true });
  }
});

test('un 403 interrompe le richieste statistiche già accodate', async () => {
  const cacheDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'shot-model-circuit-test-'));
  const seasons = [
    { id: 30, name: '2025/26', year: '2025/26' },
    { id: 20, name: '2024/25', year: '2024/25' },
    { id: 10, name: '2023/24', year: '2023/24' },
  ];
  const target = {
    id: 999,
    startTimestamp: 1_800_000_000,
    tournament: { uniqueTournament: { id: 23, name: 'Serie A' } },
    season: seasons[0],
    homeTeam: { id: 1, name: 'Team 1' },
    awayTeam: { id: 2, name: 'Team 2' },
  };
  const events = Array.from({ length: 80 }, (_, index) => ({
    id: 10_000 + index,
    startTimestamp: 1_700_000_000 + index * 86_400,
    tournament: target.tournament,
    season: index < 40 ? seasons[1] : seasons[0],
    homeTeam: { id: (index % 6) + 1, name: `Team ${(index % 6) + 1}` },
    awayTeam: { id: ((index + 2) % 6) + 1, name: `Team ${((index + 2) % 6) + 1}` },
    status: { type: 'finished', code: 100, description: 'Ended' },
  }));
  let statisticsCalls = 0;

  const fetchSofaScore = async (endpoint) => {
    if (endpoint === 'event/999') return { event: target };
    if (endpoint === 'unique-tournament/23/seasons') return { seasons };
    const page = endpoint.match(/^unique-tournament\/23\/season\/(\d+)\/events\/last\/(\d+)$/);
    if (page) {
      const seasonId = Number(page[1]);
      return {
        events: Number(page[2]) === 0 ? events.filter((event) => event.season.id === seasonId) : [],
        hasNextPage: false,
      };
    }
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
    });
    const building = await service.getPrediction(target.id);
    assert.equal(building.status, 'building');
    await service.jobs.get(`999:${MODEL_VERSION}`).promise;
    assert.ok(statisticsCalls <= 3, `attese al massimo 3 richieste attive, ricevute ${statisticsCalls}`);
    await assert.rejects(
      () => service.getPrediction(target.id),
      (error) => error.code === 'upstream_temporarily_blocked',
    );
  } finally {
    await fs.promises.rm(cacheDir, { recursive: true, force: true });
  }
});
