const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const FOOTBALL_DATA_ORIGIN = 'https://www.football-data.co.uk/mmz4281';
const DEFAULT_UPDATE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DOWNLOAD_INTERVAL_MS = 5_000;
const ARCHIVE_SOURCE = 'football-data.co.uk';

const BULK_COMPETITIONS = [
  { competitionId: 17, name: 'Premier League', code: 'E0', timeZone: 'Europe/London' },
  { competitionId: 23, name: 'Serie A', code: 'I1', timeZone: 'Europe/Rome' },
  { competitionId: 8, name: 'LaLiga', code: 'SP1', timeZone: 'Europe/Madrid' },
  { competitionId: 35, name: 'Bundesliga', code: 'D1', timeZone: 'Europe/Berlin' },
  { competitionId: 34, name: 'Ligue 1', code: 'F1', timeZone: 'Europe/Paris' },
];

const COMPETITION_BY_ID = new Map(BULK_COMPETITIONS.map((competition) => [competition.competitionId, competition]));

const TEAM_ALIASES = new Map(Object.entries({
  'manchester united': 'Man United',
  'manchester city': 'Man City',
  'nottingham forest': "Nott'm Forest",
  'wolverhampton wanderers': 'Wolves',
  'tottenham hotspur': 'Tottenham',
  'newcastle united': 'Newcastle',
  'west ham united': 'West Ham',
  'brighton and hove albion': 'Brighton',
  'leeds united': 'Leeds',
  'internazionale': 'Inter',
  'inter milan': 'Inter',
  'ac milan': 'Milan',
  'ssc napoli': 'Napoli',
  'as roma': 'Roma',
  'hellas verona': 'Verona',
  'atalanta bc': 'Atalanta',
  'acf fiorentina': 'Fiorentina',
  'bologna fc': 'Bologna',
  'genoa cfc': 'Genoa',
  'us lecce': 'Lecce',
  'torino fc': 'Torino',
  'udinese calcio': 'Udinese',
  'como 1907': 'Como',
  'atletico madrid': 'Ath Madrid',
  'athletic club': 'Ath Bilbao',
  'real betis': 'Betis',
  'real sociedad': 'Sociedad',
  'celta vigo': 'Celta',
  'rcd espanyol': 'Espanol',
  'rayo vallecano': 'Vallecano',
  'deportivo alaves': 'Alaves',
  'real valladolid': 'Valladolid',
  'bayern munich': 'Bayern Munich',
  'bayern munchen': 'Bayern Munich',
  'borussia dortmund': 'Dortmund',
  'borussia monchengladbach': "M'gladbach",
  'eintracht frankfurt': 'Ein Frankfurt',
  'bayer 04 leverkusen': 'Leverkusen',
  'bayer leverkusen': 'Leverkusen',
  'rb leipzig': 'RB Leipzig',
  'fc koln': 'FC Koln',
  'paris saint germain': 'Paris SG',
  'olympique marseille': 'Marseille',
  'olympique lyonnais': 'Lyon',
  'as monaco': 'Monaco',
  'losc lille': 'Lille',
  'ogc nice': 'Nice',
  'stade rennais': 'Rennes',
  'rc lens': 'Lens',
  'rc strasbourg': 'Strasbourg',
}));

