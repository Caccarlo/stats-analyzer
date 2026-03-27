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

export interface AggregatedStats {
  totalFoulsCommitted: number;
  totalFoulsSuffered: number;
  totalMinutesPlayed: number;
  totalAppearances: number;
  avgFoulsCommittedPerMatch: string;
  avgFoulsCommittedPer90: string;
  avgFoulsSufferedPerMatch: string;
  avgFoulsSufferedPer90: string;
}

// === Partite ===

export interface MatchEvent {
  id: number;
  slug: string;
  startTimestamp: number;
  tournament: {
    name: string;
    uniqueTournament: Tournament;
  };
  season: Season;
  roundInfo?: { round: number };
  homeTeam: Team;
  awayTeam: Team;
  homeScore: { current: number; period1?: number; period2?: number };
  awayScore: { current: number; period1?: number; period2?: number };
  status: { code: number; description: string; type?: string };
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

export interface PanelState {
  view: ViewType;
  countryId?: string;
  countryName?: string;
  leagueId?: number;
  leagueName?: string;
  seasonId?: number;
  teamId?: number;
  teamName?: string;
  playerId?: number;
  playerData?: Player;
}

export interface NavigationState {
  panels: PanelState[];
}

// === Paesi e campionati hardcoded ===

export interface CountryConfig {
  id: string;
  name: string;
  categoryId: number;
  leagues: LeagueConfig[];
}

export interface LeagueConfig {
  id: number;
  name: string;
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

// === Ricerca ===

export interface SearchResult {
  type: string;
  entity: Player & { team?: Team };
}
