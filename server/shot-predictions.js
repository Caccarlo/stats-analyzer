const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const MODEL_VERSION = 'shots-v1.3.0-football-data';
const SUPPORTED_COMPETITIONS = new Map([
  [23, { name: 'Serie A', secondDivisionId: 53 }],
  [17, { name: 'Premier League', secondDivisionId: 18 }],
  [8, { name: 'LaLiga', secondDivisionId: 54 }],
  [35, { name: 'Bundesliga', secondDivisionId: 44 }],
  [34, { name: 'Ligue 1', secondDivisionId: 182 }],
]);
const HALF_LIFE_CANDIDATES = [60, 90, 120, 180, 270, 365];
const SHRINKAGE_CANDIDATES = [5, 10, 20];
const PROMOTION_EQUIVALENT_MATCHES = [5, 10, 20];
const SIX_HOURS = 6 * 60 * 60 * 1000;
const ONE_DAY = 24 * 60 * 60 * 1000;
const MAX_EVENT_PAGES = 30;
const MAX_TEAM_EVENT_PAGES = 8;
const MAX_TEAM_VENUE_MATCHES = 40;
const MIN_TEAM_VENUE_MATCHES = 8;
const HISTORY_SEASON_COUNT = 2;
const DEFAULT_UPSTREAM_MIN_INTERVAL_MS = 5_000;
const DEFAULT_UPSTREAM_COOLDOWN_MS = 24 * 60 * 60 * 1000;

class ShotModelError extends Error {
  constructor(message, statusCode = 502, code = 'upstream_error') {
    super(message);
    this.name = 'ShotModelError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value, digits) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function safeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function isFinishedEvent(event) {
  return event?.status?.type === 'finished'
    || event?.status?.code === 100
    || /finished|after extra time|after penalties/i.test(event?.status?.description || '');
}

function extractTotalShots(statisticsPayload) {
  const periods = Array.isArray(statisticsPayload?.statistics) ? statisticsPayload.statistics : [];
  const allPeriod = periods.find((period) => period?.period === 'ALL') || periods[0];
  const groups = Array.isArray(allPeriod?.groups) ? allPeriod.groups : [];

  for (const group of groups) {
    const items = Array.isArray(group?.statisticsItems) ? group.statisticsItems : [];
    const item = items.find((candidate) => candidate?.key === 'totalShotsOnGoal');
    if (!item) continue;

    const home = safeNumber(item.homeValue);
    const away = safeNumber(item.awayValue);
    if (home === null || away === null || home < 0 || away < 0) return null;
    return { home, away };
  }

  return null;
}

function temporalWeight(days, halfLifeDays) {
  return 2 ** (-Math.max(0, days) / halfLifeDays);
}

function effectiveSampleSize(weights) {
  const sum = weights.reduce((total, weight) => total + weight, 0);
  const squareSum = weights.reduce((total, weight) => total + weight * weight, 0);
  return squareSum > 0 ? (sum * sum) / squareSum : 0;
}

function weightedMean(values, weights, fallback = 1) {
  let numerator = 0;
  let denominator = 0;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    const weight = weights[index];
    if (!Number.isFinite(value) || !Number.isFinite(weight) || weight <= 0) continue;
    numerator += value * weight;
    denominator += weight;
  }
  return denominator > 0 ? numerator / denominator : fallback;
}

function shrinkRating(rawRating, weights, priorMatches) {
  const nEff = effectiveSampleSize(weights);
  return {
    raw: rawRating,
    value: (nEff * rawRating + priorMatches) / (nEff + priorMatches),
    nEff,
  };
}

function logGamma(value) {
  const coefficients = [
    676.5203681218851,
    -1259.1392167224028,
    771.32342877765313,
    -176.6150291621406,
    12.507343278686905,
    -0.13857109526572012,
    9.984369578019571e-6,
    1.5056327351493116e-7,
  ];

  if (value < 0.5) {
    return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * value)) - logGamma(1 - value);
  }

  let adjusted = value - 1;
  let accumulator = 0.9999999999998099;
  for (let index = 0; index < coefficients.length; index += 1) {
    accumulator += coefficients[index] / (adjusted + index + 1);
  }
  const term = adjusted + coefficients.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (adjusted + 0.5) * Math.log(term) - term + Math.log(accumulator);
}

function poissonLogPmf(value, mean) {
  const mu = Math.max(1e-9, mean);
  return value * Math.log(mu) - mu - logGamma(value + 1);
}

function negativeBinomialLogPmf(value, mean, dispersion) {
  const mu = Math.max(1e-9, mean);
  const size = Math.max(1e-6, dispersion);
  const probability = size / (size + mu);
  return logGamma(value + size)
    - logGamma(size)
    - logGamma(value + 1)
    + size * Math.log(probability)
    + value * Math.log(1 - probability);
}

function poissonCdf(maxValue, mean) {
  if (maxValue < 0) return 0;
  const mu = Math.max(0, mean);
  let probability = Math.exp(-mu);
  let total = probability;
  for (let value = 1; value <= maxValue; value += 1) {
    probability *= mu / value;
    total += probability;
  }
  return clamp(total, 0, 1);
}

function negativeBinomialCdf(maxValue, mean, dispersion) {
  if (maxValue < 0) return 0;
  const mu = Math.max(1e-9, mean);
  const size = Math.max(1e-6, dispersion);
  const successProbability = size / (size + mu);
  let probability = Math.exp(size * Math.log(successProbability));
  let total = probability;
  for (let value = 1; value <= maxValue; value += 1) {
    probability *= ((value - 1 + size) / value) * (1 - successProbability);
    total += probability;
  }
  return clamp(total, 0, 1);
}

function distributionCdf(maxValue, mean, distribution) {
  return distribution.type === 'negative-binomial'
    ? negativeBinomialCdf(maxValue, mean, distribution.dispersion)
    : poissonCdf(maxValue, mean);
}

function distributionLogPmf(value, mean, distribution) {
  return distribution.type === 'negative-binomial'
    ? negativeBinomialLogPmf(value, mean, distribution.dispersion)
    : poissonLogPmf(value, mean);
}

function distributionQuantile(probability, mean, distribution) {
  const maximum = Math.max(100, Math.ceil(mean * 5 + 30));
  for (let value = 0; value <= maximum; value += 1) {
    if (distributionCdf(value, mean, distribution) >= probability) return value;
  }
  return maximum;
}

function buildMarketLines(mean, distribution) {
  const searchMin = Math.max(0, Math.floor(mean) - 12);
  const searchMax = Math.ceil(mean) + 12;
  let mainThreshold = searchMin;
  let closestDistance = Number.POSITIVE_INFINITY;

  for (let threshold = searchMin; threshold <= searchMax; threshold += 1) {
    const under = distributionCdf(threshold, mean, distribution);
    const distance = Math.abs(under - 0.5);
    if (distance < closestDistance) {
      mainThreshold = threshold;
      closestDistance = distance;
    }
  }

  const lines = [];
  for (let threshold = mainThreshold - 3; threshold <= mainThreshold + 3; threshold += 1) {
    const underProbability = clamp(distributionCdf(threshold, mean, distribution), 1e-9, 1 - 1e-9);
    const overProbability = 1 - underProbability;
    lines.push({
      line: threshold + 0.5,
      underProbability,
      underFairOdds: 1 / underProbability,
      overProbability,
      overFairOdds: 1 / overProbability,
      isMain: threshold === mainThreshold,
    });
  }
  return lines;
}

function solveLinearSystem(matrix, vector) {
  const size = vector.length;
  const augmented = matrix.map((row, index) => [...row, vector[index]]);
  for (let pivot = 0; pivot < size; pivot += 1) {
    let best = pivot;
    for (let row = pivot + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][pivot]) > Math.abs(augmented[best][pivot])) best = row;
    }
    [augmented[pivot], augmented[best]] = [augmented[best], augmented[pivot]];
    if (Math.abs(augmented[pivot][pivot]) < 1e-9) continue;
    const divisor = augmented[pivot][pivot];
    for (let column = pivot; column <= size; column += 1) augmented[pivot][column] /= divisor;
    for (let row = 0; row < size; row += 1) {
      if (row === pivot) continue;
      const factor = augmented[row][pivot];
      for (let column = pivot; column <= size; column += 1) {
        augmented[row][column] -= factor * augmented[pivot][column];
      }
    }
  }
  return augmented.map((row) => Number.isFinite(row[size]) ? row[size] : 0);
}

function weightedRegression(rows, degree) {
  const dimensions = degree + 1;
  const matrix = Array.from({ length: dimensions }, () => Array(dimensions).fill(0));
  const vector = Array(dimensions).fill(0);
  for (const row of rows) {
    const features = [1, row.x, row.x * row.x].slice(0, dimensions);
    for (let outer = 0; outer < dimensions; outer += 1) {
      vector[outer] += row.weight * features[outer] * row.y;
      for (let inner = 0; inner < dimensions; inner += 1) {
        matrix[outer][inner] += row.weight * features[outer] * features[inner];
      }
    }
  }
  for (let index = 0; index < dimensions; index += 1) matrix[index][index] += 1e-4;
  return solveLinearSystem(matrix, vector);
}

