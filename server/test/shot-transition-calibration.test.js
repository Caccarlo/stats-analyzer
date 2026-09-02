const test = require('node:test');
const assert = require('node:assert/strict');

const { SHOT_COMPETITION_BY_ID } = require('../shot-competitions');
const {
  computeSeasonRatings,
  buildTransitionCalibration,
} = require('../shot-transition-calibration');

function makeLeagueRows({
  competitionId,
  seasonStartYear,
  moverPrefix,
  moverAttack,
  stableAttack,
}) {
  const teams = [
    ...Array.from({ length: 10 }, (_, index) => ({ key: `${moverPrefix}-${index}`, attack: moverAttack })),
    ...Array.from({ length: 10 }, (_, index) => ({ key: `stable-${competitionId}-${seasonStartYear}-${index}`, attack: stableAttack })),
  ];
  const rows = [];
  teams.forEach((home, homeIndex) => {
    teams.forEach((away, awayIndex) => {
      if (homeIndex === awayIndex) return;
      rows.push({
        source_key: `${competitionId}:${seasonStartYear}:${home.key}:${away.key}`,
        competition_id: competitionId,
        season_start_year: seasonStartYear,
        start_timestamp: Date.UTC(seasonStartYear, 7, 1 + rows.length) / 1000,
        home_team_key: home.key,
        home_team: home.key,
        away_team_key: away.key,
        away_team: away.key,
        home_shots: Math.max(1, Math.round(13 * home.attack)),
        away_shots: Math.max(1, Math.round(11 * away.attack)),
      });
    });
  });
  return rows;
}

test('i rating stagionali distinguono attacco casa e trasferta rispetto alla lega', () => {
  const rows = makeLeagueRows({
    competitionId: 18,
    seasonStartYear: 2025,
    moverPrefix: 'mover',
    moverAttack: 1.25,
    stableAttack: 0.8,
  });
  const season = computeSeasonRatings(rows);
  const mover = season.teams.get('mover-0');
  assert.ok(mover.ratings.homeAttack > 1);
  assert.ok(mover.ratings.awayAttack > 1);
  assert.equal(mover.matches.home, 19);
  assert.equal(mover.matches.away, 19);
});

test('la calibrazione apprende separatamente promozione e retrocessione su cinque passaggi stagionali', () => {
  const rows = new Map();
  for (let targetYear = 2021; targetYear <= 2025; targetYear += 1) {
    rows.set(`18:${targetYear - 1}`, makeLeagueRows({
      competitionId: 18,
      seasonStartYear: targetYear - 1,
      moverPrefix: `club-${targetYear}`,
      moverAttack: 1.25,
      stableAttack: 0.8,
    }));
    rows.set(`17:${targetYear}`, makeLeagueRows({
      competitionId: 17,
      seasonStartYear: targetYear,
      moverPrefix: `club-${targetYear}`,
      moverAttack: 0.85,
      stableAttack: 1.1,
    }));
    rows.set(`17:${targetYear - 1}`, rows.get(`17:${targetYear - 1}`) || makeLeagueRows({
      competitionId: 17,
      seasonStartYear: targetYear - 1,
      moverPrefix: `prior-top-${targetYear}`,
      moverAttack: 1,
      stableAttack: 1,
    }));
  }
  const getRows = (competitionId, seasonStartYear) => rows.get(`${competitionId}:${seasonStartYear}`) || [];
  const promotion = buildTransitionCalibration({
    targetCompetition: SHOT_COMPETITION_BY_ID.get(17),
    sourceCompetition: SHOT_COMPETITION_BY_ID.get(18),
    targetSeasonStartYear: 2026,
    getRows,
  });
  assert.equal(promotion.direction, 'promotion');
  assert.equal(promotion.cohortSize, 50);
  assert.equal(promotion.cohortSeasons, 5);
  assert.equal(promotion.available, true);
  assert.ok(promotion.observedFactors.homeAttack.factor < 1);
  assert.ok([5, 10, 20].includes(promotion.equivalentMatches));

  const relegation = buildTransitionCalibration({
    targetCompetition: SHOT_COMPETITION_BY_ID.get(18),
    sourceCompetition: SHOT_COMPETITION_BY_ID.get(17),
    targetSeasonStartYear: 2026,
    getRows: (competitionId, seasonStartYear) => {
      if (competitionId === 17) return rows.get(`17:${seasonStartYear}`) || [];
      return rows.get(`18:${seasonStartYear}`) || [];
    },
  });
  assert.equal(relegation.direction, 'relegation');
});
