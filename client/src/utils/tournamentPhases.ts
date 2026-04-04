import type { MatchEvent, Team, TournamentPhase, TournamentPhaseSection } from '@/types';

const PHASE_KEYWORD_PATTERN = /(final|semi|quarter|round of|qualification|qualif|play-?off|playoff|group|league phase|knockout|preliminary|preliminare|ottavi|quarti|sedicesimi|trentaduesimi|sessantaquattresimi|finale)/i;
const GENERIC_ROUND_PATTERN = /^(round|g\.?|giornata)\s*\d+$/i;
const GROUP_PHASE_PATTERN = /\b(group|gruppo)\s+([a-z]|\d{1,2})\b/i;
const QUALIFICATION_ROUND_PATTERN = /\bqual\w*(?:\s+round)?\s*(\d+)\b/i;
const LEAGUE_PHASE_LABEL_PATTERN = /\b(league phase|group stage|group phase|fase a gruppi)\b/i;
const PLACEHOLDER_LABEL_PATTERN = /^(tbd|tba|tbc|to be determined)$/i;
const PLACEHOLDER_PREFIX_PATTERN = /^(winner|loser|runner[- ]?up|qualified|qualifier)\b/i;
const PLACEHOLDER_SLOT_TOKEN_PATTERN = '(?:\\d{1,2}[a-z]|[a-z]\\d)';
const PLACEHOLDER_SLASH_SLOT_PATTERN = new RegExp(`^(?:${PLACEHOLDER_SLOT_TOKEN_PATTERN})(?:/(?:${PLACEHOLDER_SLOT_TOKEN_PATTERN}))+$`, 'i');
const PLACEHOLDER_SINGLE_SLOT_PATTERN = new RegExp(`^(?:${PLACEHOLDER_SLOT_TOKEN_PATTERN})$`, 'i');
const PLACEHOLDER_BRACKET_REFERENCE_PATTERN = /^(?:w|l)\d+$/i;
const PLACEHOLDER_MATCH_REFERENCE_PATTERN = /^(?:winner|loser)(?:of)?(?:match)?\d+$/i;
const PLACEHOLDER_GROUP_RANK_PATTERN = /^(?:\d+|1st|2nd|3rd|4th|\d+(?:st|nd|rd|th))group[a-z0-9]+$/i;
const LEAGUE_PHASE_KEY = 'league-phase';
const LEAGUE_PHASE_NAME = 'League phase';
const QUALIFICATION_KEY = 'qualification';
const QUALIFICATION_NAME = 'Qualification';

interface PhaseSectionAccumulator extends TournamentPhaseSection {
  sortOrder: number;
}

interface PhaseGrouping {
  phaseKey: string;
  phaseName: string;
  sectionKey: string | null;
  sectionLabel: string | null;
  sectionSortOrder: number;
  phaseNamespaceLabel: string | null;
}

