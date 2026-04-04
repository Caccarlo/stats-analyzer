import type { MatchEvent, Team, TournamentPhase } from '@/types';

const PHASE_KEYWORD_PATTERN = /(final|semi|quarter|round of|qualification|qualif|play-?off|playoff|group|league phase|knockout|preliminary|preliminare|ottavi|quarti|sedicesimi|trentaduesimi|sessantaquattresimi|finale)/i;
const GENERIC_ROUND_PATTERN = /^(round|g\.?|giornata)\s*\d+$/i;
const LEAGUE_PHASE_KEY = 'league-phase';
const LEAGUE_PHASE_NAME = 'League phase';

function toTitleCase(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function normalizePhaseName(event: MatchEvent): string {
  const rawName = event.roundInfo?.name?.trim();
  if (rawName) return rawName;

  const slug = event.roundInfo?.slug?.trim();
  if (slug) {
    return toTitleCase(slug.replace(/-/g, ' '));
  }

  if (typeof event.roundInfo?.round === 'number') {
    return `Giornata ${event.roundInfo.round}`;
  }

  return 'Fase principale';
}

function normalizePhaseKey(event: MatchEvent, name: string): string {
  const slug = event.roundInfo?.slug?.trim().toLowerCase();
  if (slug) return slug;

  if (event.roundInfo?.name) {
    return event.roundInfo.name.trim().toLowerCase().replace(/\s+/g, '-');
  }

  if (typeof event.roundInfo?.round === 'number') {
    return `round-${event.roundInfo.round}`;
  }

  return name.trim().toLowerCase().replace(/\s+/g, '-');
}

function isSpecialPhaseName(name: string): boolean {
  return PHASE_KEYWORD_PATTERN.test(name) && !GENERIC_ROUND_PATTERN.test(name);
}

function isGenericRoundName(name: string): boolean {
  return GENERIC_ROUND_PATTERN.test(name.trim());
}

export function buildTournamentPhases(events: MatchEvent[]): TournamentPhase[] {
  const normalizedPhases = events.map((event) => ({
    event,
    name: normalizePhaseName(event),
    key: normalizePhaseKey(event, normalizePhaseName(event)),
  }));

  const hasSpecialPhases = normalizedPhases.some(({ name, key }) => (
    isSpecialPhaseName(name) || isSpecialPhaseName(key)
  ));

  const phaseMap = new Map<string, TournamentPhase>();

  normalizedPhases.forEach(({ event, name, key }) => {
    const effectiveKey = hasSpecialPhases && isGenericRoundName(name)
      ? LEAGUE_PHASE_KEY
      : key;
    const effectiveName = hasSpecialPhases && isGenericRoundName(name)
      ? LEAGUE_PHASE_NAME
      : name;
    const existing = phaseMap.get(effectiveKey);
    const teamsMap = new Map<number, Team>();

    if (existing) {
      existing.teams.forEach((team) => teamsMap.set(team.id, team));
      existing.teams = [];
      existing.events.push(event);
      teamsMap.set(event.homeTeam.id, event.homeTeam);
      teamsMap.set(event.awayTeam.id, event.awayTeam);
      existing.teams = [...teamsMap.values()].sort((a, b) => a.name.localeCompare(b.name, 'it'));
      existing.sortTimestamp = Math.max(existing.sortTimestamp, event.startTimestamp);
      return;
    }

    teamsMap.set(event.homeTeam.id, event.homeTeam);
    teamsMap.set(event.awayTeam.id, event.awayTeam);
    phaseMap.set(effectiveKey, {
      key: effectiveKey,
      name: effectiveName,
      events: [event],
      teams: [...teamsMap.values()].sort((a, b) => a.name.localeCompare(b.name, 'it')),
      sortTimestamp: event.startTimestamp,
    });
  });

  return [...phaseMap.values()].sort((a, b) => {
    if (b.sortTimestamp !== a.sortTimestamp) {
      return b.sortTimestamp - a.sortTimestamp;
    }
    return a.name.localeCompare(b.name, 'it');
  });
}

export function isPhaseBasedCompetition(phases: TournamentPhase[]): boolean {
  if (phases.length < 2) return false;
  return phases.some((phase) => isSpecialPhaseName(phase.name) || isSpecialPhaseName(phase.key));
}