function evaluatePolynomial(coefficients, value) {
  return (coefficients[0] || 0) + (coefficients[1] || 0) * value + (coefficients[2] || 0) * value * value;
}

function createLimiter(maximumConcurrent) {
  let active = 0;
  const queue = [];
  const runNext = () => {
    if (active >= maximumConcurrent || queue.length === 0) return;
    const entry = queue.shift();
    active += 1;
    Promise.resolve()
      .then(entry.task)
      .then(entry.resolve, entry.reject)
      .finally(() => {
        active -= 1;
        runNext();
      });
  };
  const schedule = (task) => new Promise((resolve, reject) => {
    queue.push({ task, resolve, reject });
    runNext();
  });
  schedule.clearQueue = (error) => {
    const pending = queue.splice(0);
    pending.forEach((entry) => entry.reject(error));
  };
  return schedule;
}

class DiskJsonCache {
  constructor(root) {
    this.root = root;
  }

  filePath(namespace, key) {
    const digest = crypto.createHash('sha1').update(String(key)).digest('hex');
    return path.join(this.root, namespace, `${digest}.json`);
  }

  async get(namespace, key, maxAgeMs = Number.POSITIVE_INFINITY) {
    try {
      const payload = JSON.parse(await fs.promises.readFile(this.filePath(namespace, key), 'utf8'));
      if (Date.now() - payload.savedAt > maxAgeMs) return null;
      return payload.data;
    } catch {
      return null;
    }
  }

  async set(namespace, key, data) {
    const target = this.filePath(namespace, key);
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
    await fs.promises.writeFile(temporary, JSON.stringify({ savedAt: Date.now(), data }));
    await fs.promises.rename(temporary, target);
    return data;
  }
}

function compareObservations(first, second) {
  return first.startTimestamp - second.startTimestamp
    || String(first.eventId).localeCompare(String(second.eventId));
}

function annotatePointInTimeRatings(observations) {
  const sorted = [...observations].sort(compareObservations);
  const teamState = new Map();
  let leagueHomeShots = 0;
  let leagueAwayShots = 0;
  let leagueMatches = 0;

  const getTeam = (teamId) => {
    if (!teamState.has(teamId)) {
      teamState.set(teamId, {
        homeMatches: 0,
        awayMatches: 0,
        homeFor: 0,
        homeAgainst: 0,
        awayFor: 0,
        awayAgainst: 0,
      });
    }
    return teamState.get(teamId);
  };

  return sorted.map((observation) => {
    const baselineHome = leagueMatches > 0 ? leagueHomeShots / leagueMatches : 13;
    const baselineAway = leagueMatches > 0 ? leagueAwayShots / leagueMatches : 11;
    const home = getTeam(observation.homeTeamId);
    const away = getTeam(observation.awayTeamId);
    const prior = 10;
    const shrunk = (sum, matches, baseline) => ((sum / Math.max(1e-9, baseline)) + prior) / (matches + prior);

    const point = {
      ...observation,
      pointInTime: {
        homeAttack: shrunk(home.homeFor, home.homeMatches, baselineHome),
        homeVulnerability: shrunk(home.homeAgainst, home.homeMatches, baselineAway),
        awayAttack: shrunk(away.awayFor, away.awayMatches, baselineAway),
        awayVulnerability: shrunk(away.awayAgainst, away.awayMatches, baselineHome),
      },
    };

    home.homeMatches += 1;
    home.homeFor += observation.homeShots;
    home.homeAgainst += observation.awayShots;
    away.awayMatches += 1;
    away.awayFor += observation.awayShots;
    away.awayAgainst += observation.homeShots;
    leagueMatches += 1;
    leagueHomeShots += observation.homeShots;
    leagueAwayShots += observation.awayShots;
    return point;
  });
}

function fitLeagueModel(observations, cutoffTimestamp, halfLifeDays, shrinkageMatches, effect = 'none') {
  const usable = observations.filter((observation) => observation.startTimestamp < cutoffTimestamp);
  const cutoffDays = cutoffTimestamp / 86400;
  const weights = usable.map((observation) => temporalWeight(cutoffDays - observation.startTimestamp / 86400, halfLifeDays));
  const baselineHome = weightedMean(usable.map((observation) => observation.homeShots), weights, 13);
  const baselineAway = weightedMean(usable.map((observation) => observation.awayShots), weights, 11);
  const ratings = new Map();

  const collect = (teamId, venue, kind) => {
    const values = [];
    const selectedWeights = [];
    usable.forEach((observation, index) => {
      const weight = weights[index];
      if (venue === 'home' && observation.homeTeamId === teamId) {
        values.push(kind === 'attack'
          ? (observation.homeShots / baselineHome) / Math.max(0.45, observation.pointInTime.awayVulnerability)
          : (observation.awayShots / baselineAway) / Math.max(0.45, observation.pointInTime.awayAttack));
        selectedWeights.push(weight);
      }
      if (venue === 'away' && observation.awayTeamId === teamId) {
        values.push(kind === 'attack'
          ? (observation.awayShots / baselineAway) / Math.max(0.45, observation.pointInTime.homeVulnerability)
          : (observation.homeShots / baselineHome) / Math.max(0.45, observation.pointInTime.homeAttack));
        selectedWeights.push(weight);
      }
    });
    const raw = weightedMean(values, selectedWeights, 1);
    return shrinkRating(raw, selectedWeights, shrinkageMatches);
  };

  const teamIds = new Set();
  usable.forEach((observation) => {
    teamIds.add(observation.homeTeamId);
    teamIds.add(observation.awayTeamId);
  });
  teamIds.forEach((teamId) => {
    ratings.set(teamId, {
      homeAttack: collect(teamId, 'home', 'attack'),
      homeVulnerability: collect(teamId, 'home', 'vulnerability'),
      awayAttack: collect(teamId, 'away', 'attack'),
      awayVulnerability: collect(teamId, 'away', 'vulnerability'),
    });
  });

  const defaultRating = () => ({ raw: 1, value: 1, nEff: 0 });
  const getRating = (teamId) => ratings.get(teamId) || {
    homeAttack: defaultRating(),
    homeVulnerability: defaultRating(),
    awayAttack: defaultRating(),
    awayVulnerability: defaultRating(),
  };
  const strength = (teamId) => {
    const rating = getRating(teamId);
    const attack = (rating.homeAttack.value + rating.awayAttack.value) / 2;
    const vulnerability = (rating.homeVulnerability.value + rating.awayVulnerability.value) / 2;
    return Math.log(Math.max(0.25, attack) / Math.max(0.25, vulnerability));
  };
  const basePrediction = (homeTeamId, awayTeamId) => {
    const home = getRating(homeTeamId);
    const away = getRating(awayTeamId);
    return {
      home: baselineHome * home.homeAttack.value * away.awayVulnerability.value,
      away: baselineAway * away.awayAttack.value * home.homeVulnerability.value,
      strengthGap: strength(homeTeamId) - strength(awayTeamId),
    };
  };

  let homeEffect = [0];
  let awayEffect = [0];
  if (effect !== 'none' && usable.length >= 50) {
    const degree = effect === 'quadratic' ? 2 : 1;
    const homeRows = [];
    const awayRows = [];
    usable.forEach((observation, index) => {
      const base = basePrediction(observation.homeTeamId, observation.awayTeamId);
      homeRows.push({
        x: base.strengthGap,
        y: Math.log((observation.homeShots + 0.5) / (base.home + 0.5)),
        weight: weights[index],
      });
      awayRows.push({
        x: base.strengthGap,
        y: Math.log((observation.awayShots + 0.5) / (base.away + 0.5)),
        weight: weights[index],
      });
    });
    homeEffect = weightedRegression(homeRows, degree);
    awayEffect = weightedRegression(awayRows, degree);
  }

  const predict = (homeTeamId, awayTeamId) => {
    const base = basePrediction(homeTeamId, awayTeamId);
    const homeAdjustment = effect === 'none' ? 0 : evaluatePolynomial(homeEffect, base.strengthGap);
    const awayAdjustment = effect === 'none' ? 0 : evaluatePolynomial(awayEffect, base.strengthGap);
    return {
      home: clamp(base.home * Math.exp(clamp(homeAdjustment, -0.5, 0.5)), 2, 35),
      away: clamp(base.away * Math.exp(clamp(awayAdjustment, -0.5, 0.5)), 2, 35),
      strengthGap: base.strengthGap,
      homeAdjustment,
      awayAdjustment,
    };
  };

  const fittedTotals = usable.map((observation) => {
    const prediction = predict(observation.homeTeamId, observation.awayTeamId);
    return { observed: observation.homeShots + observation.awayShots, mean: prediction.home + prediction.away };
  });
  const numerator = fittedTotals.reduce((total, item) => total + ((item.observed - item.mean) ** 2 - item.observed), 0);
  const denominator = fittedTotals.reduce((total, item) => total + item.mean ** 2, 0);
  const overdispersion = denominator > 0 ? Math.max(0, numerator / denominator) : 0;
  const dispersion = overdispersion > 1e-6 ? 1 / overdispersion : 1e6;

  return {
    baselineHome,
    baselineAway,
    ratings,
    getRating,
    predict,
    homeEffect,
    awayEffect,
    dispersion,
    matches: usable.length,
    weights,
  };
}