function toTitleCase(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function slugifyText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function getPhaseCompetitionLabel(event: MatchEvent): string | null {
  const tournamentName = event.tournament?.name?.trim();
  const uniqueTournamentName = event.tournament?.uniqueTournament?.name?.trim();

  if (!tournamentName || !uniqueTournamentName) return tournamentName ?? null;
  if (tournamentName.localeCompare(uniqueTournamentName, undefined, { sensitivity: 'accent' }) === 0) {
    return null;
  }

  if (tournamentName.toLowerCase().startsWith(uniqueTournamentName.toLowerCase())) {
    const suffix = tournamentName
      .slice(uniqueTournamentName.length)
      .replace(/^[\s,:-]+/, '')
      .trim();
    return suffix || tournamentName;
  }

  return tournamentName;
}

function isPlaceholderTeam(team: Team): boolean {
  const values = [
    team.name,
    team.shortName,
    team.nameCode,
    team.slug,
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);

  return values.some((value) => {
    const normalized = value.trim();
    const compact = normalized.toLowerCase().replace(/[^a-z0-9/]+/g, '');
    const slugLike = normalized.toLowerCase().replace(/[^a-z0-9/-]+/g, '-');

    return PLACEHOLDER_LABEL_PATTERN.test(normalized)
      || PLACEHOLDER_PREFIX_PATTERN.test(normalized)
      || /^(winner|runner-up|runnerup|loser|qualified|qualifier|tbd|tba|tbc)-/i.test(slugLike)
      || /^(third|3rd|best)\b/i.test(normalized)
      || PLACEHOLDER_BRACKET_REFERENCE_PATTERN.test(compact)
      || PLACEHOLDER_MATCH_REFERENCE_PATTERN.test(compact)
      || PLACEHOLDER_GROUP_RANK_PATTERN.test(compact)
      || PLACEHOLDER_SINGLE_SLOT_PATTERN.test(compact)
      || PLACEHOLDER_SLASH_SLOT_PATTERN.test(compact);
  });
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

function buildPhaseDisplayName(competitionLabel: string | null, phaseName: string): string {
  if (!competitionLabel) return phaseName;

  const normalizedCompetition = slugifyText(competitionLabel);
  const normalizedPhase = slugifyText(phaseName);

  if (!normalizedCompetition || normalizedCompetition === normalizedPhase) {
    return phaseName;
  }
  if (normalizedCompetition.includes(normalizedPhase)) {
    return competitionLabel;
  }

  return `${competitionLabel} - ${phaseName}`;
}

function isLeaguePhaseLabel(value: string | null | undefined): boolean {
  if (!value) return false;
  return LEAGUE_PHASE_LABEL_PATTERN.test(value.trim());
}

function parseGroupSection(value: string | null | undefined): { code: string; label: string; sortOrder: number } | null {
  if (!value) return null;
  const match = value.trim().match(GROUP_PHASE_PATTERN);
  if (!match) return null;

  const groupCode = match[2].toUpperCase();
  const sortOrder = /^\d+$/.test(groupCode)
    ? Number(groupCode)
    : groupCode.charCodeAt(0);

  return {
    code: groupCode,
    label: `Gruppo ${groupCode}`,
    sortOrder,
  };
}

function parseQualificationRound(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = value.trim().match(QUALIFICATION_ROUND_PATTERN);
  return match ? Number(match[1]) : null;
}

function isPlainQualificationLabel(value: string | null | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim();
  return /\bqualif/i.test(normalized) && !/play-?off/i.test(normalized) && parseQualificationRound(normalized) == null;
}

function derivePhaseGrouping(
  name: string,
  key: string,
  competitionLabel: string | null,
  hasSpecialPhases: boolean,
): PhaseGrouping {
  const normalizedName = name.trim();
  const normalizedKey = key.trim();
  const competitionGroup = parseGroupSection(competitionLabel);
  const phaseGroup = parseGroupSection(normalizedName) ?? parseGroupSection(normalizedKey);
  const groupSection = competitionGroup ?? phaseGroup;
  if (groupSection) {
    return {
      phaseKey: LEAGUE_PHASE_KEY,
      phaseName: LEAGUE_PHASE_NAME,
      sectionKey: `group-${slugifyText(groupSection.code)}`,
      sectionLabel: groupSection.label,
      sectionSortOrder: groupSection.sortOrder,
      phaseNamespaceLabel: null,
    };
  }

  const competitionQualificationRound = parseQualificationRound(competitionLabel);
  const phaseQualificationRound = parseQualificationRound(normalizedName) ?? parseQualificationRound(normalizedKey);
  const qualificationRound = competitionQualificationRound ?? phaseQualificationRound;
  if (qualificationRound != null) {
    return {
      phaseKey: QUALIFICATION_KEY,
      phaseName: QUALIFICATION_NAME,
      sectionKey: `qualification-round-${qualificationRound}`,
      sectionLabel: `Round ${qualificationRound}`,
      sectionSortOrder: qualificationRound,
      phaseNamespaceLabel: null,
    };
  }

  if (
    isLeaguePhaseLabel(competitionLabel)
    || isLeaguePhaseLabel(normalizedName)
    || isLeaguePhaseLabel(normalizedKey)
  ) {
    return {
      phaseKey: LEAGUE_PHASE_KEY,
      phaseName: LEAGUE_PHASE_NAME,
      sectionKey: null,
      sectionLabel: null,
      sectionSortOrder: 0,
      phaseNamespaceLabel: null,
    };
  }

  if (
    isPlainQualificationLabel(competitionLabel)
    || isPlainQualificationLabel(normalizedName)
    || isPlainQualificationLabel(normalizedKey)
  ) {
    return {
      phaseKey: QUALIFICATION_KEY,
      phaseName: QUALIFICATION_NAME,
      sectionKey: null,
      sectionLabel: null,
      sectionSortOrder: 0,
      phaseNamespaceLabel: null,
    };
  }

  if (hasSpecialPhases && isGenericRoundName(normalizedName)) {
    return {
      phaseKey: LEAGUE_PHASE_KEY,
      phaseName: LEAGUE_PHASE_NAME,
      sectionKey: null,
      sectionLabel: null,
      sectionSortOrder: 0,
      phaseNamespaceLabel: null,
    };
  }

  return {
    phaseKey: normalizedKey,
    phaseName: normalizedName,
    sectionKey: null,
    sectionLabel: null,
    sectionSortOrder: 0,
    phaseNamespaceLabel: competitionLabel,
  };
}

function isCompactSinglePhaseCup(phase: TournamentPhase): boolean {
  const uniqueTeamCount = phase.teams.length;
  const eventCount = phase.events.length;
  if (uniqueTeamCount < 2 || uniqueTeamCount > 16) return false;
  if (eventCount < 1 || eventCount > uniqueTeamCount) return false;

  const timestamps = phase.events.map((event) => event.startTimestamp);
  const minTimestamp = Math.min(...timestamps);
  const maxTimestamp = Math.max(...timestamps);
  const spanDays = (maxTimestamp - minTimestamp) / (60 * 60 * 24);

  return spanDays <= 45;
}

export function buildTournamentPhases(events: MatchEvent[]): TournamentPhase[] {
  const normalizedPhases = events.map((event) => ({
    event,
    name: normalizePhaseName(event),
    key: normalizePhaseKey(event, normalizePhaseName(event)),
    competitionLabel: getPhaseCompetitionLabel(event),
  }));

  const hasSpecialPhases = normalizedPhases.some(({ name, key }) => (
    isSpecialPhaseName(name) || isSpecialPhaseName(key)
  ));

  const phaseMap = new Map<string, TournamentPhase>();
  const phaseSectionsMap = new Map<string, Map<string, PhaseSectionAccumulator>>();

  normalizedPhases.forEach(({ event, name, key, competitionLabel }) => {
    const grouping = derivePhaseGrouping(name, key, competitionLabel, hasSpecialPhases);
    const effectiveKey = grouping.phaseKey;
    const effectiveName = grouping.phaseName;
    const phaseGroupKey = grouping.phaseNamespaceLabel
      ? `${slugifyText(grouping.phaseNamespaceLabel)}::${effectiveKey}`
      : effectiveKey;
    const displayName = buildPhaseDisplayName(grouping.phaseNamespaceLabel, effectiveName);
    const existing = phaseMap.get(phaseGroupKey);
    const teamsMap = new Map<number, Team>();
    const sectionMap = phaseSectionsMap.get(phaseGroupKey) ?? new Map<string, PhaseSectionAccumulator>();

    if (existing) {
      existing.teams.forEach((team) => teamsMap.set(team.id, team));
      existing.events.push(event);
      if (!isPlaceholderTeam(event.homeTeam)) {
        teamsMap.set(event.homeTeam.id, event.homeTeam);
      }
      if (!isPlaceholderTeam(event.awayTeam)) {
        teamsMap.set(event.awayTeam.id, event.awayTeam);
      }
      existing.teams = [...teamsMap.values()].sort((a, b) => a.name.localeCompare(b.name, 'it'));
      existing.sortTimestamp = Math.max(existing.sortTimestamp, event.startTimestamp);
    } else {
      if (!isPlaceholderTeam(event.homeTeam)) {
        teamsMap.set(event.homeTeam.id, event.homeTeam);
      }
      if (!isPlaceholderTeam(event.awayTeam)) {
        teamsMap.set(event.awayTeam.id, event.awayTeam);
      }
      phaseMap.set(phaseGroupKey, {
        key: phaseGroupKey,
        name: displayName,
        events: [event],
        teams: [...teamsMap.values()].sort((a, b) => a.name.localeCompare(b.name, 'it')),
        standings: [],
        sections: [],
        sortTimestamp: event.startTimestamp,
      });
    }

    if (grouping.sectionKey && grouping.sectionLabel) {
      const existingSection = sectionMap.get(grouping.sectionKey);
      const sectionTeamsMap = new Map<number, Team>();

      if (existingSection) {
        existingSection.teams.forEach((team) => sectionTeamsMap.set(team.id, team));
        existingSection.events.push(event);
        existingSection.sortTimestamp = Math.max(existingSection.sortTimestamp, event.startTimestamp);
      }

      if (!isPlaceholderTeam(event.homeTeam)) {
        sectionTeamsMap.set(event.homeTeam.id, event.homeTeam);
      }
      if (!isPlaceholderTeam(event.awayTeam)) {
        sectionTeamsMap.set(event.awayTeam.id, event.awayTeam);
      }

      const section: PhaseSectionAccumulator = existingSection ?? {
        key: grouping.sectionKey,
        label: grouping.sectionLabel,
        teams: [],
        standings: [],
        events: [],
        sortTimestamp: event.startTimestamp,
        sortOrder: grouping.sectionSortOrder,
      };
      section.teams = [...sectionTeamsMap.values()].sort((a, b) => a.name.localeCompare(b.name, 'it'));

      if (!existingSection) {
        section.events.push(event);
      }

      sectionMap.set(grouping.sectionKey, section);
      phaseSectionsMap.set(phaseGroupKey, sectionMap);
    }
  });

  const phases = [...phaseMap.values()].map((phase) => {
    const sectionMap = phaseSectionsMap.get(phase.key);
    const sections = sectionMap
      ? [...sectionMap.values()]
        .filter((section) => section.teams.length > 0)
        .sort((a, b) => {
          if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
          return a.label.localeCompare(b.label, 'it');
        })
        .map<TournamentPhaseSection>((section) => ({
        key: section.key,
        label: section.label,
        teams: section.teams,
        standings: [],
        events: section.events,
        sortTimestamp: section.sortTimestamp,
      }))
      : [];

    return {
      ...phase,
      sections,
    };
  });

  return phases.sort((a, b) => {
    if (b.sortTimestamp !== a.sortTimestamp) {
      return b.sortTimestamp - a.sortTimestamp;
    }
    return a.name.localeCompare(b.name, 'it');
  });
}

export function isPhaseBasedCompetition(phases: TournamentPhase[]): boolean {
  if (phases.length < 1) return false;
  if (phases.some((phase) => isSpecialPhaseName(phase.name) || isSpecialPhaseName(phase.key))) {
    return true;
  }
  if (phases.length !== 1) return false;
  return isCompactSinglePhaseCup(phases[0]);
}
