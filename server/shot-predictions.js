const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Worker } = require('worker_threads');
const { SHOT_COMPETITIONS } = require('./shot-competitions');
const { EQUIVALENT_MATCH_CANDIDATES, MIN_TEAM_VENUE_MATCHES } = require('./shot-transition-calibration');

const MODEL_VERSION = 'shots-v1.4.0-football-data-transitions';
const SUPPORTED_COMPETITIONS = new Map(
  SHOT_COMPETITIONS.map((competition) => [competition.competitionId, competition]),
);
const HALF_LIFE_CANDIDATES = [60, 90, 120, 180, 270, 365];
const SHRINKAGE_CANDIDATES = [5, 10, 20];
const TRANSITION_EQUIVALENT_MATCHES = EQUIVALENT_MATCH_CANDIDATES;
const SIX_HOURS = 6 * 60 * 60 * 1000;

class ShotModelError extends Error {
  constructor(message, statusCode = 500, code = 'model_error') {
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

function fitLeagueModel(
  observations,
  cutoffTimestamp,
  halfLifeDays,
  shrinkageMatches,
  effect = 'none',
  teamPriors = {},
) {
  const usable = observations.filter((observation) => observation.startTimestamp < cutoffTimestamp);
  const cutoffDays = cutoffTimestamp / 86400;
  const weights = usable.map((observation) => temporalWeight(cutoffDays - observation.startTimestamp / 86400, halfLifeDays));
  const baselineHome = weightedMean(usable.map((observation) => observation.homeShots), weights, 13);
  const baselineAway = weightedMean(usable.map((observation) => observation.awayShots), weights, 11);
  const ratings = new Map();
  const getTeamPrior = (teamId, component) => {
    const teamPrior = teamPriors instanceof Map ? teamPriors.get(teamId) : teamPriors[teamId];
    return teamPrior?.[component] || null;
  };

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
    const nEff = effectiveSampleSize(selectedWeights);
    const component = `${venue}${kind === 'attack' ? 'Attack' : 'Vulnerability'}`;
    const transitionPrior = getTeamPrior(teamId, component);
    const transitionWeight = Math.max(0, Number(transitionPrior?.weight || 0));
    const transitionValue = Number.isFinite(Number(transitionPrior?.value))
      ? Number(transitionPrior.value)
      : 1;
    const denominator = nEff + shrinkageMatches + transitionWeight;
    return {
      raw,
      value: denominator > 0
        ? (nEff * raw + shrinkageMatches + transitionWeight * transitionValue) / denominator
        : 1,
      nEff,
      transitionPrior: transitionWeight > 0
        ? { value: transitionValue, weight: transitionWeight }
        : null,
    };
  };

  const teamIds = new Set();
  usable.forEach((observation) => {
    teamIds.add(observation.homeTeamId);
    teamIds.add(observation.awayTeamId);
  });
  if (teamPriors instanceof Map) {
    teamPriors.forEach((_value, teamId) => teamIds.add(teamId));
  } else {
    Object.keys(teamPriors).forEach((teamId) => teamIds.add(teamId));
  }
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

function formatEventLabel(observation) {
  return `${observation.homeTeamName} - ${observation.awayTeamName}`;
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
  competitionTransition,
  dataSource,
}) {
  const homeRating = model.getRating(modelTeamIds.home);
  const awayRating = model.getRating(modelTeamIds.away);
  const cutoffTimestamp = event.startTimestamp;
  const uncertaintyExpansion = Math.ceil(competitionTransition.uncertaintyShots || 0);
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
        transitionEquivalentMatchesCandidates: TRANSITION_EQUIVALENT_MATCHES,
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
        competitionTransition,
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
      competitionTransitionCorrection: diagnostics.competitionTransition,
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

function selectModelParametersOffThread(observations) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'shot-model-worker.js'));
    const finish = () => worker.terminate().catch(() => {});
    worker.once('message', (message) => {
      finish();
      if (message?.ok) {
        resolve(message.result);
        return;
      }
      reject(new ShotModelError(
        message?.error?.message || 'Errore durante il backtest del modello.',
        message?.error?.statusCode || 500,
        message?.error?.code || 'model_worker_error',
      ));
    });
    worker.once('error', (error) => {
      finish();
      reject(new ShotModelError(error.message, 500, 'model_worker_error'));
    });
    worker.postMessage({ observations });
  });
}