function makeBacktestCuts(observations) {
  const sorted = [...observations].sort(compareObservations);
  if (sorted.length < 70) return [];
  const start = Math.max(50, Math.floor(sorted.length * 0.65));
  const candidates = sorted.slice(start);
  const stride = Math.max(1, Math.ceil(candidates.length / 72));
  return candidates.filter((_, index) => index % stride === 0).slice(-72);
}

function evaluateConfiguration(observations, cuts, halfLifeDays, shrinkageMatches, effect, distributionType) {
  let negativeLogLikelihood = 0;
  let absoluteError = 0;
  let observedSum = 0;
  let predictedSum = 0;
  let count = 0;

  for (const target of cuts) {
    const train = observations.filter((observation) => observation.startTimestamp < target.startTimestamp);
    if (train.length < 50) continue;
    const model = fitLeagueModel(train, target.startTimestamp, halfLifeDays, shrinkageMatches, effect);
    const prediction = model.predict(target.homeTeamId, target.awayTeamId);
    const mean = prediction.home + prediction.away;
    const observed = target.homeShots + target.awayShots;
    const distribution = distributionType === 'negative-binomial'
      ? { type: 'negative-binomial', dispersion: model.dispersion }
      : { type: 'poisson' };
    negativeLogLikelihood -= distributionLogPmf(observed, mean, distribution);
    absoluteError += Math.abs(observed - mean);
    observedSum += observed;
    predictedSum += mean;
    count += 1;
  }

  return {
    sampleSize: count,
    nll: count > 0 ? negativeLogLikelihood / count : Number.POSITIVE_INFINITY,
    mae: count > 0 ? absoluteError / count : Number.POSITIVE_INFINITY,
    calibrationError: observedSum > 0 ? Math.abs(predictedSum - observedSum) / observedSum : Number.POSITIVE_INFINITY,
  };
}

function selectModelParameters(observations) {
  const cuts = makeBacktestCuts(observations);
  if (cuts.length === 0) {
    return {
      halfLifeDays: 180,
      shrinkageMatches: 10,
      effect: 'none',
      distributionType: 'poisson',
      backtest: { sampleSize: 0, nll: null, mae: null, calibrationError: null, note: 'Campione insufficiente per un backtest completo.' },
      alternatives: [],
    };
  }

  const alternatives = [];
  for (const halfLifeDays of HALF_LIFE_CANDIDATES) {
    for (const shrinkageMatches of SHRINKAGE_CANDIDATES) {
      const metrics = evaluateConfiguration(observations, cuts, halfLifeDays, shrinkageMatches, 'none', 'poisson');
      alternatives.push({ halfLifeDays, shrinkageMatches, effect: 'none', distribution: 'poisson', ...metrics });
    }
  }
  alternatives.sort((first, second) => first.nll - second.nll || first.mae - second.mae);
  const base = alternatives[0];

  const effectCandidates = ['linear', 'quadratic'].map((effect) => ({
    effect,
    ...evaluateConfiguration(observations, cuts, base.halfLifeDays, base.shrinkageMatches, effect, 'poisson'),
  }));
  const eligibleEffects = effectCandidates.filter((candidate) => (
    candidate.nll <= base.nll * 0.99
    && candidate.mae <= base.mae
    && candidate.calibrationError <= 0.1
  ));
  eligibleEffects.sort((first, second) => first.nll - second.nll || first.mae - second.mae);
  const chosenEffect = eligibleEffects[0]?.effect || 'none';
  const chosenEffectMetrics = chosenEffect === 'none' ? base : eligibleEffects[0];

  const poissonMetrics = evaluateConfiguration(
    observations,
    cuts,
    base.halfLifeDays,
    base.shrinkageMatches,
    chosenEffect,
    'poisson',
  );
  const negativeBinomialMetrics = evaluateConfiguration(
    observations,
    cuts,
    base.halfLifeDays,
    base.shrinkageMatches,
    chosenEffect,
    'negative-binomial',
  );
  const distributionType = negativeBinomialMetrics.nll < poissonMetrics.nll * 0.995
    ? 'negative-binomial'
    : 'poisson';
  const finalMetrics = distributionType === 'negative-binomial' ? negativeBinomialMetrics : poissonMetrics;

  return {
    halfLifeDays: base.halfLifeDays,
    shrinkageMatches: base.shrinkageMatches,
    effect: chosenEffect,
    distributionType,
    backtest: {
      sampleSize: finalMetrics.sampleSize,
      nll: finalMetrics.nll,
      mae: finalMetrics.mae,
      calibrationError: finalMetrics.calibrationError,
      poissonNll: poissonMetrics.nll,
      negativeBinomialNll: negativeBinomialMetrics.nll,
      noStrengthTermNll: base.nll,
      selectedStrengthTermNll: chosenEffectMetrics.nll,
    },
    alternatives: [...alternatives.slice(0, 5), ...effectCandidates],
  };
}

function seasonYearValue(season) {
  const label = String(season?.year || season?.name || '');
  const fourDigitRange = label.match(/\b((?:19|20)\d{2})\s*[/-]\s*(?:(?:19|20)?\d{2})\b/);
  if (fourDigitRange) return Number(fourDigitRange[1]);
  const twoDigitRange = label.match(/(?:^|\D)(\d{2})\s*[/-]\s*(\d{2})(?:\D|$)/);
  if (twoDigitRange) {
    const start = Number(twoDigitRange[1]);
    return start <= 50 ? 2000 + start : 1900 + start;
  }
  const singleYear = label.match(/\b((?:19|20)\d{2})\b/);
  return singleYear ? Number(singleYear[1]) : null;
}

function seasonSortValue(season) {
  return seasonYearValue(season) ?? safeNumber(season?.id) ?? 0;
}

function formatEventLabel(observation) {
  return `${observation.homeTeamName} - ${observation.awayTeamName}`;
}

