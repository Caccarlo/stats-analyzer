// === Entità base ===

export interface Player {
  id: number;
  name: string;
  slug: string;
  shortName?: string;
  position: string;
  jerseyNumber?: string;
  height?: number;
  dateOfBirthTimestamp?: number;
  team?: Team;
}

export interface Team {
  id: number;
  name: string;
  slug: string;
  shortName?: string;
  nameCode?: string;
  national?: boolean;
}

export interface Tournament {
  id: number;
  name: string;
  slug: string;
  category?: { id: number; name: string; slug?: string; alpha2?: string };
}

export interface Category {
  id: number;
  name: string;
  slug: string;
  alpha2?: string;
}

export interface Season {
  id: number;
  name: string;
  year: string;
}

// === Tornei e stagioni del giocatore ===

export interface TournamentSeason {
  uniqueTournament: Tournament;
  seasons: Season[];
}

// === Statistiche ===

export interface PlayerSeasonStats {
  fouls: number;
  wasFouled: number;
  totalShots?: number;
  shotsOnTarget?: number;
  minutesPlayed: number;
  appearances: number;
  matchesStarted: number;
  yellowCards: number;
  redCards: number;
  rating: number;
}

export interface NationalTeamStat {
  team: Team;
  appearances: number;
  debutTimestamp: number;
}

export interface PlayerMatchStatistics {
  fouls?: number;
  wasFouled?: number;
  totalShots?: number;
  shotsOnTarget?: number;
  minutesPlayed?: number;
  rating?: number;
  yellowCards?: number;
  redCards?: number;
  [key: string]: unknown;
}

export interface PlayerEventIncidents {
  yellowCards?: number;
  redCards?: number;
  yellowRedCards?: number;
  goals?: number;
  assists?: number;
  [key: string]: unknown;
}

export type DataAvailability = 'idle' | 'loading' | 'loaded' | 'unavailable' | 'error';

export interface AggregatedStats {
  totalFoulsCommitted: number;
  totalFoulsSuffered: number;
  totalShots: number;
  totalShotsOnTarget: number;
  totalMinutesPlayed: number;
  totalAppearances: number;
  avgFoulsCommittedPerMatch: string;
  avgFoulsCommittedPer90: string;
  avgFoulsSufferedPerMatch: string;
  avgFoulsSufferedPer90: string;
  avgShotsPerMatch: string;
  avgShotsPer90: string;
  avgShotsOnTargetPerMatch: string;
  avgShotsOnTargetPer90: string;
  totalYellowCards: number;
  totalRedCards: number;
  avgYellowCardsPerMatch: string;
  avgRedCardsPerMatch: string;
  totalGoals: number;
  avgGoalsPerMatch: string;
  totalAssists: number;
  avgAssistsPerMatch: string;
}

// === Partite ===

export interface MatchEventTime {
  injuryTime1?: number;
  injuryTime2?: number;
  injuryTime3?: number;
  injuryTime4?: number;
  currentPeriodStartTimestamp?: number;
}

export interface MatchScore {
  current: number;
  display?: number;
  period1?: number;
  period2?: number;
  period3?: number;
  period4?: number;
  normaltime?: number;
  extra1?: number;
  extra2?: number;
}

export interface MatchDurationMetadata {
  defaultPeriodCount?: number;
  defaultPeriodLength?: number;
  defaultOvertimeLength?: number;
  time?: MatchEventTime;
  homeScore?: MatchScore;
  awayScore?: MatchScore;
}

export interface MatchEvent {
  id: number;
  slug: string;
  startTimestamp: number;
  tournament: {
    name: string;
    uniqueTournament: Tournament;
  };
  season: Season;
  roundInfo?: {
    round: number;
    name?: string;
    slug?: string;
  };
  homeTeam: Team;
  awayTeam: Team;
  homeScore: MatchScore;
  awayScore: MatchScore;
  status: { code: number; description: string; type?: string };
  time?: MatchEventTime;
  hasEventPlayerStatistics?: boolean;
  hasEventPlayerHeatMap?: boolean;
}

// === Commenti partita ===

export interface MatchComment {
  text: string;
  type: string;
  isHome: boolean;
  time?: number;
  player?: Player;
  playerIn?: Player;
  playerOut?: Player;
}

// === Falli ===

export interface FoulMatchup {
  type: 'committed' | 'suffered' | 'handball';
  minute?: number;
  playerFouled?: Player;
  playerFouling?: Player;
  zoneText: string;
  rawText: string;
}

// === Cartellini ===

export type CardType = 'yellow' | 'red' | 'yellowRed';

export interface CardInfo {
  type: CardType;
  minute?: number;
}

// === Posizioni campo ===

export interface PlayerPosition {
  player: Player;
  averageX: number;
  averageY: number;
  pointsCount?: number;
  isSelectedPlayer?: boolean;
}

// === Heatmap ===

export interface HeatmapPoint {
  x: number;
  y: number;
}

export interface ShotmapCoordinate {
  x: number;
  y: number;
  z?: number;
}