class ShotDataArchiveError extends Error {
  constructor(message, statusCode = 503, code = 'shot_archive_unavailable') {
    super(message);
    this.name = 'ShotDataArchiveError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

function sleep(milliseconds) {
  return milliseconds > 0 ? new Promise((resolve) => setTimeout(resolve, milliseconds)) : Promise.resolve();
}

function normalizeTeamName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\b(?:fc|cf|afc|cfc|calcio|football club)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function seasonCode(startYear) {
  return `${String(startYear % 100).padStart(2, '0')}${String((startYear + 1) % 100).padStart(2, '0')}`;
}

function seasonName(startYear) {
  return `${startYear}/${String((startYear + 1) % 100).padStart(2, '0')}`;
}

function currentSeasonStartYear(timestampMs = Date.now()) {
  const date = new Date(timestampMs);
  const year = date.getUTCFullYear();
  return date.getUTCMonth() >= 6 ? year : year - 1;
}

function seasonStartYearFromEvent(event) {
  const label = String(event?.season?.year || event?.season?.name || '');
  const fourDigit = label.match(/\b((?:19|20)\d{2})\s*[/-]/);
  if (fourDigit) return Number(fourDigit[1]);
  const twoDigit = label.match(/(?:^|\D)(\d{2})\s*[/-]\s*\d{2}(?:\D|$)/);
  if (twoDigit) {
    const value = Number(twoDigit[1]);
    return value <= 50 ? 2000 + value : 1900 + value;
  }
  return currentSeasonStartYear(Number(event?.startTimestamp || 0) * 1000);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;
  const input = String(text || '').replace(/^\uFEFF/, '');
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        value += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ',') {
      row.push(value);
      value = '';
    } else if (character === '\n') {
      row.push(value.replace(/\r$/, ''));
      if (row.some((cell) => cell !== '')) rows.push(row);
      row = [];
      value = '';
    } else {
      value += character;
    }
  }
  if (quoted) throw new ShotDataArchiveError('CSV non valido: virgolette non chiuse.', 502, 'invalid_bulk_data');
  row.push(value.replace(/\r$/, ''));
  if (row.some((cell) => cell !== '')) rows.push(row);
  return rows;
}

function localDateTimeToUtcSeconds({ year, month, day, hour, minute }, timeZone) {
  const desired = Date.UTC(year, month - 1, day, hour, minute, 0);
  let guess = desired;
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(guess))
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]));
    const rendered = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0);
    guess += desired - rendered;
  }
  return Math.floor(guess / 1000);
}

function parseMatchTimestamp(dateValue, timeValue, timeZone) {
  const match = String(dateValue || '').trim().match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/);
  if (!match) return null;
  let year = Number(match[3]);
  if (year < 100) year += year <= 50 ? 2000 : 1900;
  const timeMatch = String(timeValue || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  const parts = {
    year,
    month: Number(match[2]),
    day: Number(match[1]),
    hour: timeMatch ? Number(timeMatch[1]) : 12,
    minute: timeMatch ? Number(timeMatch[2]) : 0,
  };
  if (
    parts.month < 1 || parts.month > 12
    || parts.day < 1 || parts.day > 31
    || parts.hour < 0 || parts.hour > 23
    || parts.minute < 0 || parts.minute > 59
  ) return null;
  return localDateTimeToUtcSeconds(parts, timeZone);
}

