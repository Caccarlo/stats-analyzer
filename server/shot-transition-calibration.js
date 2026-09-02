const RATING_COMPONENTS = ['homeAttack', 'homeVulnerability', 'awayAttack', 'awayVulnerability'];
const EQUIVALENT_MATCH_CANDIDATES = [5, 10, 20];
const MIN_TEAM_VENUE_MATCHES = 8;
const MIN_COHORT_TRANSITIONS = 8;
const MIN_COHORT_SEASONS = 3;
const VALIDATION_SHRINKAGE_MATCHES = 10;

function mean(values, fallback = 1) {
  return values.length > 0
    ? values.reduce((total, value) => total + value, 0) / values.length
    : fallback;
}

function quantile(sortedValues, probability) {
  if (sortedValues.length === 0) return 0;
  const position = (sortedValues.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sortedValues[lower];
  return sortedValues[lower] + (sortedValues[upper] - sortedValues[lower]) * (position - lower);
}

function harmonicMean(first, second) {
  return first > 0 && second > 0 ? 2 / (1 / first + 1 / second) : 0;
}

function logFactorStats(samples, component) {
  const entries = samples.map((sample) => ({
    value: Math.log(Math.max(0.05, sample.targetRatings[component]) / Math.max(0.05, sample.sourceRatings[component])),
    weight: harmonicMean(sample.sourceMatches[component.startsWith('home') ? 'home' : 'away'], sample.targetMatches[component.startsWith('home') ? 'home' : 'away']),
  }));
  const ordered = entries.map((entry) => entry.value).sort((first, second) => first - second);
  const lower = quantile(ordered, 0.1);
  const upper = quantile(ordered, 0.9);
  const bounded = entries.map((entry) => ({ ...entry, value: Math.min(upper, Math.max(lower, entry.value)) }));
  const weightSum = bounded.reduce((total, entry) => total + entry.weight, 0);
  const location = weightSum > 0
    ? bounded.reduce((total, entry) => total + entry.value * entry.weight, 0) / weightSum
    : mean(bounded.map((entry) => entry.value), 0);
  const varianceDenominator = Math.max(1, weightSum - (bounded.reduce((total, entry) => total + entry.weight ** 2, 0) / Math.max(weightSum, 1)));
  const variance = bounded.reduce((total, entry) => total + entry.weight * (entry.value - location) ** 2, 0) / varianceDenominator;
  const effectiveCount = weightSum > 0
    ? weightSum ** 2 / Math.max(1e-9, bounded.reduce((total, entry) => total + entry.weight ** 2, 0))
    : bounded.length;
  const standardError = Math.sqrt(Math.max(0, variance) / Math.max(1, effectiveCount));
  const intervalScale = 1.2815515655446004;
  return {
    factor: Math.exp(location),
    logFactor: location,
    standardError,
    interval80: [
      Math.exp(location - intervalScale * standardError),
      Math.exp(location + intervalScale * standardError),
    ],
  };
}

function computeSeasonRatings(rows) {
  const baselineHome = mean(rows.map((row) => Number(row.home_shots)), 13);
  const baselineAway = mean(rows.map((row) => Number(row.away_shots)), 11);
  const teams = new Map();
  const getTeam = (key, name) => {
    if (!teams.has(key)) {
      teams.set(key, {
        key,
        name,
        homeMatches: 0,
        awayMatches: 0,
        homeFor: 0,
        homeAgainst: 0,
        awayFor: 0,
        awayAgainst: 0,
      });
    }
    return teams.get(key);
  };

  rows.forEach((row) => {
    const home = getTeam(row.home_team_key, row.home_team);
    const away = getTeam(row.away_team_key, row.away_team);
    home.homeMatches += 1;
    home.homeFor += Number(row.home_shots);
    home.homeAgainst += Number(row.away_shots);
    away.awayMatches += 1;
    away.awayFor += Number(row.away_shots);
    away.awayAgainst += Number(row.home_shots);
  });

  const ratings = new Map();
  teams.forEach((team, key) => {
    ratings.set(key, {
      key,
      name: team.name,
      matches: { home: team.homeMatches, away: team.awayMatches },
      ratings: {
        homeAttack: team.homeMatches ? (team.homeFor / team.homeMatches) / baselineHome : 1,
        homeVulnerability: team.homeMatches ? (team.homeAgainst / team.homeMatches) / baselineAway : 1,
        awayAttack: team.awayMatches ? (team.awayFor / team.awayMatches) / baselineAway : 1,
        awayVulnerability: team.awayMatches ? (team.awayAgainst / team.awayMatches) / baselineHome : 1,
      },
    });
  });
  return { baselineHome, baselineAway, teams: ratings };
}

function buildSeasonTransitionSamples(sourceRows, targetRows, targetSeasonStartYear) {
  const source = computeSeasonRatings(sourceRows);
  const target = computeSeasonRatings(targetRows);
  const samples = [];
  source.teams.forEach((sourceTeam, teamKey) => {
    const targetTeam = target.teams.get(teamKey);
    if (!targetTeam) return;
    if (
      sourceTeam.matches.home < MIN_TEAM_VENUE_MATCHES
      || sourceTeam.matches.away < MIN_TEAM_VENUE_MATCHES
      || targetTeam.matches.home < MIN_TEAM_VENUE_MATCHES
      || targetTeam.matches.away < MIN_TEAM_VENUE_MATCHES
    ) return;
    samples.push({
      teamKey,
      teamName: targetTeam.name,
      targetSeasonStartYear,
      sourceRatings: sourceTeam.ratings,
      targetRatings: targetTeam.ratings,
      sourceMatches: sourceTeam.matches,
      targetMatches: targetTeam.matches,
    });
  });
  return { source, target, samples };
}

function poissonNegativeLogLikelihood(value, expected) {
  const meanValue = Math.max(1e-9, expected);
  let logFactorial = 0;
  for (let index = 2; index <= value; index += 1) logFactorial += Math.log(index);
  return meanValue - value * Math.log(meanValue) + logFactorial;
}

function aggregateFactors(samples) {
  return Object.fromEntries(RATING_COMPONENTS.map((component) => [component, logFactorStats(samples, component)]));
}

function evaluateTransitionCandidate({
  folds,
  equivalentMatches,
  calibrated,
}) {
  let nll = 0;
  let absoluteError = 0;
  let sampleSize = 0;
  const evaluatedTeams = new Set();

  folds.forEach((fold) => {
    const factors = calibrated ? aggregateFactors(fold.trainingSamples) : Object.fromEntries(
      RATING_COMPONENTS.map((component) => [component, { factor: 1 }]),
    );
    fold.testSamples.forEach((sample) => {
      const current = Object.fromEntries(RATING_COMPONENTS.map((component) => [component, { sum: 0, count: 0 }]));
      const prior = Object.fromEntries(RATING_COMPONENTS.map((component) => [
        component,
        sample.sourceRatings[component] * factors[component].factor,
      ]));
      const rows = fold.targetRows
        .filter((row) => row.home_team_key === sample.teamKey || row.away_team_key === sample.teamKey)
        .sort((first, second) => Number(first.start_timestamp) - Number(second.start_timestamp));
      rows.forEach((row) => {
        const isHome = row.home_team_key === sample.teamKey;
        const components = isHome
          ? [
            ['homeAttack', Number(row.home_shots), fold.baselineHome],
            ['homeVulnerability', Number(row.away_shots), fold.baselineAway],
          ]
          : [
            ['awayAttack', Number(row.away_shots), fold.baselineAway],
            ['awayVulnerability', Number(row.home_shots), fold.baselineHome],
          ];
        components.forEach(([component, observed, baseline]) => {
          const state = current[component];
          const currentMean = state.count > 0 ? state.sum / state.count : prior[component];
          const blended = (
            equivalentMatches * prior[component]
            + state.count * currentMean
            + VALIDATION_SHRINKAGE_MATCHES
          ) / (equivalentMatches + state.count + VALIDATION_SHRINKAGE_MATCHES);
          const expected = Math.max(1, baseline * blended);
          nll += poissonNegativeLogLikelihood(observed, expected);
          absoluteError += Math.abs(observed - expected);
          sampleSize += 1;
          state.sum += observed / baseline;
          state.count += 1;
        });
      });
      if (rows.length > 0) evaluatedTeams.add(`${sample.targetSeasonStartYear}:${sample.teamKey}`);
    });
  });

  return {
    equivalentMatches,
    calibrated,
    sampleSize,
    evaluatedTeams: evaluatedTeams.size,
    nll: sampleSize > 0 ? nll / sampleSize : null,
    mae: sampleSize > 0 ? absoluteError / sampleSize : null,
  };
}

function buildTransitionCalibration({
  targetCompetition,
  sourceCompetition,
  targetSeasonStartYear,
  getRows,
}) {
  const targetYears = Array.from({ length: 5 }, (_, index) => targetSeasonStartYear - 5 + index);
  const seasons = targetYears.map((year) => {
    const sourceRows = getRows(sourceCompetition.competitionId, year - 1);
    const targetRows = getRows(targetCompetition.competitionId, year);
    return {
      year,
      targetRows,
      ...buildSeasonTransitionSamples(sourceRows, targetRows, year),
    };
  });
  const samples = seasons.flatMap((season) => season.samples);
  const cohortSeasons = new Set(samples.map((sample) => sample.targetSeasonStartYear));
  const observedFactors = samples.length > 0 ? aggregateFactors(samples) : Object.fromEntries(
    RATING_COMPONENTS.map((component) => [component, {
      factor: 1,
      logFactor: 0,
      standardError: null,
      interval80: [1, 1],
    }]),
  );
  const folds = seasons.slice(2).map((season, index) => {
    const trainingSamples = seasons.slice(0, index + 2).flatMap((entry) => entry.samples);
    const previousTargetRows = getRows(targetCompetition.competitionId, season.year - 1);
    const previousTarget = computeSeasonRatings(previousTargetRows);
    return {
      trainingSamples,
      testSamples: season.samples,
      targetRows: season.targetRows,
      baselineHome: previousTarget.baselineHome,
      baselineAway: previousTarget.baselineAway,
    };
  }).filter((fold) => fold.trainingSamples.length >= 4 && fold.testSamples.length > 0);

  const calibratedCandidates = EQUIVALENT_MATCH_CANDIDATES.map((equivalentMatches) => (
    evaluateTransitionCandidate({ folds, equivalentMatches, calibrated: true })
  ));
  const neutralCandidates = EQUIVALENT_MATCH_CANDIDATES.map((equivalentMatches) => (
    evaluateTransitionCandidate({ folds, equivalentMatches, calibrated: false })
  ));
  const sortMetrics = (first, second) => (
    (first.nll ?? Number.POSITIVE_INFINITY) - (second.nll ?? Number.POSITIVE_INFINITY)
    || (first.mae ?? Number.POSITIVE_INFINITY) - (second.mae ?? Number.POSITIVE_INFINITY)
    || first.equivalentMatches - second.equivalentMatches
  );
  const bestCalibrated = [...calibratedCandidates].sort(sortMetrics)[0];
  const bestNeutral = [...neutralCandidates].sort(sortMetrics)[0];
  const effectRetained = Boolean(
    bestCalibrated?.nll !== null
    && bestNeutral?.nll !== null
    && bestCalibrated.nll <= bestNeutral.nll * 0.995
    && bestCalibrated.mae <= bestNeutral.mae * 1.02
  );
  const selected = effectRetained ? bestCalibrated : bestNeutral;
  const available = samples.length >= MIN_COHORT_TRANSITIONS
    && cohortSeasons.size >= MIN_COHORT_SEASONS
    && (selected?.evaluatedTeams || 0) >= 6;
  const factors = Object.fromEntries(RATING_COMPONENTS.map((component) => [
    component,
    effectRetained ? observedFactors[component].factor : 1,
  ]));

  return {
    available,
    direction: targetCompetition.tier < sourceCompetition.tier ? 'promotion' : 'relegation',
    sourceCompetition: {
      id: sourceCompetition.competitionId,
      name: sourceCompetition.name,
      tier: sourceCompetition.tier,
    },
    targetCompetition: {
      id: targetCompetition.competitionId,
      name: targetCompetition.name,
      tier: targetCompetition.tier,
    },
    targetSeasonStartYear,
    calibrationSeasons: targetYears,
    cohortSize: samples.length,
    cohortSeasons: cohortSeasons.size,
    equivalentMatches: selected?.equivalentMatches || EQUIVALENT_MATCH_CANDIDATES[0],
    effectRetained,
    factors,
    observedFactors,
    validation: {
      selected: selected || null,
      calibrated: bestCalibrated || null,
      neutral: bestNeutral || null,
    },
  };
}

module.exports = {
  RATING_COMPONENTS,
  EQUIVALENT_MATCH_CANDIDATES,
  MIN_TEAM_VENUE_MATCHES,
  MIN_COHORT_TRANSITIONS,
  MIN_COHORT_SEASONS,
  computeSeasonRatings,
  buildSeasonTransitionSamples,
  aggregateFactors,
  buildTransitionCalibration,
};