export interface MatchShot {
  id: number | string;
  playerId?: number;
  playerName?: string;
  isHome?: boolean;
  isOnTarget: boolean;
  isGoal: boolean;
  time?: number;
  addedTime?: number;
  xg?: number;
  xgot?: number;
  shotType?: string;
  bodyPart?: string;
  playerCoordinates?: ShotmapCoordinate;
  goalMouthCoordinates?: ShotmapCoordinate;
  draw?: {
    start?: ShotmapCoordinate;
    end?: ShotmapCoordinate;
    block?: ShotmapCoordinate;
    goal?: ShotmapCoordinate;
  };
}

// === Formazione ===

export interface LineupPlayer {
  player: Player;
  position: string;
  substitute: boolean;
  statistics?: Record<string, number>;
}

export interface TeamLineup {
  players: LineupPlayer[];
  formation: string;
  playerColor?: { primary: string; number: string };
  goalkeeperColor?: { primary: string; number: string };
}

export interface MatchLineups {
  confirmed: boolean;
  home: TeamLineup;
  away: TeamLineup;
}

// === Analisi partita ===

export interface MatchAnalysis {
  event: MatchEvent;
  fouls: FoulMatchup[];
  minutesPlayed: number;
  isTitular: boolean;
  substituteInMinute?: number;
  substituteOutMinute?: number;
  positions: {
    home: PlayerPosition[];
    away: PlayerPosition[];
  };
}

export interface MatchupNavigationTarget {
  eventId: number;
  startTimestamp?: number;
  homeTeamId: number;
  homeTeamName: string;
  awayTeamId: number;
  awayTeamName: string;
  leagueId?: number;
  leagueName?: string;
  seasonId?: number;
  seasonYear?: string;
  countryId?: string;
  countryName?: string;
  countryCategoryId?: number;
}

export interface TeamNextMatchSummary extends MatchupNavigationTarget {
  startTimestamp: number;
}

// === Previsioni tiri ===

export type MatchupSection = 'formations' | 'predictions';
export type ShotAverageVenue = 'all' | 'home' | 'away';
export type ShotAverageSide = 'home' | 'away';

export interface ShotAverageSelection {
  competitionId?: number;
  seasonId?: number;
  venue: ShotAverageVenue;
}

export interface ShotAverageCatalogSeason {
  id: number;
  name: string;
  year?: string;
}

export interface ShotAverageCatalogCompetition {
  id: number;
  name: string;
  categoryName?: string | null;
  seasons: ShotAverageCatalogSeason[];
}

export interface ShotAverageCatalog {
  teamId: number;
  competitions: ShotAverageCatalogCompetition[];
  dataSource?: string;
}

export interface TeamShotAverages {
  status: 'ready';
  teamId: number;
  competitionId: number;
  seasonId: number;
  venue: ShotAverageVenue;
  matches: number;
  excludedMissing: number;
  shotsFor: number | null;
  shotsAgainst: number | null;
  totalShots: number | null;
  dataSource?: string;
}

export interface ShotMarketLine {
  line: number;
  underProbability: number;
  underFairOdds: number;
  overProbability: number;
  overFairOdds: number;
  isMain: boolean;
}

export interface ShotRatingDiagnostic {
  raw: number;
  value: number;
  nEff: number;
}

export interface ShotPrediction {
  eventId: number;
  modelVersion: string;
  generatedAt: string;
  cutoffTimestamp: number;
  cutoffIso: string;
  competition: { id: number; name: string };
  season: { id: number; name: string; year: string };
  homeTeam: { id: number; name: string };
  awayTeam: { id: number; name: string };
  expected: {
    home: number;
    away: number;
    total: number;
    interval80: [number, number];
  };
  distribution: { type: 'poisson' } | { type: 'negative-binomial'; dispersion: number };
  mainLine: number | null;
  markets: ShotMarketLine[];
  diagnostics: {
    baseline: { home: number; away: number };
    ratings: {
      homeAttack: ShotRatingDiagnostic;
      homeVulnerability: ShotRatingDiagnostic;
      awayAttack: ShotRatingDiagnostic;
      awayVulnerability: ShotRatingDiagnostic;
    };
    betaAttack: number;
    betaDefense: number;
    halfLifeDays: number;
    shrinkageMatches: number;
    effectiveSample: { home: number; away: number; league: number };
    strength: {
      difference: number;
      selectedTerm: 'none' | 'linear' | 'quadratic';
      homeLogAdjustment: number;
      awayLogAdjustment: number;
      retained: boolean;
    };
    backtest: {
      sampleSize: number;
      nll: number | null;
      mae: number | null;
      calibrationError: number | null;
      poissonNll?: number;
      negativeBinomialNll?: number;
      noStrengthTermNll?: number;
      selectedStrengthTermNll?: number;
      note?: string;
    };
    matchesUsed: number;
    latestObservationTimestamp: number;
    missingStatisticsExcluded: number;
    dataSource?: string;
    seasonsUsed: Array<{ id: number; name: string; year?: string }>;
    promotion: {
      applied: boolean;
      uncertaintyShots: number;
      note: string;
      teams: Array<{
        teamId: number;
        teamName: string;
        applied: boolean;
        sourceCompetitionId: number;
        sourceSeason: { id: number; name: string; year?: string };
        cohortSize: number;
        cohortSufficient: boolean;
        equivalentMatches: number;
        lowerRatings: Record<string, number>;
        transitionFactors: Record<string, number>;
        transferredRatings: Record<string, number>;
      }>;
    };
    warnings: string[];
  };
}