function calculateSeasonRatings(observations, teamId) {
  const baselineHome = observations.length
    ? observations.reduce((total, observation) => total + observation.homeShots, 0) / observations.length
    : 13;
  const baselineAway = observations.length
    ? observations.reduce((total, observation) => total + observation.awayShots, 0) / observations.length
    : 11;
  const home = observations.filter((observation) => observation.homeTeamId === teamId);
  const away = observations.filter((observation) => observation.awayTeamId === teamId);
  const average = (rows, selector, fallback = 1) => rows.length
    ? rows.reduce((total, row) => total + selector(row), 0) / rows.length
    : fallback;
  return {
    homeAttack: average(home, (observation) => observation.homeShots / baselineHome),
    homeVulnerability: average(home, (observation) => observation.awayShots / baselineAway),
    awayAttack: average(away, (observation) => observation.awayShots / baselineAway),
    awayVulnerability: average(away, (observation) => observation.homeShots / baselineHome),
    homeMatches: home.length,
    awayMatches: away.length,
  };
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((first, second) => first - second);
  if (sorted.length === 0) return 1;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function standardDeviation(values) {
  if (values.length < 2) return 0;
  const mean = values.reduce((total, value) => total + value, 0) / values.length;
  return Math.sqrt(values.reduce((total, value) => total + (value - mean) ** 2, 0) / (values.length - 1));
}

function serializePrediction({
  event,
  competition,
  parameters,
  model,
  modelTeamIds,
  forecast,
  distribution,
  markets,
  dataset,
  excludedMissing,
  seasons,
  warnings,
  promotion,
  dataSource,
}) {
  const homeRating = model.getRating(modelTeamIds.home);
  const awayRating = model.getRating(modelTeamIds.away);
  const cutoffTimestamp = event.startTimestamp;
  const uncertaintyExpansion = Math.ceil(promotion.uncertaintyShots || 0);
  const interval = [
    Math.max(0, distributionQuantile(0.1, forecast.home + forecast.away, distribution) - uncertaintyExpansion),
    distributionQuantile(0.9, forecast.home + forecast.away, distribution) + uncertaintyExpansion,
  ];

  return {
    status: 'ready',
    prediction: {
      eventId: event.id,
      modelVersion: MODEL_VERSION,
      generatedAt: new Date().toISOString(),
      cutoffTimestamp,
      cutoffIso: new Date(cutoffTimestamp * 1000).toISOString(),
      competition: { id: event.tournament.uniqueTournament.id, name: competition.name },
      season: event.season ? { id: event.season.id, name: event.season.name, year: event.season.year } : null,
      homeTeam: { id: event.homeTeam.id, name: event.homeTeam.name },
      awayTeam: { id: event.awayTeam.id, name: event.awayTeam.name },
      expected: {
        home: forecast.home,
        away: forecast.away,
        total: forecast.home + forecast.away,
        interval80: interval,
      },
      distribution,
      mainLine: markets.find((market) => market.isMain)?.line ?? null,
      markets,
      diagnostics: {
        baseline: { home: model.baselineHome, away: model.baselineAway },
        ratings: {
          homeAttack: homeRating.homeAttack,
          homeVulnerability: homeRating.homeVulnerability,
          awayAttack: awayRating.awayAttack,
          awayVulnerability: awayRating.awayVulnerability,
        },
        betaAttack: 1,
        betaDefense: 1,
        halfLifeDays: parameters.halfLifeDays,
        shrinkageMatches: parameters.shrinkageMatches,
        promotionEquivalentMatchesCandidates: PROMOTION_EQUIVALENT_MATCHES,
        effectiveSample: {
          home: Math.min(homeRating.homeAttack.nEff, homeRating.homeVulnerability.nEff),
          away: Math.min(awayRating.awayAttack.nEff, awayRating.awayVulnerability.nEff),
          league: effectiveSampleSize(model.weights),
        },
        strength: {
          difference: forecast.strengthGap,
          selectedTerm: parameters.effect,
          homeLogAdjustment: forecast.homeAdjustment,
          awayLogAdjustment: forecast.awayAdjustment,
          retained: parameters.effect !== 'none',
        },
        backtest: parameters.backtest,
        matchesUsed: dataset.length,
        latestObservationTimestamp: dataset.reduce((latest, observation) => Math.max(latest, observation.startTimestamp), 0),
        missingStatisticsExcluded: excludedMissing,
        seasonsUsed: seasons.map((season) => ({ id: season.id, name: season.name, year: season.year })),
        dataSource,
        promotion,
        warnings,
      },
    },
  };
}

function buildUsedMatchRows(dataset, event, modelTeamIds, halfLifeDays, model) {
  const cutoffDays = event.startTimestamp / 86400;
  const makeRows = (teamId) => {
    const rows = dataset
    .filter((observation) => observation.homeTeamId === teamId || observation.awayTeamId === teamId)
    .sort((first, second) => second.startTimestamp - first.startTimestamp)
    .map((observation) => {
      const isHome = observation.homeTeamId === teamId;
      const days = Math.max(0, cutoffDays - observation.startTimestamp / 86400);
      const opponentStrength = isHome
        ? Math.log(observation.pointInTime.awayAttack / Math.max(0.25, observation.pointInTime.awayVulnerability))
        : Math.log(observation.pointInTime.homeAttack / Math.max(0.25, observation.pointInTime.homeVulnerability));
      const shotsFor = isHome ? observation.homeShots : observation.awayShots;
      const shotsAgainst = isHome ? observation.awayShots : observation.homeShots;
      const weight = temporalWeight(days, halfLifeDays);
      const baseline = isHome ? model.baselineHome : model.baselineAway;
      const opponentVulnerability = isHome
        ? observation.pointInTime.awayVulnerability
        : observation.pointInTime.homeVulnerability;
      return {
        eventId: observation.eventId,
        startTimestamp: observation.startTimestamp,
        date: new Date(observation.startTimestamp * 1000).toISOString(),
        competition: observation.competitionName,
        match: formatEventLabel(observation),
        venue: isHome ? 'home' : 'away',
        shotsFor,
        shotsAgainst,
        totalShots: shotsFor + shotsAgainst,
        daysFromCutoff: days,
        temporalWeight: weight,
        opponentPointInTimeStrength: opponentStrength,
        normalizedRate: (shotsFor / baseline) / Math.max(0.45, opponentVulnerability),
      };
    });
    const totalWeight = rows.reduce((total, row) => total + row.temporalWeight, 0);
    return rows.map(({ normalizedRate, ...row }) => ({
      ...row,
      ratingContribution: totalWeight > 0 ? row.temporalWeight * normalizedRate / totalWeight : 0,
    }));
  };

  return {
    home: makeRows(modelTeamIds.home),
    away: makeRows(modelTeamIds.away),
  };
}

function buildCalculationDetails(prediction, selection) {
  const diagnostics = prediction.diagnostics;
  const expected = prediction.expected;
  const selectedMarket = prediction.markets.find((market) => (
    selection === `under:${market.line}` || selection === `over:${market.line}`
  ));
  const isUnder = selection?.startsWith('under:');
  const selectedProbability = selectedMarket
    ? (isUnder ? selectedMarket.underProbability : selectedMarket.overProbability)
    : null;
  const selectedOdds = selectedMarket
    ? (isUnder ? selectedMarket.underFairOdds : selectedMarket.overFairOdds)
    : null;

  return {
    selection,
    formula: diagnostics.strength.retained
      ? 'μ_casa = L_H × A_casa^βA × V_trasferta^βD × exp(f(D)); μ_ospite = L_A × A_trasferta^βA × V_casa^βD × exp(g(D))'
      : 'μ_casa = L_H × A_casa × V_trasferta; μ_ospite = L_A × A_trasferta × V_casa',
    values: {
      expectedHome: expected.home,
      expectedAway: expected.away,
      expectedTotal: expected.total,
      baselineHome: diagnostics.baseline.home,
      baselineAway: diagnostics.baseline.away,
      homeAttack: diagnostics.ratings.homeAttack.value,
      awayAttack: diagnostics.ratings.awayAttack.value,
      homeVulnerability: diagnostics.ratings.homeVulnerability.value,
      awayVulnerability: diagnostics.ratings.awayVulnerability.value,
      betaAttack: diagnostics.betaAttack,
      betaDefense: diagnostics.betaDefense,
      halfLifeDays: diagnostics.halfLifeDays,
      shrinkageMatches: diagnostics.shrinkageMatches,
      effectiveSampleHome: diagnostics.effectiveSample.home,
      effectiveSampleAway: diagnostics.effectiveSample.away,
      strengthDifference: diagnostics.strength.difference,
      strengthTerm: diagnostics.strength.selectedTerm,
      promotionCorrection: diagnostics.promotion,
      distribution: prediction.distribution,
      selectedLine: selectedMarket?.line ?? null,
      selectedProbability,
      selectedFairOdds: selectedOdds,
    },
    probabilitySteps: selectedMarket ? [
      `La media del totale è ${expected.total.toFixed(6)}.`,
      `La distribuzione selezionata è ${prediction.distribution.type}.`,
      isUnder
        ? `Under ${selectedMarket.line}: P(T ≤ ${Math.floor(selectedMarket.line)}) = ${selectedProbability.toFixed(8)}.`
        : `Over ${selectedMarket.line}: 1 - P(T ≤ ${Math.floor(selectedMarket.line)}) = ${selectedProbability.toFixed(8)}.`,
      `Quota equa = 1 / probabilità = ${selectedOdds.toFixed(8)}.`,
    ] : [],
    modelVersion: prediction.modelVersion,
    cutoffTimestamp: prediction.cutoffTimestamp,
    cutoffIso: prediction.cutoffIso,
    backtest: diagnostics.backtest,
    warnings: diagnostics.warnings,
  };
}

function createShotPredictionService({
  fetchSofaScore,
  fetchTargetEvent = fetchSofaScore,
  shotDataArchive = null,
  cacheDir = path.join(__dirname, '.shot-model-cache'),
  upstreamMinIntervalMs = DEFAULT_UPSTREAM_MIN_INTERVAL_MS,
  upstreamCooldownMs = DEFAULT_UPSTREAM_COOLDOWN_MS,
  now = () => Date.now(),
}) {
  const cache = new DiskJsonCache(cacheDir);
  const limit = createLimiter(1);
  const inFlightFetches = new Map();
  const jobs = new Map();
  const averageJobs = new Map();
  const targetSnapshots = new Map();
  let nextUpstreamStartAt = 0;
  let upstreamBlockedUntil = 0;
  let upstreamBlockedError = null;
  let circuitLoaded = false;
  let circuitLoadPromise = null;

  const makeBlockedError = (upstreamStatus) => {
    const blocked = new ShotModelError(
      `SofaScore ha temporaneamente bloccato le richieste (${upstreamStatus}). Il modello è stato sospeso per evitare ulteriori tentativi.`,
      502,
      'upstream_temporarily_blocked',
    );
    blocked.upstreamStatus = upstreamStatus;
    return blocked;
  };

  const ensureCircuitLoaded = async () => {
    if (circuitLoaded) return;
    if (!circuitLoadPromise) {
      circuitLoadPromise = cache.get('runtime-state', 'model-upstream-circuit', Number.POSITIVE_INFINITY)
        .then((saved) => {
          if (safeNumber(saved?.blockedUntil) > now()) {
            upstreamBlockedUntil = Number(saved.blockedUntil);
            upstreamBlockedError = makeBlockedError(saved.upstreamStatus || 403);
          }
          circuitLoaded = true;
        })
        .finally(() => {
          circuitLoadPromise = null;
        });
    }
    await circuitLoadPromise;
  };

  const getCircuitError = () => {
    if (now() >= upstreamBlockedUntil) {
      upstreamBlockedUntil = 0;
      upstreamBlockedError = null;
      return null;
    }
    return upstreamBlockedError;
  };

  const waitForUpstreamSlot = async () => {
    const currentTime = now();
    const scheduledAt = Math.max(currentTime, nextUpstreamStartAt);
    nextUpstreamStartAt = scheduledAt + Math.max(0, upstreamMinIntervalMs);
    const delay = scheduledAt - currentTime;
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
  };

  const blockUpstream = async (error) => {
    const upstreamStatus = error?.upstreamStatus || error?.statusCode;
    if (upstreamStatus !== 403 && upstreamStatus !== 429) return error;
    const blocked = makeBlockedError(upstreamStatus);
    upstreamBlockedUntil = now() + Math.max(0, upstreamCooldownMs);
    upstreamBlockedError = blocked;
    limit.clearQueue(blocked);
    await cache.set('runtime-state', 'model-upstream-circuit', {
      blockedUntil: upstreamBlockedUntil,
      upstreamStatus,
    });
    return blocked;
  };

  const fetchCached = async (endpoint, { namespace = 'raw', maxAgeMs = ONE_DAY } = {}) => {
    const cached = await cache.get(namespace, endpoint, maxAgeMs);
    if (cached) return cached;
    await ensureCircuitLoaded();
    const circuitError = getCircuitError();
    if (circuitError) throw circuitError;
    if (inFlightFetches.has(endpoint)) return inFlightFetches.get(endpoint);
    const promise = limit(async () => {
      await waitForUpstreamSlot();
      const queuedCircuitError = getCircuitError();
      if (queuedCircuitError) throw queuedCircuitError;
      try {
        const data = await fetchSofaScore(endpoint);
        if (!data || typeof data !== 'object') throw new ShotModelError(`Risposta SofaScore non valida per ${endpoint}`);
        await cache.set(namespace, endpoint, data);
        return data;
      } catch (error) {
        throw await blockUpstream(error);
      }
    }).finally(() => inFlightFetches.delete(endpoint));
    inFlightFetches.set(endpoint, promise);
    return promise;
  };

  const fetchTotalShots = async (eventId) => {
    try {
      const payload = await fetchCached(`event/${eventId}/statistics`, {
        namespace: 'raw-statistics',
        maxAgeMs: Number.POSITIVE_INFINITY,
      });
      return extractTotalShots(payload);
    } catch (error) {
      if (error.upstreamStatus === 404) return null;
      throw error;
    }
  };

  const fetchAllSeasonEvents = async (tournamentId, seasonId, progress) => {
    const events = new Map();
    for (let page = 0; page < MAX_EVENT_PAGES; page += 1) {
      const endpoint = `unique-tournament/${tournamentId}/season/${seasonId}/events/last/${page}`;
      const payload = await fetchCached(endpoint, { namespace: 'metadata', maxAgeMs: SIX_HOURS });
      const pageEvents = Array.isArray(payload.events) ? payload.events : [];
      pageEvents.forEach((event) => events.set(event.id, event));
      if (progress) {
        progress.completed += 1;
        progress.total = Math.max(progress.total, progress.completed + (payload.hasNextPage ? 1 : 0));
      }
      if (!payload.hasNextPage || pageEvents.length === 0) break;
    }
    return [...events.values()];
  };

  const resolveSeasons = async (tournamentId, targetSeason) => {
    const payload = await fetchCached(`unique-tournament/${tournamentId}/seasons`, { namespace: 'metadata', maxAgeMs: ONE_DAY });
    const seasons = Array.isArray(payload.seasons) ? [...payload.seasons] : [];
    if (targetSeason && !seasons.some((season) => season.id === targetSeason.id)) seasons.push(targetSeason);
    seasons.sort((first, second) => seasonSortValue(second) - seasonSortValue(first));
    const resolvedTarget = seasons.find((season) => season.id === targetSeason?.id) || seasons[0];
    if (!resolvedTarget) return [];
    const targetYear = seasonYearValue(resolvedTarget);
    const previous = targetYear === null
      ? seasons[seasons.indexOf(resolvedTarget) + 1]
      : seasons.find((season) => season.id !== resolvedTarget.id && seasonYearValue(season) === targetYear - 1)
        || seasons.find((season) => season.id !== resolvedTarget.id && seasonYearValue(season) < targetYear);
    return [resolvedTarget, previous].filter(Boolean).slice(0, HISTORY_SEASON_COUNT);
  };

  const loadTeamVenueEvents = async ({ team, venue, tournamentId, seasons, cutoffTimestamp, targetEventId, progress }) => {
    const allowedSeasonIds = new Set(seasons.map((season) => season.id));
    const oldestAllowedYear = Math.min(...seasons.map(seasonYearValue).filter(Number.isFinite));
    const selected = new Map();

    for (let page = 0; page < MAX_TEAM_EVENT_PAGES; page += 1) {
      const payload = await fetchCached(`team/${team.id}/events/last/${page}`, {
        namespace: 'metadata',
        maxAgeMs: SIX_HOURS,
      });
      const pageEvents = Array.isArray(payload.events) ? payload.events : [];
      pageEvents.forEach((candidate) => {
        const candidateTournamentId = candidate.tournament?.uniqueTournament?.id;
        const isVenueMatch = venue === 'home'
          ? candidate.homeTeam?.id === team.id
          : candidate.awayTeam?.id === team.id;
        if (
          candidateTournamentId === tournamentId
          && allowedSeasonIds.has(candidate.season?.id)
          && candidate.id !== targetEventId
          && candidate.startTimestamp < cutoffTimestamp
          && isFinishedEvent(candidate)
          && isVenueMatch
        ) {
          selected.set(candidate.id, candidate);
        }
      });
      progress.completed += 1;
      progress.total = Math.max(progress.total, progress.completed + (payload.hasNextPage ? 1 : 0));
      if (!payload.hasNextPage || pageEvents.length === 0 || selected.size >= MAX_TEAM_VENUE_MATCHES) break;
      if (Number.isFinite(oldestAllowedYear) && pageEvents.every((candidate) => {
        const candidateYear = seasonYearValue(candidate.season);
        return candidateYear !== null && candidateYear < oldestAllowedYear;
      })) break;
    }

    return [...selected.values()]
      .sort((first, second) => second.startTimestamp - first.startTimestamp || second.id - first.id)
      .slice(0, MAX_TEAM_VENUE_MATCHES);
  };

  const loadMatchupDataset = async (event, progress) => {
    const tournamentId = event.tournament.uniqueTournament.id;
    const seasons = await resolveSeasons(tournamentId, event.season);
    progress.stage = 'team-events';
    progress.message = 'Raccolta mirata delle due squadre';
    progress.completed = 0;
    progress.total = 2;
    const homeEvents = await loadTeamVenueEvents({
      team: event.homeTeam,
      venue: 'home',
      tournamentId,
      seasons,
      cutoffTimestamp: event.startTimestamp,
      targetEventId: event.id,
      progress,
    });
    const awayEvents = await loadTeamVenueEvents({
      team: event.awayTeam,
      venue: 'away',
      tournamentId,
      seasons,
      cutoffTimestamp: event.startTimestamp,
      targetEventId: event.id,
      progress,
    });
    const cutoffEvents = [...new Map([...homeEvents, ...awayEvents].map((candidate) => [candidate.id, candidate])).values()]
      .sort((first, second) => first.startTimestamp - second.startTimestamp || first.id - second.id);

    progress.stage = 'statistics';
    progress.message = 'Lettura dei tiri delle due squadre';
    progress.completed = 0;
    progress.total = cutoffEvents.length;
    let excludedMissing = 0;
    const observations = [];
    for (const candidate of cutoffEvents) {
      try {
        const shots = await fetchTotalShots(candidate.id);
        if (!shots) {
          excludedMissing += 1;
          continue;
        }
        observations.push({
          eventId: candidate.id,
          startTimestamp: candidate.startTimestamp,
          competitionId: tournamentId,
          competitionName: candidate.tournament?.uniqueTournament?.name || candidate.tournament?.name || event.tournament.uniqueTournament.name,
          seasonId: candidate.season?.id,
          homeTeamId: candidate.homeTeam.id,
          homeTeamName: candidate.homeTeam.name,
          awayTeamId: candidate.awayTeam.id,
          awayTeamName: candidate.awayTeam.name,
          homeShots: shots.home,
          awayShots: shots.away,
        });
      } finally {
        progress.completed += 1;
      }
    }

    return {
      seasons,
      observations: annotatePointInTimeRatings(observations),
      excludedMissing,
      homeMatches: homeEvents.length,
      awayMatches: awayEvents.length,
    };
  };

  const loadSupplementarySeason = async (tournamentId, season, cutoffTimestamp, progress) => {
    const events = await fetchAllSeasonEvents(tournamentId, season.id, progress);
    const usable = events
      .filter(isFinishedEvent)
      .filter((candidate) => candidate.startTimestamp < cutoffTimestamp);
    const observations = [];
    await Promise.all(usable.map(async (candidate) => {
      const shots = await fetchTotalShots(candidate.id);
      if (!shots) return;
      observations.push({
        eventId: candidate.id,
        startTimestamp: candidate.startTimestamp,
        competitionId: tournamentId,
        competitionName: candidate.tournament?.uniqueTournament?.name || candidate.tournament?.name || 'Seconda divisione',
        seasonId: candidate.season?.id,
        homeTeamId: candidate.homeTeam.id,
        homeTeamName: candidate.homeTeam.name,
        awayTeamId: candidate.awayTeam.id,
        awayTeamName: candidate.awayTeam.name,
        homeShots: shots.home,
        awayShots: shots.away,
      });
    }));
    return observations;
  };

  const applyPromotionCorrections = async ({ event, competition, topObservations, topSeasons, model, progress }) => {
    const empty = {
      applied: false,
      uncertaintyShots: 0,
      teams: [],
      note: 'Nessuna correzione da neopromossa necessaria.',
    };
    const targetSeasonValue = seasonSortValue(event.season);
    const olderTopSeasonIds = new Set(topSeasons.slice(1).map((season) => season.id));
    const candidates = [event.homeTeam, event.awayTeam].filter((team) => {
      const olderAppearances = topObservations.filter((observation) => (
        olderTopSeasonIds.has(observation.seasonId)
        && (observation.homeTeamId === team.id || observation.awayTeamId === team.id)
      )).length;
      const rating = model.getRating(team.id);
      const currentEffectiveSample = Math.max(rating.homeAttack.nEff, rating.awayAttack.nEff);
      return olderAppearances === 0 && currentEffectiveSample < 15;
    });
    if (candidates.length === 0 || !competition.secondDivisionId) return empty;

    progress.stage = 'promotion';
    progress.message = 'Verifica del passaggio dalla seconda divisione';
    progress.completed = 0;
    progress.total = 1;
    const seasonPayload = await fetchCached(`unique-tournament/${competition.secondDivisionId}/seasons`, {
      namespace: 'metadata',
      maxAgeMs: ONE_DAY,
    });
    const lowerSeasons = (Array.isArray(seasonPayload.seasons) ? [...seasonPayload.seasons] : [])
      .sort((first, second) => seasonSortValue(second) - seasonSortValue(first));
    const lowerPrevious = lowerSeasons.find((season) => seasonSortValue(season) < targetSeasonValue);
    if (!lowerPrevious) {
      return { ...empty, note: 'Stagione precedente della seconda divisione non disponibile.' };
    }

    const previousData = await loadSupplementarySeason(
      competition.secondDivisionId,
      lowerPrevious,
      event.startTimestamp,
      progress,
    );
    progress.completed = 1;
    const promotedCandidates = candidates.filter((team) => previousData.some((observation) => (
      observation.homeTeamId === team.id || observation.awayTeamId === team.id
    )));
    if (promotedCandidates.length === 0) return empty;

    const transitionTeams = [];
    const transitionTopData = [];
    progress.completed = progress.total;

    const dimensions = ['homeAttack', 'homeVulnerability', 'awayAttack', 'awayVulnerability'];
    const ratios = Object.fromEntries(dimensions.map((dimension) => [dimension, []]));
    transitionTeams.forEach((teamId) => {
      const lower = calculateSeasonRatings(earlierData, teamId);
      const top = calculateSeasonRatings(transitionTopData, teamId);
      dimensions.forEach((dimension) => {
        if (lower[dimension] > 0 && Number.isFinite(top[dimension])) ratios[dimension].push(top[dimension] / lower[dimension]);
      });
    });
    const transitionFactors = Object.fromEntries(dimensions.map((dimension) => [dimension, median(ratios[dimension])]));
    const cohortSufficient = transitionTeams.length >= 3;

    let equivalentMatches = 5;
    if (transitionTeams.length >= 2) {
      const scores = PROMOTION_EQUIVALENT_MATCHES.map((candidateMatches) => {
        let error = 0;
        transitionTeams.forEach((teamId) => {
          const lower = calculateSeasonRatings(earlierData, teamId);
          const fullTop = calculateSeasonRatings(transitionTopData, teamId);
          const earlyEvents = transitionTopData
            .filter((observation) => observation.homeTeamId === teamId || observation.awayTeamId === teamId)
            .sort((first, second) => first.startTimestamp - second.startTimestamp)
            .slice(0, 5);
          const earlyTop = calculateSeasonRatings(earlyEvents, teamId);
          dimensions.forEach((dimension) => {
            const earlyMatches = dimension.startsWith('home') ? earlyTop.homeMatches : earlyTop.awayMatches;
            const transferred = lower[dimension] * transitionFactors[dimension];
            const blended = (earlyMatches * earlyTop[dimension] + candidateMatches * transferred)
              / Math.max(1, earlyMatches + candidateMatches);
            error += (blended - fullTop[dimension]) ** 2;
          });
        });
        return { candidateMatches, error };
      }).sort((first, second) => first.error - second.error);
      equivalentMatches = scores[0].candidateMatches;
    }

    let uncertaintyShots = 0;
    const teamDiagnostics = [];
    promotedCandidates.forEach((team) => {
      const lower = calculateSeasonRatings(previousData, team.id);
      const current = model.getRating(team.id);
      const transferred = {};
      dimensions.forEach((dimension) => {
        const empiricalTransferred = lower[dimension] * transitionFactors[dimension];
        const support = transitionTeams.length / (transitionTeams.length + 5);
        transferred[dimension] = cohortSufficient
          ? empiricalTransferred
          : 1 + (empiricalTransferred - 1) * support;
        const currentRating = current[dimension];
        const blended = (
          currentRating.nEff * currentRating.value
          + equivalentMatches * transferred[dimension]
        ) / Math.max(1e-9, currentRating.nEff + equivalentMatches);
        current[dimension] = {
          raw: currentRating.raw,
          value: blended,
          nEff: currentRating.nEff + equivalentMatches,
        };
      });

      const ratioSpread = dimensions.reduce((total, dimension) => total + standardDeviation(ratios[dimension]), 0) / dimensions.length;
      const insufficientDistance = dimensions.reduce((total, dimension) => total + Math.abs(lower[dimension] - 1), 0) / dimensions.length;
      uncertaintyShots += cohortSufficient
        ? ratioSpread * (model.baselineHome + model.baselineAway) / Math.sqrt(transitionTeams.length)
        : insufficientDistance * (model.baselineHome + model.baselineAway) / 2;
      teamDiagnostics.push({
        teamId: team.id,
        teamName: team.name,
        applied: true,
        sourceCompetitionId: competition.secondDivisionId,
        sourceSeason: { id: lowerPrevious.id, name: lowerPrevious.name, year: lowerPrevious.year },
        cohortSize: transitionTeams.length,
        cohortSufficient,
        equivalentMatches,
        lowerRatings: Object.fromEntries(dimensions.map((dimension) => [dimension, lower[dimension]])),
        transitionFactors,
        transferredRatings: transferred,
      });
    });

    return {
      applied: teamDiagnostics.length > 0,
      uncertaintyShots,
      teams: teamDiagnostics,
      note: cohortSufficient
        ? 'Trasferimento stimato su promozioni concluse prima del cutoff.'
        : 'Il limite alla stagione precedente non consente un campione storico di transizione: rating trasferiti verso 1 e intervallo ampliato.',
    };
  };

  const buildPrediction = async (eventId, progress) => {
    progress.stage = 'target';
    progress.message = 'Verifica della partita';
    progress.completed = 0;
    progress.total = 1;
    const targetEndpoint = `event/${eventId}`;
    const persistedTarget = await cache.get('metadata', targetEndpoint, Number.POSITIVE_INFINITY);
    const targetPayload = targetSnapshots.get(eventId)
      || persistedTarget
      || (shotDataArchive
        ? await fetchTargetEvent(targetEndpoint)
        : await fetchCached(targetEndpoint, { namespace: 'metadata', maxAgeMs: SIX_HOURS }));
    const event = targetPayload.event || targetPayload;
    if (!event?.id || !event?.homeTeam?.id || !event?.awayTeam?.id || !event?.startTimestamp) {
      throw new ShotModelError('La partita non contiene i metadati necessari.', 422, 'unsupported_or_insufficient_data');
    }
    if (!shotDataArchive && event.startTimestamp * 1000 <= now()) {
      throw new ShotModelError(
        'La V1 leggera calcola soltanto partite che non sono ancora iniziate.',
        422,
        'future_matches_only',
      );
    }
    const tournamentId = event.tournament?.uniqueTournament?.id;
    const competition = SUPPORTED_COMPETITIONS.get(tournamentId);
    if (!competition) {
      throw new ShotModelError('La competizione non è supportata dalla V1.', 422, 'unsupported_or_insufficient_data');
    }
    progress.completed = 1;

    const rawDataset = shotDataArchive
      ? await shotDataArchive.getPredictionDataset(event)
      : await loadMatchupDataset(event, progress);
    const {
      observations,
      excludedMissing,
      seasons,
      homeMatches,
      awayMatches,
      homeModelTeamId = event.homeTeam.id,
      awayModelTeamId = event.awayTeam.id,
      dataSource = 'SofaScore',
    } = rawDataset;
    const pointInTimeObservations = shotDataArchive
      ? annotatePointInTimeRatings(observations)
      : observations;
    if (
      pointInTimeObservations.length < (shotDataArchive ? 70 : MIN_TEAM_VENUE_MATCHES * 2)
      || homeMatches < MIN_TEAM_VENUE_MATCHES
      || awayMatches < MIN_TEAM_VENUE_MATCHES
    ) {
      throw new ShotModelError(
        `Storico insufficiente: ${homeMatches} gare interne della squadra di casa e ${awayMatches} gare esterne dell'ospite.`,
        422,
        'unsupported_or_insufficient_data',
      );
    }
    await cache.set('point-in-time', `${event.id}:${event.startTimestamp}`, {
      eventId: event.id,
      cutoffTimestamp: event.startTimestamp,
      excludedMissing,
      seasons: seasons.map((season) => ({ id: season.id, name: season.name, year: season.year })),
      observations: pointInTimeObservations,
    });

    progress.stage = 'parameters';
    progress.message = shotDataArchive
      ? 'Backtest cronologico e selezione dei parametri'
      : 'Applicazione dei parametri prudenti della V1 leggera';
    progress.completed = 1;
    progress.total = 1;
    const parameters = shotDataArchive ? selectModelParameters(pointInTimeObservations) : {
      halfLifeDays: 180,
      shrinkageMatches: 10,
      effect: 'none',
      distributionType: 'poisson',
      backtest: {
        sampleSize: 0,
        nll: null,
        mae: null,
        calibrationError: null,
        note: 'Backtest di campionato rinviato finché l’archivio locale dei top 5 non è completo.',
      },
      alternatives: [],
    };

    progress.stage = 'forecast';
    progress.message = 'Calcolo della distribuzione pre-partita';
    const model = fitLeagueModel(
      pointInTimeObservations,
      event.startTimestamp,
      parameters.halfLifeDays,
      parameters.shrinkageMatches,
      parameters.effect,
    );
    const promotion = {
      applied: false,
      uncertaintyShots: 0,
      teams: [],
      note: shotDataArchive
        ? 'L’archivio top-flight non contiene ancora le seconde divisioni: nessun moltiplicatore manuale applicato.'
        : 'Correzione neopromosse rinviata finché l’archivio locale dei top 5 non è completo.',
    };
    const modelTeamIds = { home: homeModelTeamId, away: awayModelTeamId };
    const forecast = model.predict(modelTeamIds.home, modelTeamIds.away);
    const minimumEffectiveSample = Math.min(
      model.getRating(modelTeamIds.home).homeAttack.nEff,
      model.getRating(modelTeamIds.away).awayAttack.nEff,
    );
    const warnings = shotDataArchive ? [
      'Dati tiri da archivio locale Football-Data: nessuna statistica partita-per-partita viene richiesta a SofaScore.',
      'La correzione neopromosse resta neutra finché non vengono importate anche le seconde divisioni.',
    ] : [
      'V1 leggera: usa soltanto gare interne della squadra di casa e gare esterne dell’ospite nelle ultime due stagioni.',
      'Le baseline casa/trasferta descrivono il campione mirato delle due squadre, non l’intero campionato.',
      'Effetto continuo di forza, correzione neopromosse e backtest globale sono sospesi fino al completamento dell’archivio locale.',
      'Distribuzione Poisson prudenziale non ancora calibrata sull’intero campionato.',
    ];
    if (shotDataArchive && tournamentId === 23) {
      warnings.push('Football-Data segnala per la Serie A una possibile discontinuità storica nella definizione dei tiri; la V1 limita il campione alle ultime due stagioni.');
    }
    if (minimumEffectiveSample < 3) {
      if (!promotion.applied) {
        promotion.uncertaintyShots = Math.sqrt(
          (forecast.home + forecast.away) / Math.max(1, minimumEffectiveSample + 1),
        );
        promotion.note = `${promotion.note} L’intervallo incorpora l’incertezza del campione ridotto.`;
      }
      warnings.push('Una squadra ha uno storico recente molto ridotto; la stima è fortemente ridotta verso la media e l’incertezza va interpretata con cautela.');
    }
    if (parameters.backtest.sampleSize === 0) warnings.push('Campione ancora insufficiente per completare il backtest cronologico.');
    if (excludedMissing > 0) warnings.push(`${excludedMissing} partite escluse perché prive di statistiche tiri complete.`);
    const distribution = parameters.distributionType === 'negative-binomial'
      ? { type: 'negative-binomial', dispersion: model.dispersion }
      : { type: 'poisson' };
    const markets = buildMarketLines(forecast.home + forecast.away, distribution);
    const response = serializePrediction({
      event,
      competition,
      parameters,
      model,
      modelTeamIds,
      forecast,
      distribution,
      markets,
      dataset: pointInTimeObservations,
      excludedMissing,
      seasons,
      warnings,
      promotion,
      dataSource,
    });
    const cacheKey = `${eventId}:${MODEL_VERSION}`;
    await cache.set('predictions', cacheKey, response);
    await cache.set('prediction-details', cacheKey, {
      rows: buildUsedMatchRows(pointInTimeObservations, event, modelTeamIds, parameters.halfLifeDays, model),
    });
    return response;
  };

  const getPrediction = async (eventId, force = false) => {
    const cacheKey = `${eventId}:${MODEL_VERSION}`;
    let staleFutureCache = false;
    if (!force) {
      const cached = await cache.get('predictions', cacheKey, Number.POSITIVE_INFINITY);
      if (cached) {
        const isPast = cached.prediction.cutoffTimestamp * 1000 <= now();
        const generatedAt = Date.parse(cached.prediction.generatedAt);
        if (isPast && !shotDataArchive) {
          throw new ShotModelError(
            'La V1 leggera calcola soltanto partite che non sono ancora iniziate.',
            422,
            'future_matches_only',
          );
        }
        if (isPast && shotDataArchive) return cached;
        if (Number.isFinite(generatedAt) && now() - generatedAt <= SIX_HOURS) return cached;
        staleFutureCache = true;
      }
    }

    if ((force || staleFutureCache) && jobs.get(cacheKey)?.state !== 'building') jobs.delete(cacheKey);
    const existing = jobs.get(cacheKey);
    if (existing) {
      if (existing.state === 'failed') {
        if (!force) throw existing.error;
        jobs.delete(cacheKey);
      } else if (existing.state === 'ready') {
        return existing.result;
      } else {
        return { status: 'building', progress: { ...existing.progress } };
      }
    }

    const job = {
      state: 'building',
      progress: { stage: 'queued', message: 'Calcolo in coda', completed: 0, total: 1 },
      result: null,
      error: null,
    };
    jobs.set(cacheKey, job);
    job.promise = buildPrediction(eventId, job.progress)
      .then((result) => {
        job.state = 'ready';
        job.result = result;
        return result;
      })
      .catch((error) => {
        job.state = 'failed';
        if (error instanceof ShotModelError) {
          job.error = error;
        } else {
          job.error = new ShotModelError(
            error.message || 'Errore nel modello',
            error.statusCode || 502,
            error.code || 'upstream_error',
          );
        }
      });
    return { status: 'building', progress: { ...job.progress } };
  };

  const getDetails = async (eventId, selection, source, page, pageSize) => {
    const cacheKey = `${eventId}:${MODEL_VERSION}`;
    const response = await cache.get('predictions', cacheKey, Number.POSITIVE_INFINITY);
    const details = await cache.get('prediction-details', cacheKey, Number.POSITIVE_INFINITY);
    if (!response || !details) {
      throw new ShotModelError('La previsione deve essere completata prima di aprire i dettagli.', 422, 'unsupported_or_insufficient_data');
    }
    const safeSource = source === 'away' ? 'away' : 'home';
    const safePage = Math.max(1, Number(page) || 1);
    const safePageSize = clamp(Number(pageSize) || 25, 1, 25);
    const rows = details.rows[safeSource] || [];
    const start = (safePage - 1) * safePageSize;
    return {
      status: 'ready',
      calculation: buildCalculationDetails(response.prediction, selection),
      matches: {
        source: safeSource,
        page: safePage,
        pageSize: safePageSize,
        total: rows.length,
        items: rows.slice(start, start + safePageSize),
      },
    };
  };

  const getAverageCatalog = async (teamId, teamName = '') => {
    if (shotDataArchive) return shotDataArchive.getAverageCatalog(teamId, teamName);
    const endpoint = `team/${teamId}/team-statistics/seasons`;
    const key = `season-parser-v2:${endpoint}`;
    const cached = await cache.get('average-catalog', key, ONE_DAY);
    if (cached) return cached;
    const jobKey = `catalog:${key}`;
    if (averageJobs.has(jobKey)) return averageJobs.get(jobKey);
    const job = (async () => {
      let payload;
      try {
        payload = await fetchCached(endpoint, { namespace: 'metadata', maxAgeMs: ONE_DAY });
      } catch (error) {
        if (error.upstreamStatus !== 404) throw error;
        const empty = { teamId: Number(teamId), competitions: [] };
        await cache.set('average-catalog', key, empty);
        return empty;
      }
      const groups = Array.isArray(payload.uniqueTournamentSeasons) ? payload.uniqueTournamentSeasons : [];
      const latestSeasonValue = groups.reduce((latest, group) => Math.max(
        latest,
        ...(Array.isArray(group.seasons) ? group.seasons : [])
          .map(seasonYearValue)
          .filter(Number.isFinite),
      ), 0);
      const oldestAllowedSeasonValue = latestSeasonValue - (HISTORY_SEASON_COUNT - 1);
      const competitions = groups
        .map((group) => ({
          id: group.uniqueTournament?.id,
          name: group.uniqueTournament?.name,
          categoryName: group.uniqueTournament?.category?.name || null,
          seasons: (Array.isArray(group.seasons) ? group.seasons : [])
            .map((season) => ({ id: season.id, name: season.name, year: season.year }))
            .filter((season) => {
              const yearValue = seasonYearValue(season);
              return latestSeasonValue === 0 || (yearValue !== null && yearValue >= oldestAllowedSeasonValue);
            })
            .sort((first, second) => seasonSortValue(second) - seasonSortValue(first)),
        }))
        .filter((competitionItem) => competitionItem.id && competitionItem.seasons.length > 0)
        .sort((first, second) => {
          const firstRecent = seasonSortValue(first.seasons[0]);
          const secondRecent = seasonSortValue(second.seasons[0]);
          return secondRecent - firstRecent || first.name.localeCompare(second.name, 'it');
        });
      const result = { teamId: Number(teamId), competitions };
      await cache.set('average-catalog', key, result);
      return result;
    })().finally(() => averageJobs.delete(jobKey));
    averageJobs.set(jobKey, job);
    return job;
  };

  const getShotAverages = async (teamId, competitionId, seasonId, venue, teamName = '') => {
    if (shotDataArchive) {
      return shotDataArchive.getShotAverages(teamId, teamName, competitionId, seasonId, venue);
    }
    const normalizedVenue = ['all', 'home', 'away'].includes(venue) ? venue : 'all';
    const key = `${teamId}:${competitionId}:${seasonId}:${normalizedVenue}`;
    const cached = await cache.get('averages', key, SIX_HOURS);
    if (cached) return cached;
    const jobKey = `averages:${key}`;
    if (averageJobs.has(jobKey)) return averageJobs.get(jobKey);
    const job = (async () => {
      let events;
      try {
        events = await fetchAllSeasonEvents(competitionId, seasonId);
      } catch (error) {
        if (error.upstreamStatus !== 404) throw error;
        events = [];
      }
      const teamEvents = events
        .filter(isFinishedEvent)
        .filter((event) => event.homeTeam?.id === Number(teamId) || event.awayTeam?.id === Number(teamId))
        .filter((event) => normalizedVenue === 'all'
          || (normalizedVenue === 'home' && event.homeTeam?.id === Number(teamId))
          || (normalizedVenue === 'away' && event.awayTeam?.id === Number(teamId)));
      let excludedMissing = 0;
      const samples = [];
      for (const event of teamEvents) {
        const shots = await fetchTotalShots(event.id);
        if (!shots) {
          excludedMissing += 1;
          continue;
        }
        const isHome = event.homeTeam.id === Number(teamId);
        const shotsFor = isHome ? shots.home : shots.away;
        const shotsAgainst = isHome ? shots.away : shots.home;
        samples.push({ shotsFor, shotsAgainst });
      }
      const matches = samples.length;
      const result = {
        status: 'ready',
        teamId: Number(teamId),
        competitionId: Number(competitionId),
        seasonId: Number(seasonId),
        venue: normalizedVenue,
        matches,
        excludedMissing,
        shotsFor: matches ? samples.reduce((total, sample) => total + sample.shotsFor, 0) / matches : null,
        shotsAgainst: matches ? samples.reduce((total, sample) => total + sample.shotsAgainst, 0) / matches : null,
        totalShots: matches ? samples.reduce((total, sample) => total + sample.shotsFor + sample.shotsAgainst, 0) / matches : null,
      };
      await cache.set('averages', key, result);
      return result;
    })().finally(() => averageJobs.delete(jobKey));
    averageJobs.set(jobKey, job);
    return job;
  };

  const getCircuitStatus = async () => {
    await ensureCircuitLoaded();
    const error = getCircuitError();
    return {
      blocked: Boolean(error),
      blockedUntil: error ? upstreamBlockedUntil : null,
      remainingMs: error ? Math.max(0, upstreamBlockedUntil - now()) : 0,
      upstreamStatus: error?.upstreamStatus || null,
      minIntervalMs: upstreamMinIntervalMs,
      maxInFlight: 1,
    };
  };

  const primeTarget = async (eventId, candidate) => {
    const event = candidate?.event || candidate;
    if (
      Number(event?.id) !== Number(eventId)
      || !Number.isFinite(Number(event?.startTimestamp))
      || !Number.isFinite(Number(event?.tournament?.uniqueTournament?.id))
      || !Number.isFinite(Number(event?.homeTeam?.id))
      || !Number.isFinite(Number(event?.awayTeam?.id))
      || !event?.homeTeam?.name
      || !event?.awayTeam?.name
    ) {
      throw new ShotModelError('Snapshot della partita incompleto.', 422, 'invalid_target_snapshot');
    }
    const snapshot = {
      event: {
        id: Number(event.id),
        startTimestamp: Number(event.startTimestamp),
        tournament: {
          uniqueTournament: {
            id: Number(event.tournament.uniqueTournament.id),
            name: String(event.tournament.uniqueTournament.name || ''),
          },
        },
        season: event.season ? {
          id: Number(event.season.id),
          name: String(event.season.name || event.season.year || ''),
          year: String(event.season.year || event.season.name || ''),
        } : null,
        homeTeam: { id: Number(event.homeTeam.id), name: String(event.homeTeam.name) },
        awayTeam: { id: Number(event.awayTeam.id), name: String(event.awayTeam.name) },
        status: event.status || null,
      },
    };
    targetSnapshots.set(Number(eventId), snapshot);
    await cache.set('metadata', `event/${eventId}`, snapshot);
    return snapshot;
  };

  return {
    getPrediction,
    getDetails,
    getAverageCatalog,
    getShotAverages,
    getCircuitStatus,
    primeTarget,
    jobs,
  };
}

function registerShotPredictionRoutes(app, service) {
  app.post('/api/predictions/shots/:eventId', async (req, res) => {
    try {
      await service.primeTarget(Number(req.params.eventId), req.body?.target);
      const result = await service.getPrediction(Number(req.params.eventId), req.query.retry === '1');
      return res.status(result.status === 'building' ? 202 : 200).json(result);
    } catch (error) {
      return res.status(error.statusCode || 502).json({
        status: 'error',
        code: error.code || 'upstream_error',
        message: error.message || 'Errore durante il calcolo della previsione.',
      });
    }
  });

  app.get('/api/predictions/shots/:eventId', async (req, res) => {
    try {
      const result = await service.getPrediction(Number(req.params.eventId), req.query.retry === '1');
      return res.status(result.status === 'building' ? 202 : 200).json(result);
    } catch (error) {
      const statusCode = error.statusCode || 502;
      return res.status(statusCode).json({
        status: 'error',
        code: error.code || 'upstream_error',
        message: error.message || 'Errore durante il calcolo della previsione.',
      });
    }
  });

  app.get('/api/predictions/shots/:eventId/details', async (req, res) => {
    try {
      const result = await service.getDetails(
        Number(req.params.eventId),
        String(req.query.selection || 'expected-total'),
        String(req.query.source || 'home'),
        Number(req.query.page || 1),
        Number(req.query.pageSize || 25),
      );
      return res.json(result);
    } catch (error) {
      return res.status(error.statusCode || 502).json({
        status: 'error',
        code: error.code || 'upstream_error',
        message: error.message || 'Errore durante il caricamento dei dettagli.',
      });
    }
  });

  app.get('/api/teams/:teamId/shot-averages/catalog', async (req, res) => {
    try {
      return res.json(await service.getAverageCatalog(
        Number(req.params.teamId),
        String(req.query.teamName || ''),
      ));
    } catch (error) {
      return res.status(error.statusCode || 502).json({ status: 'error', message: error.message });
    }
  });

  app.get('/api/teams/:teamId/shot-averages', async (req, res) => {
    const competitionId = Number(req.query.competitionId);
    const seasonId = Number(req.query.seasonId);
    if (!competitionId || !seasonId) {
      return res.status(422).json({ status: 'error', message: 'Competizione e stagione sono obbligatorie.' });
    }
    try {
      return res.json(await service.getShotAverages(
        Number(req.params.teamId),
        competitionId,
        seasonId,
        String(req.query.venue || 'all'),
        String(req.query.teamName || ''),
      ));
    } catch (error) {
      return res.status(error.statusCode || 502).json({ status: 'error', message: error.message });
    }
  });
}

module.exports = {
  MODEL_VERSION,
  SUPPORTED_COMPETITIONS,
  ShotModelError,
  extractTotalShots,
  temporalWeight,
  effectiveSampleSize,
  poissonCdf,
  negativeBinomialCdf,
  buildMarketLines,
  annotatePointInTimeRatings,
  fitLeagueModel,
  selectModelParameters,
  seasonYearValue,
  createShotPredictionService,
  registerShotPredictionRoutes,
};