function createShotPredictionService({
  shotDataArchive = null,
  cacheDir = path.join(__dirname, '.shot-model-cache'),
  now = () => Date.now(),
  selectParameters = selectModelParametersOffThread,
}) {
  if (!shotDataArchive) {
    throw new ShotModelError(
      'L’archivio Football-Data è obbligatorio per le previsioni.',
      503,
      'shot_archive_unavailable',
    );
  }
  const cache = new DiskJsonCache(cacheDir);
  const jobs = new Map();
  const targetSnapshots = new Map();

  const buildPrediction = async (eventId, progress) => {
    progress.stage = 'target';
    progress.message = 'Verifica della partita';
    progress.completed = 0;
    progress.total = 1;
    const targetEndpoint = `event/${eventId}`;
    const persistedTarget = await cache.get('metadata', targetEndpoint, Number.POSITIVE_INFINITY);
    const targetPayload = targetSnapshots.get(eventId) || persistedTarget;
    if (!targetPayload) {
      throw new ShotModelError(
        'La previsione deve essere avviata con lo snapshot della partita già aperta.',
        422,
        'invalid_target_snapshot',
      );
    }
    const event = targetPayload.event || targetPayload;
    if (
      !event?.id
      || !event?.homeTeam?.id
      || !event?.awayTeam?.id
      || !event?.startTimestamp
      || !event?.season?.id
      || !(event.season.year || event.season.name)
    ) {
      throw new ShotModelError('La partita non contiene i metadati necessari.', 422, 'invalid_target_snapshot');
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
      throw new ShotModelError('La competizione non è supportata dal modello tiri.', 422, 'unsupported_competition');
    }
    progress.completed = 1;

    const rawDataset = await shotDataArchive.getPredictionDataset(event);
    const {
      observations,
      excludedMissing,
      seasons,
      homeMatches,
      awayMatches,
      homeModelTeamId = event.homeTeam.id,
      awayModelTeamId = event.awayTeam.id,
      transitions = { home: null, away: null },
      dataSource = 'football-data.co.uk',
    } = rawDataset;
    const pointInTimeObservations = annotatePointInTimeRatings(observations);
    if (pointInTimeObservations.length < 70) {
      throw new ShotModelError(
        `Storico del campionato insufficiente: ${pointInTimeObservations.length} partite disponibili.`,
        422,
        'insufficient_competition_history',
      );
    }
    const homeTransitionReady = Boolean(transitions.home?.applied);
    const awayTransitionReady = Boolean(transitions.away?.applied);
    const missingTeamHistory = [];
    if (homeMatches < MIN_TEAM_VENUE_MATCHES && !homeTransitionReady) {
      missingTeamHistory.push(`${event.homeTeam.name}: ${homeMatches} gare interne nel campionato di destinazione`);
    }
    if (awayMatches < MIN_TEAM_VENUE_MATCHES && !awayTransitionReady) {
      missingTeamHistory.push(`${event.awayTeam.name}: ${awayMatches} gare esterne nel campionato di destinazione`);
    }
    if (missingTeamHistory.length > 0) {
      const unavailableCalibration = (
        (homeMatches < MIN_TEAM_VENUE_MATCHES && transitions.home && !transitions.home.applied)
        || (awayMatches < MIN_TEAM_VENUE_MATCHES && transitions.away && !transitions.away.applied)
      );
      throw new ShotModelError(
        `Storico reale insufficiente. ${missingTeamHistory.join('; ')}.`,
        422,
        unavailableCalibration ? 'transition_calibration_unavailable' : 'insufficient_team_history',
      );
    }
    const appliedTransitions = [transitions.home, transitions.away].filter((transition) => transition?.applied);
    const teamPriors = {};
    appliedTransitions.forEach((transition) => {
      teamPriors[transition.teamId] = Object.fromEntries(
        Object.entries(transition.transferredRatings).map(([component, value]) => [component, {
          value,
          weight: transition.equivalentMatches,
        }]),
      );
    });
    await cache.set('point-in-time', `${event.id}:${event.startTimestamp}`, {
      eventId: event.id,
      cutoffTimestamp: event.startTimestamp,
      excludedMissing,
      seasons: seasons.map((season) => ({ id: season.id, name: season.name, year: season.year })),
      observations: pointInTimeObservations,
      transitions,
    });

    progress.stage = 'parameters';
    progress.message = shotDataArchive
      ? 'Backtest cronologico e selezione dei parametri'
      : 'Applicazione dei parametri prudenti della V1 leggera';
    progress.completed = 1;
    progress.total = 1;
    const parameters = await selectParameters(pointInTimeObservations);

    progress.stage = 'forecast';
    progress.message = 'Calcolo della distribuzione pre-partita';
    const model = fitLeagueModel(
      pointInTimeObservations,
      event.startTimestamp,
      parameters.halfLifeDays,
      parameters.shrinkageMatches,
      parameters.effect,
      teamPriors,
    );
    const modelTeamIds = { home: homeModelTeamId, away: awayModelTeamId };
    const forecast = model.predict(modelTeamIds.home, modelTeamIds.away);
    const relativeTransitionError = appliedTransitions.length > 0
      ? appliedTransitions.reduce((total, transition) => total + transition.relativeStandardError, 0)
        / appliedTransitions.length
      : 0;
    const competitionTransition = {
      applied: appliedTransitions.length > 0,
      direction: appliedTransitions[0]?.direction || 'none',
      uncertaintyShots: appliedTransitions.length > 0
        ? (forecast.home + forecast.away) * relativeTransitionError
        : 0,
      teams: appliedTransitions,
      note: appliedTransitions.length > 0
        ? `Rating trasferito da ${appliedTransitions.map((transition) => transition.sourceCompetition.name).join(', ')} con fattori Football-Data calibrati.`
        : 'Nessun passaggio tra le due divisioni rilevato per le squadre della partita.',
    };
    const minimumEffectiveSample = Math.min(
      model.getRating(modelTeamIds.home).homeAttack.nEff,
      model.getRating(modelTeamIds.away).awayAttack.nEff,
    );
    const warnings = [
      'Dati tiri da archivio locale Football-Data: nessuna statistica partita-per-partita viene richiesta a SofaScore.',
    ];
    appliedTransitions.forEach((transition) => {
      const directionLabel = transition.direction === 'promotion' ? 'promozione' : 'retrocessione';
      warnings.push(
        `${transition.teamName}: ${directionLabel} ${transition.sourceCompetition.name} → ${transition.targetCompetition.name}, `
        + `calibrazione su ${transition.cohortSize} passaggi in ${transition.cohortSeasons} stagioni.`,
      );
    });
    if (tournamentId === 23) {
      warnings.push('Football-Data segnala per la Serie A una possibile discontinuità storica nella definizione dei tiri; la V1 limita il campione alle ultime due stagioni.');
    }
    if (minimumEffectiveSample < 3) {
      if (!competitionTransition.applied) {
        competitionTransition.uncertaintyShots = Math.sqrt(
          (forecast.home + forecast.away) / Math.max(1, minimumEffectiveSample + 1),
        );
        competitionTransition.note = `${competitionTransition.note} L’intervallo incorpora l’incertezza del campione ridotto.`;
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
      competitionTransition,
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
            error.code || 'model_error',
          );
        }
      });
    return { status: 'building', progress: { ...job.progress } };
  };

  const canPoll = async (eventId) => {
    const numericEventId = Number(eventId);
    const cacheKey = `${numericEventId}:${MODEL_VERSION}`;
    if (targetSnapshots.has(numericEventId) || jobs.has(cacheKey)) return true;
    if (await cache.get('metadata', `event/${numericEventId}`, Number.POSITIVE_INFINITY)) return true;
    return Boolean(await cache.get('predictions', cacheKey, Number.POSITIVE_INFINITY));
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

  const getAverageCatalog = (teamId, teamName = '') => (
    shotDataArchive.getAverageCatalog(teamId, teamName)
  );

  const getShotAverages = (teamId, competitionId, seasonId, venue, teamName = '') => (
    shotDataArchive.getShotAverages(teamId, teamName, competitionId, seasonId, venue)
  );

  const primeTarget = async (eventId, candidate) => {
    const event = candidate?.event || candidate;
    if (
      Number(event?.id) !== Number(eventId)
      || !Number.isFinite(Number(event?.startTimestamp))
      || !Number.isFinite(Number(event?.tournament?.uniqueTournament?.id))
      || !event?.tournament?.uniqueTournament?.name
      || !Number.isFinite(Number(event?.season?.id))
      || !(event?.season?.year || event?.season?.name)
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
    canPoll,
    getDetails,
    getAverageCatalog,
    getShotAverages,
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
        code: error.code || 'model_error',
        message: error.message || 'Errore durante il calcolo della previsione.',
      });
    }
  });

  app.get('/api/predictions/shots/:eventId', async (req, res) => {
    try {
      if (!await service.canPoll(Number(req.params.eventId))) {
        throw new ShotModelError(
          'La previsione deve essere avviata dalla partita aperta.',
          422,
          'invalid_target_snapshot',
        );
      }
      const result = await service.getPrediction(Number(req.params.eventId), req.query.retry === '1');
      return res.status(result.status === 'building' ? 202 : 200).json(result);
    } catch (error) {
      const statusCode = error.statusCode || 502;
      return res.status(statusCode).json({
        status: 'error',
        code: error.code || 'model_error',
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
        code: error.code || 'model_error',
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
  temporalWeight,
  effectiveSampleSize,
  poissonCdf,
  negativeBinomialCdf,
  buildMarketLines,
  annotatePointInTimeRatings,
  fitLeagueModel,
  selectModelParameters,
  selectModelParametersOffThread,
  seasonYearValue,
  createShotPredictionService,
  registerShotPredictionRoutes,
};
