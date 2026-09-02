import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { NavigationProvider } from '@/context/NavigationContext';
import type { ShotPredictionState } from '@/hooks/useShotPrediction';
import type { ShotPrediction } from '@/types';
import ShotPredictionsView from './ShotPredictionsView';

const catalog = {
  teamId: 1,
  competitions: [
    { id: 23, name: 'Serie A', seasons: [{ id: 101, name: '2025/26', year: '2025/26' }] },
    { id: 7, name: 'Champions League', seasons: [{ id: 201, name: '2024/25', year: '2024/25' }] },
  ],
};

vi.mock('@/api/predictions', () => ({
  getTeamShotAverageCatalog: vi.fn(async (teamId: number) => ({ ...catalog, teamId })),
  getTeamShotAverages: vi.fn(async (teamId: number, competitionId: number, seasonId: number, venue: string) => ({
    status: 'ready',
    teamId,
    competitionId,
    seasonId,
    venue,
    matches: 10,
    excludedMissing: 0,
    shotsFor: 12,
    shotsAgainst: 9,
    totalShots: 21,
  })),
  getShotPredictionDetails: vi.fn(),
}));

const prediction: ShotPrediction = {
  eventId: 999,
  modelVersion: 'shots-v1.4.0-football-data-transitions',
  generatedAt: '2026-08-30T10:00:00.000Z',
  cutoffTimestamp: 1_800_000_000,
  cutoffIso: '2027-01-15T08:00:00.000Z',
  competition: { id: 23, name: 'Serie A' },
  season: { id: 101, name: '2025/26', year: '2025/26' },
  homeTeam: { id: 1, name: 'Casa FC' },
  awayTeam: { id: 2, name: 'Ospiti FC' },
  expected: { home: 14.2, away: 10.7, total: 24.9, interval80: [18, 33] },
  distribution: { type: 'poisson' },
  mainLine: 24.5,
  markets: Array.from({ length: 7 }, (_, index) => {
    const line = 21.5 + index;
    const underProbability = 0.3 + index * 0.07;
    return {
      line,
      underProbability,
      underFairOdds: 1 / underProbability,
      overProbability: 1 - underProbability,
      overFairOdds: 1 / (1 - underProbability),
      isMain: line === 24.5,
    };
  }),
  diagnostics: {
    baseline: { home: 13, away: 11 },
    ratings: {
      homeAttack: { raw: 1.1, value: 1.05, nEff: 9 },
      homeVulnerability: { raw: 1, value: 1, nEff: 9 },
      awayAttack: { raw: 0.9, value: 0.95, nEff: 8 },
      awayVulnerability: { raw: 1, value: 1, nEff: 8 },
    },
    betaAttack: 1,
    betaDefense: 1,
    halfLifeDays: 180,
    shrinkageMatches: 10,
    effectiveSample: { home: 9, away: 8, league: 150 },
    strength: { difference: 0.2, selectedTerm: 'none', homeLogAdjustment: 0, awayLogAdjustment: 0, retained: false },
    backtest: { sampleSize: 60, nll: 3.1, mae: 5.2, calibrationError: 0.02 },
    matchesUsed: 700,
    latestObservationTimestamp: 1_790_000_000,
    missingStatisticsExcluded: 2,
    seasonsUsed: [{ id: 101, name: '2025/26' }],
    competitionTransition: {
      applied: false,
      direction: 'none',
      uncertaintyShots: 0,
      note: 'Nessuna correzione.',
      teams: [],
    },
    warnings: [],
  },
};

const predictionState: ShotPredictionState = {
  status: 'ready',
  prediction,
  progress: null,
  error: null,
  retry: vi.fn(),
};

test('le medie partono solo su richiesta e i selettori restano indipendenti', async () => {
  const onHomeChange = vi.fn();
  const onAwayChange = vi.fn();
  render(
    <NavigationProvider>
      <ShotPredictionsView
        eventId={999}
        homeTeamId={1}
        homeTeamName="Casa FC"
        awayTeamId={2}
        awayTeamName="Ospiti FC"
        leagueId={23}
        leagueName="Serie A"
        seasonId={101}
        seasonYear="2025/26"
        predictionState={predictionState}
        homeAverageSelection={{ competitionId: 23, seasonId: 101, venue: 'home' }}
        awayAverageSelection={{ competitionId: 23, seasonId: 101, venue: 'away' }}
        onHomeAverageSelectionChange={onHomeChange}
        onAwayAverageSelectionChange={onAwayChange}
      />
    </NavigationProvider>,
  );

  expect(screen.queryByLabelText('Competizione')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Carica medie' }));
  await waitFor(() => expect(screen.getAllByLabelText('Competizione')).toHaveLength(2));
  fireEvent.change(screen.getAllByLabelText('Competizione')[0], { target: { value: '7' } });

  expect(onHomeChange).toHaveBeenCalledWith({ competitionId: 7, seasonId: 201, venue: 'home' });
  expect(onAwayChange).not.toHaveBeenCalled();
});

test('mostra in modo esplicito la coorte reale usata per un cambio di categoria', () => {
  const transitionedPrediction: ShotPrediction = {
    ...prediction,
    diagnostics: {
      ...prediction.diagnostics,
      competitionTransition: {
        applied: true,
        direction: 'promotion',
        uncertaintyShots: 1.1,
        note: 'Rating trasferito dalla Championship.',
        teams: [{
          teamId: 'ipswich',
          teamName: 'Ipswich Town',
          applied: true,
          direction: 'promotion',
          sourceCompetition: { id: 18, name: 'Championship', tier: 2 },
          targetCompetition: { id: 17, name: 'Premier League', tier: 1 },
          sourceSeason: { id: 2025, name: '2025/26', year: '2025/26' },
          sourceMatches: { home: 23, away: 23 },
          sourceSufficient: true,
          sourceRatings: { homeAttack: 1.1 },
          transitionFactors: { homeAttack: 0.9 },
          transferredRatings: { homeAttack: 0.99 },
          equivalentMatches: 10,
          cohortSize: 13,
          cohortSeasons: 5,
          calibrationSeasons: [2021, 2022, 2023, 2024, 2025],
          effectRetained: true,
          relativeStandardError: 0.04,
        }],
      },
    },
  };
  render(
    <NavigationProvider>
      <ShotPredictionsView
        eventId={999}
        homeTeamId={1}
        homeTeamName="Ipswich Town"
        awayTeamId={2}
        awayTeamName="Liverpool FC"
        leagueId={17}
        leagueName="Premier League"
        seasonId={101}
        seasonYear="2025/26"
        predictionState={{ ...predictionState, prediction: transitionedPrediction }}
        homeAverageSelection={{ competitionId: 17, seasonId: 101, venue: 'home' }}
        awayAverageSelection={{ competitionId: 17, seasonId: 101, venue: 'away' }}
        onHomeAverageSelectionChange={vi.fn()}
        onAwayAverageSelectionChange={vi.fn()}
      />
    </NavigationProvider>,
  );

  expect(screen.getByLabelText('Correzioni per cambio di categoria')).toHaveTextContent('13 passaggi reali in 5 stagioni');
  expect(screen.getByText(/Championship → Premier League/)).toBeInTheDocument();
});
