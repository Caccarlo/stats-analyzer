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
  totalMinutesPlayed: number;
  totalAppearances: number;
  avgFoulsCommittedPerMatch: string;
  avgFoulsCommittedPer90: string;
  avgFoulsSufferedPerMatch: string;
  avgFoulsSufferedPer90: string;
  totalYellowCards: number;
  totalRedCards: number;
  avgYellowCardsPerMatch: string;
  avgRedCardsPerMatch: string;
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

// === Navigazione ===

export type ViewType = 'home' | 'leagues' | 'teams' | 'team' | 'player';

export type SelectedPeriod =
  | { type: 'last'; count: 5 | 10 | 15 | 20 | 30 | 50 | 75 }
  | { type: 'season'; year: string };

export interface PlayerFilterState {
  selectedPeriod: SelectedPeriod;
  enabledTournaments: Set<number>;
  showCommitted: boolean;
  showSuffered: boolean;
  showHome: boolean;
  showAway: boolean;
  showCards: boolean;
  showStartersOnly: boolean;
  committedLine: number;
  sufferedLine: number;
}

export interface PanelState {
  view: ViewType;
  countryId?: string;
  countryName?: string;
  countryCategoryId?: number;
  leagueId?: number;
  leagueName?: string;
  seasonId?: number;
  tournamentPhaseKey?: string;
  tournamentPhaseName?: string;
  teamId?: number;
  teamName?: string;
  playerId?: number;
  playerData?: Player;
  filterState?: PlayerFilterState;
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

export type PlayerSearchResult     = { type: 'player';            entity: Player & { team?: Team } };
export type TeamSearchResult       = { type: 'team';              entity: TeamSearchEntity };
export type TournamentSearchResult = { type: 'uniqueTournament';  entity: TournamentSearchEntity };

export type SearchResult =
  | PlayerSearchResult
  | TeamSearchResult
  | TournamentSearchResult;
