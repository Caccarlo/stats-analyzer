const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  BULK_COMPETITIONS,
  normalizeTeamName,
  canonicalTeamKey,
  parseCsv,
  parseFootballDataCsv,
  createShotDataArchive,
} = require('../shot-data-archive');

function fixtureCsv(startYear, division = 'I1') {
  const shortYear = String(startYear).slice(-2);
  const nextShortYear = String(startYear + 1).slice(-2);
  return [
    'Div,Date,Time,HomeTeam,AwayTeam,FTHG,FTAG,FTR,HS,AS,HST,AST,HR,AR',
    `${division},20/08/${shortYear},20:45,Cagliari,Inter,1,2,A,10,17,3,7,0,0`,
    `${division},27/08/${shortYear},18:30,Inter,Cagliari,2,0,H,16,8,6,2,0,0`,
    `${division},03/09/${shortYear},20:45,Milan,Inter,1,1,D,13,12,5,4,0,0`,
    `${division},10/09/${shortYear},18:00,Cagliari,Milan,0,0,D,9,11,2,3,0,0`,
    `${division},17/09/${nextShortYear},18:00,Future FC,Inter,,,,,,,,`,
  ].join('\r\n');
}

test('parser CSV gestisce virgolette e normalizza i nomi', () => {
  assert.deepEqual(parseCsv('A,B\r\n"x,y","z""q"\r\n'), [['A', 'B'], ['x,y', 'z"q']]);
  assert.equal(normalizeTeamName('FC Internazionale Milano'), 'internazionale milano');
  assert.equal(canonicalTeamKey('Ipswich Town FC'), canonicalTeamKey('Ipswich'));
});

test('parser Football-Data conserva tiri, squadre e gare future senza statistiche', () => {
  const competition = BULK_COMPETITIONS.find((item) => item.competitionId === 23);
  const parsed = parseFootballDataCsv(fixtureCsv(2025), competition, 2025);
  assert.equal(parsed.rows.length, 4);
  assert.equal(parsed.incompleteMatches, 1);
  assert.ok(parsed.teams.some(([, name]) => name === 'Future FC'));
  assert.deepEqual(
    { home: parsed.rows[0].homeShots, away: parsed.rows[0].awayShots },
    { home: 10, away: 17 },
  );
  assert.ok(parsed.rows[0].startTimestamp > 0);
});

test('un HST o AST impossibile viene annullato senza perdere i tiri totali validi', () => {
  const competition = BULK_COMPETITIONS.find((item) => item.competitionId === 17);
  const csv = [
    'Div,Date,Time,HomeTeam,AwayTeam,FTR,HS,AS,HST,AST',
    'E0,15/08/2021,14:00,Newcastle,West Ham,H,17,8,3,9',
  ].join('\r\n');
  const parsed = parseFootballDataCsv(csv, competition, 2021);
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0].homeShots, 17);
  assert.equal(parsed.rows[0].awayShots, 8);
  assert.equal(parsed.rows[0].awayShotsOnTarget, null);
  assert.equal(parsed.supplementalStatisticsDiscarded, 1);
});

test('bootstrap atomico importa sette stagioni per dieci campionati, cataloghi, medie e cutoff point-in-time', async () => {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'shot-archive-test-'));
  const calls = [];
  let failDownloads = false;
  const archive = createShotDataArchive({
    databasePath: path.join(directory, 'shots.sqlite'),
    now: () => Date.UTC(2026, 7, 30, 12),
    downloadIntervalMs: 0,
    fetchText: async (url) => {
      calls.push(url);
      if (failDownloads && url.includes('/2627/D1.csv')) throw new Error('download interrotto');
      const match = url.match(/\/(\d{2})(\d{2})\/([^/]+)\.csv$/);
      assert.ok(match, `URL non riconosciuto: ${url}`);
      const startYear = 2000 + Number(match[1]);
      return fixtureCsv(startYear, match[3]);
    },
  });

  try {
    const status = await archive.sync({ full: true });
    assert.equal(calls.length, 70);
    assert.equal(status.ready, true);
    assert.equal(status.matches, 280);
    assert.equal(status.competitions, 10);
    assert.equal(status.oldestSeason, '2020/21');
    assert.equal(status.latestSeason, '2026/27');
    assert.equal(status.calibrations.length, 10);

    const catalog = await archive.getAverageCatalog(123, 'Cagliari');
    assert.equal(catalog.competitions.length, 10);
    assert.deepEqual(catalog.competitions[0].seasons.map((season) => season.id), [2026, 2025, 2024, 2023, 2022, 2021, 2020]);

    const averages = await archive.getShotAverages(123, 'Cagliari', 23, 2025, 'home');
    assert.equal(averages.matches, 2);
    assert.equal(averages.shotsFor, 9.5);
    assert.equal(averages.shotsAgainst, 14);
    assert.equal(averages.totalShots, 23.5);

    const targetTimestamp = Date.UTC(2026, 7, 27, 16, 30) / 1000;
    const dataset = await archive.getPredictionDataset({
      id: 999,
      startTimestamp: targetTimestamp,
      tournament: { uniqueTournament: { id: 23, name: 'Serie A' } },
      season: { id: 1, name: '2026/27', year: '2026/27' },
      homeTeam: { id: 1, name: 'Cagliari' },
      awayTeam: { id: 2, name: 'Inter' },
    });
    assert.equal(dataset.homeModelTeamId, 'cagliari');
    assert.equal(dataset.awayModelTeamId, 'inter');
    assert.equal(dataset.transitions.home.sourceCompetition.id, 53);
    assert.equal(dataset.transitions.home.sourceSufficient, false);
    assert.equal(dataset.transitions.home.applied, false);
    assert.ok(dataset.observations.every((observation) => observation.startTimestamp < targetTimestamp));
    assert.ok(dataset.observations.every((observation) => !(
      observation.homeTeamId === 'inter' && observation.awayTeamId === 'cagliari'
      && observation.startTimestamp >= targetTimestamp - 6 * 60 * 60
    )));

    calls.length = 0;
    await archive.sync({ full: false });
    assert.equal(calls.length, 10, 'il refresh giornaliero scarica solo la stagione corrente');

    failDownloads = true;
    await assert.rejects(archive.sync({ full: true }), /download interrotto/);
    assert.equal(archive.getStatus().matches, 280, 'un download fallito non deve alterare il database valido');
  } finally {
    archive.close();
    await fs.promises.rm(directory, { recursive: true, force: true });
  }
});