function parseCount(value) {
  const text = String(value ?? '').trim();
  if (!/^\d+$/.test(text)) return null;
  const number = Number(text);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function parseFootballDataCsv(text, competition, startYear) {
  const csvRows = parseCsv(text);
  if (csvRows.length === 0) throw new ShotDataArchiveError(`CSV vuoto per ${competition.name}.`, 502, 'invalid_bulk_data');
  const headers = csvRows[0].map((header) => header.trim());
  const indexes = Object.fromEntries(headers.map((header, index) => [header, index]));
  const required = ['Date', 'HomeTeam', 'AwayTeam', 'HS', 'AS'];
  const missingHeaders = required.filter((header) => indexes[header] === undefined);
  if (missingHeaders.length > 0) {
    throw new ShotDataArchiveError(
      `CSV ${competition.code} ${seasonName(startYear)} senza colonne ${missingHeaders.join(', ')}.`,
      502,
      'invalid_bulk_data',
    );
  }

  const rows = [];
  const teams = new Map();
  let incompleteMatches = 0;
  let malformedMatches = 0;
  const sourceKeys = new Set();

  csvRows.slice(1).forEach((cells) => {
    const homeTeam = String(cells[indexes.HomeTeam] || '').trim();
    const awayTeam = String(cells[indexes.AwayTeam] || '').trim();
    if (!homeTeam || !awayTeam) return;
    const homeTeamKey = normalizeTeamName(homeTeam);
    const awayTeamKey = normalizeTeamName(awayTeam);
    teams.set(homeTeamKey, homeTeam);
    teams.set(awayTeamKey, awayTeam);

    const homeShots = parseCount(cells[indexes.HS]);
    const awayShots = parseCount(cells[indexes.AS]);
    if (homeShots === null || awayShots === null) {
      incompleteMatches += 1;
      return;
    }
    const startTimestamp = parseMatchTimestamp(cells[indexes.Date], cells[indexes.Time], competition.timeZone);
    if (!startTimestamp) {
      malformedMatches += 1;
      return;
    }
    const homeShotsOnTarget = indexes.HST === undefined ? null : parseCount(cells[indexes.HST]);
    const awayShotsOnTarget = indexes.AST === undefined ? null : parseCount(cells[indexes.AST]);
    if (
      (homeShotsOnTarget !== null && homeShotsOnTarget > homeShots)
      || (awayShotsOnTarget !== null && awayShotsOnTarget > awayShots)
    ) {
      malformedMatches += 1;
      return;
    }
    const date = new Date(startTimestamp * 1000).toISOString();
    const sourceKey = `${ARCHIVE_SOURCE}:${competition.code}:${startYear}:${date}:${homeTeamKey}:${awayTeamKey}`;
    if (sourceKeys.has(sourceKey)) {
      throw new ShotDataArchiveError(`Partita duplicata nel CSV: ${homeTeam} - ${awayTeam}.`, 502, 'invalid_bulk_data');
    }
    sourceKeys.add(sourceKey);
    rows.push({
      sourceKey,
      source: ARCHIVE_SOURCE,
      competitionId: competition.competitionId,
      competitionName: competition.name,
      divisionCode: competition.code,
      seasonStartYear: startYear,
      startTimestamp,
      matchDate: date,
      homeTeam,
      awayTeam,
      homeTeamKey,
      awayTeamKey,
      homeShots,
      awayShots,
      homeShotsOnTarget,
      awayShotsOnTarget,
      homeRedCards: indexes.HR === undefined ? null : parseCount(cells[indexes.HR]),
      awayRedCards: indexes.AR === undefined ? null : parseCount(cells[indexes.AR]),
    });
  });

  if (malformedMatches > 0) {
    throw new ShotDataArchiveError(
      `${malformedMatches} righe concluse non valide in ${competition.code} ${seasonName(startYear)}.`,
      502,
      'invalid_bulk_data',
    );
  }
  return { rows, teams: [...teams.entries()], incompleteMatches };
}

async function defaultFetchText(url) {
  const response = await fetch(url, {
    headers: {
      Accept: 'text/csv,text/plain;q=0.9,*/*;q=0.1',
      'User-Agent': 'Stats-Analyzer/1.0 (local research archive)',
    },
  });
  if (!response.ok) {
    const error = new ShotDataArchiveError(
      `Football-Data ha risposto ${response.status} per ${url}.`,
      502,
      'bulk_upstream_error',
    );
    error.upstreamStatus = response.status;
    throw error;
  }
  return response.text();
}

function jaccardSimilarity(first, second) {
  const firstTokens = new Set(normalizeTeamName(first).split(' ').filter(Boolean));
  const secondTokens = new Set(normalizeTeamName(second).split(' ').filter(Boolean));
  const intersection = [...firstTokens].filter((token) => secondTokens.has(token)).length;
  const union = new Set([...firstTokens, ...secondTokens]).size;
  return union > 0 ? intersection / union : 0;
}

class ShotDataArchive {
  constructor({
    databasePath = path.join(__dirname, '.shot-data', 'shots.sqlite'),
    fetchText = defaultFetchText,
    now = () => Date.now(),
    downloadIntervalMs = DEFAULT_DOWNLOAD_INTERVAL_MS,
    updateIntervalMs = DEFAULT_UPDATE_INTERVAL_MS,
  } = {}) {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    this.databasePath = databasePath;
    this.fetchText = fetchText;
    this.now = now;
    this.downloadIntervalMs = Math.max(0, downloadIntervalMs);
    this.updateIntervalMs = Math.max(60_000, updateIntervalMs);
    this.db = new DatabaseSync(databasePath);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    this.syncPromise = null;
    this.timer = null;
    this.state = { phase: 'idle', completed: 0, total: 0, current: null, error: null, skipped: [] };
    this.createSchema();
  }

  createSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS shot_matches (
        source_key TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        competition_id INTEGER NOT NULL,
        competition_name TEXT NOT NULL,
        division_code TEXT NOT NULL,
        season_start_year INTEGER NOT NULL,
        start_timestamp INTEGER NOT NULL,
        match_date TEXT NOT NULL,
        home_team TEXT NOT NULL,
        away_team TEXT NOT NULL,
        home_team_key TEXT NOT NULL,
        away_team_key TEXT NOT NULL,
        home_shots INTEGER NOT NULL CHECK(home_shots >= 0),
        away_shots INTEGER NOT NULL CHECK(away_shots >= 0),
        home_shots_on_target INTEGER,
        away_shots_on_target INTEGER,
        home_red_cards INTEGER,
        away_red_cards INTEGER,
        imported_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_shot_matches_competition_cutoff
        ON shot_matches(competition_id, season_start_year, start_timestamp);
      CREATE INDEX IF NOT EXISTS idx_shot_matches_home_team
        ON shot_matches(competition_id, home_team_key, season_start_year);
      CREATE INDEX IF NOT EXISTS idx_shot_matches_away_team
        ON shot_matches(competition_id, away_team_key, season_start_year);
      CREATE TABLE IF NOT EXISTS season_teams (
        competition_id INTEGER NOT NULL,
        competition_name TEXT NOT NULL,
        division_code TEXT NOT NULL,
        season_start_year INTEGER NOT NULL,
        team_key TEXT NOT NULL,
        team_name TEXT NOT NULL,
        PRIMARY KEY (competition_id, season_start_year, team_key)
      );
      CREATE TABLE IF NOT EXISTS archive_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sync_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        started_at INTEGER NOT NULL,
        completed_at INTEGER,
        mode TEXT NOT NULL,
        files INTEGER NOT NULL DEFAULT 0,
        matches INTEGER NOT NULL DEFAULT 0,
        incomplete_matches INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL,
        error TEXT
      );
    `);
  }

  hasData() {
    return Number(this.db.prepare('SELECT COUNT(*) AS count FROM shot_matches').get().count) > 0;
  }

  readMeta(key) {
    return this.db.prepare('SELECT value FROM archive_meta WHERE key = ?').get(key)?.value || null;
  }

  writeMeta(key, value) {
    this.db.prepare(`
      INSERT INTO archive_meta(key, value) VALUES(?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, String(value));
  }

  fileUrl(competition, startYear) {
    return `${FOOTBALL_DATA_ORIGIN}/${seasonCode(startYear)}/${competition.code}.csv`;
  }

  async sync({ full = !this.hasData() } = {}) {
    if (this.syncPromise) return this.syncPromise;
    this.syncPromise = this.performSync({ full }).finally(() => {
      this.syncPromise = null;
    });
    return this.syncPromise;
  }

  async performSync({ full }) {
    const currentStartYear = currentSeasonStartYear(this.now());
    const seasonYears = full ? [currentStartYear - 1, currentStartYear] : [currentStartYear];
    const targets = seasonYears.flatMap((startYear) => BULK_COMPETITIONS.map((competition) => ({ competition, startYear })));
    const startedAt = this.now();
    const run = this.db.prepare(`
      INSERT INTO sync_runs(started_at, mode, files, status) VALUES(?, ?, ?, 'running')
    `).run(startedAt, full ? 'full' : 'daily', targets.length);
    this.state = { phase: 'downloading', completed: 0, total: targets.length, current: null, error: null, skipped: [] };
    const parsedFiles = [];

    try {
      for (let index = 0; index < targets.length; index += 1) {
        const target = targets[index];
        this.state.current = `${target.competition.name} ${seasonName(target.startYear)}`;
        let text;
        try {
          text = await this.fetchText(this.fileUrl(target.competition, target.startYear));
        } catch (error) {
          const currentSeasonNotPublished = target.startYear === currentStartYear
            && [300, 404].includes(Number(error.upstreamStatus));
          if (!currentSeasonNotPublished) throw error;
          this.state.skipped.push(`${target.competition.name} ${seasonName(target.startYear)}`);
          this.state.completed = index + 1;
          if (index < targets.length - 1) await sleep(this.downloadIntervalMs);
          continue;
        }
        const parsed = parseFootballDataCsv(text, target.competition, target.startYear);
        if (target.startYear < currentStartYear && parsed.rows.length === 0) {
          throw new ShotDataArchiveError(
            `Nessuna partita completa in ${this.state.current}.`,
            502,
            'invalid_bulk_data',
          );
        }
        parsedFiles.push({ ...target, ...parsed });
        this.state.completed = index + 1;
        if (index < targets.length - 1) await sleep(this.downloadIntervalMs);
      }

      this.state.phase = 'committing';
      const importedAt = this.now();
      const insertMatch = this.db.prepare(`
        INSERT INTO shot_matches(
          source_key, source, competition_id, competition_name, division_code,
          season_start_year, start_timestamp, match_date, home_team, away_team,
          home_team_key, away_team_key, home_shots, away_shots,
          home_shots_on_target, away_shots_on_target, home_red_cards, away_red_cards, imported_at
        ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const insertTeam = this.db.prepare(`
        INSERT INTO season_teams(
          competition_id, competition_name, division_code, season_start_year, team_key, team_name
        ) VALUES(?, ?, ?, ?, ?, ?)
      `);
      this.db.exec('BEGIN IMMEDIATE');
      try {
        this.db.prepare('DELETE FROM shot_matches WHERE season_start_year < ?').run(currentStartYear - 1);
        this.db.prepare('DELETE FROM season_teams WHERE season_start_year < ?').run(currentStartYear - 1);
        parsedFiles.forEach((file) => {
          this.db.prepare('DELETE FROM shot_matches WHERE competition_id = ? AND season_start_year = ?')
            .run(file.competition.competitionId, file.startYear);
          this.db.prepare('DELETE FROM season_teams WHERE competition_id = ? AND season_start_year = ?')
            .run(file.competition.competitionId, file.startYear);
          file.teams.forEach(([teamKey, teamName]) => {
            insertTeam.run(
              file.competition.competitionId,
              file.competition.name,
              file.competition.code,
              file.startYear,
              teamKey,
              teamName,
            );
          });
          file.rows.forEach((row) => {
            insertMatch.run(
              row.sourceKey,
              row.source,
              row.competitionId,
              row.competitionName,
              row.divisionCode,
              row.seasonStartYear,
              row.startTimestamp,
              row.matchDate,
              row.homeTeam,
              row.awayTeam,
              row.homeTeamKey,
              row.awayTeamKey,
              row.homeShots,
              row.awayShots,
              row.homeShotsOnTarget,
              row.awayShotsOnTarget,
              row.homeRedCards,
              row.awayRedCards,
              importedAt,
            );
          });
        });
        this.writeMeta('last_successful_sync', importedAt);
        this.writeMeta('source', ARCHIVE_SOURCE);
        this.writeMeta('current_season_start_year', currentStartYear);
        this.writeMeta('last_skipped_files', JSON.stringify(this.state.skipped));
        this.db.exec('COMMIT');
      } catch (error) {
        this.db.exec('ROLLBACK');
        throw error;
      }

      const matches = parsedFiles.reduce((total, file) => total + file.rows.length, 0);
      const incompleteMatches = parsedFiles.reduce((total, file) => total + file.incompleteMatches, 0);
      this.db.prepare(`
        UPDATE sync_runs
        SET completed_at = ?, matches = ?, incomplete_matches = ?, status = 'ready'
        WHERE id = ?
      `).run(this.now(), matches, incompleteMatches, run.lastInsertRowid);
      this.state = {
        phase: 'ready',
        completed: targets.length,
        total: targets.length,
        current: null,
        error: null,
        skipped: [...this.state.skipped],
      };
      return this.getStatus();
    } catch (error) {
      this.db.prepare(`
        UPDATE sync_runs SET completed_at = ?, status = 'failed', error = ? WHERE id = ?
      `).run(this.now(), error.message || String(error), run.lastInsertRowid);
      this.state = {
        phase: this.hasData() ? 'stale' : 'error',
        completed: this.state.completed,
        total: targets.length,
        current: this.state.current,
        error: error.message || String(error),
        skipped: [...this.state.skipped],
      };
      throw error;
    }
  }

  async start() {
    const lastSuccessfulSync = Number(this.readMeta('last_successful_sync') || 0);
    const stale = !lastSuccessfulSync || this.now() - lastSuccessfulSync >= this.updateIntervalMs;
    if (stale) this.sync({ full: !this.hasData() }).catch(() => {});
    if (!this.timer) {
      this.timer = setInterval(() => {
        this.sync({ full: false }).catch(() => {});
      }, this.updateIntervalMs);
      this.timer.unref?.();
    }
    return this.getStatus();
  }

  close() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.db.close();
  }

  async ensureReady() {
    if (this.hasData()) return;
    try {
      await this.sync({ full: true });
    } catch (error) {
      throw error instanceof ShotDataArchiveError
        ? error
        : new ShotDataArchiveError(error.message || 'Archivio tiri non disponibile.');
    }
    if (!this.hasData()) throw new ShotDataArchiveError('Archivio tiri ancora vuoto.');
  }

  getStatus() {
    const totals = this.db.prepare(`
      SELECT COUNT(*) AS matches, COUNT(DISTINCT competition_id) AS competitions,
             MIN(season_start_year) AS oldest_season, MAX(season_start_year) AS latest_season,
             MAX(imported_at) AS imported_at
      FROM shot_matches
    `).get();
    const latestRun = this.db.prepare(`
      SELECT started_at, completed_at, mode, files, matches, incomplete_matches, status, error
      FROM sync_runs ORDER BY id DESC LIMIT 1
    `).get() || null;
    return {
      configured: true,
      source: ARCHIVE_SOURCE,
      databasePath: this.databasePath,
      ready: Number(totals.matches) > 0,
      phase: this.state.phase,
      progress: {
        completed: this.state.completed,
        total: this.state.total,
        current: this.state.current,
      },
      error: this.state.error,
      skipped: this.state.skipped.length > 0
        ? [...this.state.skipped]
        : JSON.parse(this.readMeta('last_skipped_files') || '[]'),
      matches: Number(totals.matches || 0),
      competitions: Number(totals.competitions || 0),
      oldestSeason: totals.oldest_season ? seasonName(Number(totals.oldest_season)) : null,
      latestSeason: totals.latest_season ? seasonName(Number(totals.latest_season)) : null,
      lastSuccessfulSync: totals.imported_at ? new Date(Number(totals.imported_at)).toISOString() : null,
      latestRun,
    };
  }

  resolveTeam(competitionId, seasonYears, sofaTeamName) {
    const placeholders = seasonYears.map(() => '?').join(',');
    const candidates = this.db.prepare(`
      SELECT DISTINCT team_key, team_name FROM season_teams
      WHERE competition_id = ? AND season_start_year IN (${placeholders})
    `).all(Number(competitionId), ...seasonYears);
    if (candidates.length === 0) return null;
    const normalizedInput = normalizeTeamName(sofaTeamName);
    const alias = TEAM_ALIASES.get(normalizedInput);
    const wanted = normalizeTeamName(alias || normalizedInput);
    const exact = candidates.find((candidate) => candidate.team_key === wanted);
    if (exact) return { key: exact.team_key, name: exact.team_name, method: alias ? 'alias' : 'exact' };

    const ranked = candidates
      .map((candidate) => ({ ...candidate, score: jaccardSimilarity(wanted, candidate.team_key) }))
      .sort((first, second) => second.score - first.score);
    if (ranked[0]?.score >= 0.75 && ranked[0].score - (ranked[1]?.score || 0) >= 0.2) {
      return { key: ranked[0].team_key, name: ranked[0].team_name, method: 'tokens' };
    }
    return null;
  }

  async getPredictionDataset(event) {
    await this.ensureReady();
    const competitionId = Number(event?.tournament?.uniqueTournament?.id);
    const competition = COMPETITION_BY_ID.get(competitionId);
    if (!competition) {
      throw new ShotDataArchiveError('Competizione non supportata dall’archivio locale.', 422, 'unsupported_or_insufficient_data');
    }
    const targetSeasonStartYear = seasonStartYearFromEvent(event);
    const seasonYears = [targetSeasonStartYear - 1, targetSeasonStartYear];
    const homeTeam = this.resolveTeam(competitionId, seasonYears, event.homeTeam.name);
    const awayTeam = this.resolveTeam(competitionId, seasonYears, event.awayTeam.name);
    if (!homeTeam || !awayTeam) {
      const missing = [!homeTeam ? event.homeTeam.name : null, !awayTeam ? event.awayTeam.name : null].filter(Boolean);
      throw new ShotDataArchiveError(
        `Squadra non riconosciuta nell’archivio locale: ${missing.join(', ')}.`,
        422,
        'unsupported_or_insufficient_data',
      );
    }
    const rows = this.db.prepare(`
      SELECT * FROM shot_matches
      WHERE competition_id = ?
        AND season_start_year IN (?, ?)
        AND start_timestamp < ?
      ORDER BY start_timestamp, source_key
    `).all(competitionId, seasonYears[0], seasonYears[1], Number(event.startTimestamp));
    const observations = rows
      .filter((row) => !(
        row.home_team_key === homeTeam.key
        && row.away_team_key === awayTeam.key
        && Math.abs(Number(row.start_timestamp) - Number(event.startTimestamp)) <= 6 * 60 * 60
      ))
      .map((row) => ({
        eventId: row.source_key,
        startTimestamp: Number(row.start_timestamp),
        competitionId: Number(row.competition_id),
        competitionName: row.competition_name,
        seasonId: Number(row.season_start_year),
        homeTeamId: row.home_team_key,
        homeTeamName: row.home_team,
        awayTeamId: row.away_team_key,
        awayTeamName: row.away_team,
        homeShots: Number(row.home_shots),
        awayShots: Number(row.away_shots),
      }));
    const homeMatches = observations.filter((observation) => observation.homeTeamId === homeTeam.key).length;
    const awayMatches = observations.filter((observation) => observation.awayTeamId === awayTeam.key).length;
    return {
      observations,
      excludedMissing: 0,
      seasons: seasonYears.map((startYear) => ({
        id: startYear,
        name: seasonName(startYear),
        year: seasonName(startYear),
      })),
      homeMatches,
      awayMatches,
      homeModelTeamId: homeTeam.key,
      awayModelTeamId: awayTeam.key,
      teamResolution: { home: homeTeam, away: awayTeam },
      dataSource: ARCHIVE_SOURCE,
    };
  }

  async getAverageCatalog(teamId, teamName) {
    await this.ensureReady();
    const competitions = [];
    for (const competition of BULK_COMPETITIONS) {
      const seasonRows = this.db.prepare(`
        SELECT DISTINCT season_start_year FROM season_teams
        WHERE competition_id = ? ORDER BY season_start_year DESC
      `).all(competition.competitionId);
      const seasonYears = seasonRows.map((row) => Number(row.season_start_year));
      const resolution = this.resolveTeam(competition.competitionId, seasonYears, teamName);
      if (!resolution) continue;
      const seasons = seasonYears
        .filter((startYear) => this.db.prepare(`
          SELECT 1 FROM season_teams
          WHERE competition_id = ? AND season_start_year = ? AND team_key = ?
        `).get(competition.competitionId, startYear, resolution.key))
        .map((startYear) => ({ id: startYear, name: seasonName(startYear), year: seasonName(startYear) }));
      if (seasons.length > 0) {
        competitions.push({
          id: competition.competitionId,
          name: competition.name,
          categoryName: 'Top 5',
          seasons,
        });
      }
    }
    return { teamId: Number(teamId), competitions, dataSource: ARCHIVE_SOURCE };
  }

  async getShotAverages(teamId, teamName, competitionId, seasonId, venue) {
    await this.ensureReady();
    const competition = COMPETITION_BY_ID.get(Number(competitionId));
    if (!competition) {
      return {
        status: 'ready', teamId: Number(teamId), competitionId: Number(competitionId), seasonId: Number(seasonId),
        venue, matches: 0, excludedMissing: 0, shotsFor: null, shotsAgainst: null, totalShots: null,
        dataSource: ARCHIVE_SOURCE,
      };
    }
    const resolution = this.resolveTeam(competition.competitionId, [Number(seasonId)], teamName);
    if (!resolution) {
      return {
        status: 'ready', teamId: Number(teamId), competitionId: Number(competitionId), seasonId: Number(seasonId),
        venue, matches: 0, excludedMissing: 0, shotsFor: null, shotsAgainst: null, totalShots: null,
        dataSource: ARCHIVE_SOURCE,
      };
    }
    const normalizedVenue = ['all', 'home', 'away'].includes(venue) ? venue : 'all';
    const rows = this.db.prepare(`
      SELECT home_team_key, away_team_key, home_shots, away_shots
      FROM shot_matches
      WHERE competition_id = ? AND season_start_year = ?
        AND (
          (? IN ('all', 'home') AND home_team_key = ?)
          OR (? IN ('all', 'away') AND away_team_key = ?)
        )
    `).all(
      competition.competitionId,
      Number(seasonId),
      normalizedVenue,
      resolution.key,
      normalizedVenue,
      resolution.key,
    );
    const samples = rows.map((row) => {
      const isHome = row.home_team_key === resolution.key;
      return {
        shotsFor: Number(isHome ? row.home_shots : row.away_shots),
        shotsAgainst: Number(isHome ? row.away_shots : row.home_shots),
      };
    });
    const matches = samples.length;
    return {
      status: 'ready',
      teamId: Number(teamId),
      competitionId: Number(competitionId),
      seasonId: Number(seasonId),
      venue: normalizedVenue,
      matches,
      excludedMissing: 0,
      shotsFor: matches ? samples.reduce((total, sample) => total + sample.shotsFor, 0) / matches : null,
      shotsAgainst: matches ? samples.reduce((total, sample) => total + sample.shotsAgainst, 0) / matches : null,
      totalShots: matches
        ? samples.reduce((total, sample) => total + sample.shotsFor + sample.shotsAgainst, 0) / matches
        : null,
      dataSource: ARCHIVE_SOURCE,
    };
  }
}

function createShotDataArchive(options) {
  return new ShotDataArchive(options);
}

function registerShotDataArchiveRoutes(app, archive) {
  app.get('/api/shot-data/status', (_req, res) => res.json(archive.getStatus()));
}

if (require.main === module) {
  const archive = createShotDataArchive();
  archive.sync({ full: process.argv.includes('--daily') === false })
    .then((status) => {
      process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
      archive.close();
    })
    .catch((error) => {
      process.stderr.write(`${error.stack || error.message}\n`);
      archive.close();
      process.exitCode = 1;
    });
}

module.exports = {
  ARCHIVE_SOURCE,
  BULK_COMPETITIONS,
  ShotDataArchiveError,
  normalizeTeamName,
  seasonCode,
  seasonName,
  currentSeasonStartYear,
  seasonStartYearFromEvent,
  parseCsv,
  parseMatchTimestamp,
  parseFootballDataCsv,
  createShotDataArchive,
  registerShotDataArchiveRoutes,
};