export type ShotPredictionResponse =
  | { status: 'ready'; prediction: ShotPrediction }
  | { status: 'building'; progress: { stage: string; message: string; completed: number; total: number } };

export interface ShotPredictionTargetSnapshot {
  id: number;
  startTimestamp: number;
  tournament: { uniqueTournament: { id: number; name: string } };
  season: { id: number; name: string; year?: string } | null;
  homeTeam: { id: number; name: string };
  awayTeam: { id: number; name: string };
}

export interface ShotPredictionCalculation {
  selection: string;
  formula: string;
  values: Record<string, unknown>;
  probabilitySteps: string[];
  modelVersion: string;
  cutoffTimestamp: number;
  cutoffIso: string;
  backtest: ShotPrediction['diagnostics']['backtest'];
  warnings: string[];
}

export interface ShotPredictionUsedMatch {
  eventId: number | string;
  startTimestamp: number;
  date: string;
  competition: string;
  match: string;
  venue: ShotAverageVenue;
  shotsFor: number;
  shotsAgainst: number;
  totalShots: number;
  daysFromCutoff: number;
  temporalWeight: number;
  opponentPointInTimeStrength: number;
  ratingContribution: number;
}

export interface ShotPredictionDetails {
  status: 'ready';
  calculation: ShotPredictionCalculation;
  matches: {
    source: ShotAverageSide;
    page: number;
    pageSize: number;
    total: number;
    items: ShotPredictionUsedMatch[];
  };
}

// === Navigazione ===

export type ViewType = 'home' | 'leagues' | 'teams' | 'team' | 'player' | 'matchup';

export type SelectedPeriod =
  | { type: 'last'; count: 5 | 10 | 15 | 20 | 30 | 50 | 75 }
  | { type: 'season'; year: string };

export interface PlayerFilterState {
  selectedPeriod: SelectedPeriod;
  enabledTournaments: Set<number>;
  showCommitted: boolean;
  showSuffered: boolean;
  showShots: boolean;
  showShotsOnTarget: boolean;
  showHome: boolean;
  showAway: boolean;
  showCards: boolean;
  showGoalsAssists: boolean;
  showStartersOnly: boolean;
  committedLine: number;
  sufferedLine: number;
  shotsLine: number;
  shotsOnTargetLine: number;
}

export interface PanelState {
  view: ViewType;
  countryId?: string;
  countryName?: string;
  countryCategoryId?: number;
  leagueId?: number;
  leagueName?: string;
  seasonId?: number;
  seasonYear?: string;
  tournamentPhaseKey?: string;
  tournamentPhaseName?: string;
  teamId?: number;
  teamName?: string;
  playerId?: number;
  playerData?: Player;
  filterState?: PlayerFilterState;
  // matchup fields (used when view === 'matchup')
  matchupEventId?: number;
  matchupStartTimestamp?: number;
  homeTeamId?: number;
  homeTeamName?: string;
  awayTeamId?: number;
  awayTeamName?: string;
  matchupSection?: MatchupSection;
  homeShotAverageSelection?: ShotAverageSelection;
  awayShotAverageSelection?: ShotAverageSelection;
  // persisted by TeamView so split panels can prove they reference the same real match
  nextMatchSummary?: TeamNextMatchSummary;
}

export interface NavigationState {
  panels: PanelState[];
}

// === Categorie top in home ===

export interface CountryConfig {
  id: string;
  name: string;
  categoryId: number;
}

// === Standings ===

export interface StandingRow {
  team: Team;
  position: number;
  matches: number;
  wins: number;
  draws: number;
  losses: number;
  points: number;
}

export interface StandingGroup {
  name?: string;
  type?: string;
  rows: StandingRow[];
}

export interface TournamentPhase {
  key: string;
  name: string;
  teams: Team[];
  standings: StandingRow[];
  events: MatchEvent[];
  sections: TournamentPhaseSection[];
  sortTimestamp: number;
}

export interface TournamentPhaseSection {
  key: string;
  label: string;
  teams: Team[];
  standings: StandingRow[];
  events: MatchEvent[];
  sortTimestamp: number;
}

// === Ricerca ===

export interface TeamSearchEntity {
  id: number;
  name: string;
  slug: string;
  nameCode?: string;
  sport?: { id: number; slug: string };
}

export interface TournamentSearchEntity {
  id: number;
  name: string;
  slug: string;
  category?: { id: number; name: string; alpha2?: string };
}

export type PlayerSearchResult     = { type: 'player';            entity: Player & { team?: Team; sport?: { id: number; slug: string } } };
export type TeamSearchResult       = { type: 'team';              entity: TeamSearchEntity };
export type TournamentSearchResult = { type: 'uniqueTournament';  entity: TournamentSearchEntity };

export type SearchResult =
  | PlayerSearchResult
  | TeamSearchResult
  | TournamentSearchResult;
