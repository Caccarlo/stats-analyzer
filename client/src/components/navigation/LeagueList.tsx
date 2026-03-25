import { useNavigation } from '@/context/NavigationContext';
import { COUNTRIES } from './CountryList';
import { getTournamentImageUrl } from '@/api/sofascore';

interface LeagueListProps {
  countryId: string;
}

export default function LeagueList({ countryId }: LeagueListProps) {
  const { selectLeague } = useNavigation();
  const country = COUNTRIES.find((c) => c.id === countryId);

  if (!country) return null;

  return (
    <div>
      <h2 className="text-lg font-bold text-text-primary mb-4">{country.name}</h2>
      <div className="space-y-2">
        {country.leagues.map((league) => (
          <button
            key={league.id}
            onClick={() => selectLeague(0, league.id, league.name)}
            className="w-full flex items-center gap-3 bg-surface border border-border rounded-lg p-4 hover:border-neon transition-colors text-left"
          >
            <img
              src={getTournamentImageUrl(league.id)}
              alt=""
              className="w-8 h-8 object-contain"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
            <span className="text-text-primary font-medium">{league.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
