import { useNavigation } from '@/context/NavigationContext';
import { useShotPrediction } from '@/hooks/useShotPrediction';
import type { MatchupSection } from '@/types';
import MatchupView from './MatchupView';
import ShotPredictionsView from './ShotPredictionsView';

interface MatchupPageProps {
  eventId: number;
  homeTeamId: number;
  homeTeamName: string;
  awayTeamId: number;
  awayTeamName: string;
  leagueId?: number;
  leagueName?: string;
  seasonId?: number;
  seasonYear?: string;
  section: MatchupSection;
}

export default function MatchupPage(props: MatchupPageProps) {
  const { state, updateMatchupAverageSelection } = useNavigation();
  const predictionState = useShotPrediction(props.eventId, props.section === 'predictions');
  const panel = state.panels[0];

  if (props.section === 'formations') {
    return (
      <MatchupView
        eventId={props.eventId}
        homeTeamId={props.homeTeamId}
        homeTeamName={props.homeTeamName}
        awayTeamId={props.awayTeamId}
        awayTeamName={props.awayTeamName}
        leagueId={props.leagueId}
        leagueName={props.leagueName}
        seasonId={props.seasonId}
        seasonYear={props.seasonYear}
      />
    );
  }

  return (
    <ShotPredictionsView
      key={props.eventId}
      eventId={props.eventId}
      homeTeamId={props.homeTeamId}
      homeTeamName={props.homeTeamName}
      awayTeamId={props.awayTeamId}
      awayTeamName={props.awayTeamName}
      leagueId={props.leagueId}
      leagueName={props.leagueName}
      seasonId={props.seasonId}
      seasonYear={props.seasonYear}
      predictionState={predictionState}
      homeAverageSelection={panel.homeShotAverageSelection ?? {
        competitionId: props.leagueId,
        seasonId: props.seasonId,
        venue: 'home',
      }}
      awayAverageSelection={panel.awayShotAverageSelection ?? {
        competitionId: props.leagueId,
        seasonId: props.seasonId,
        venue: 'away',
      }}
      onHomeAverageSelectionChange={(selection) => updateMatchupAverageSelection('home', selection)}
      onAwayAverageSelectionChange={(selection) => updateMatchupAverageSelection('away', selection)}
    />
  );
}
