import { useNavigation } from '@/context/NavigationContext';
import type { CountryConfig } from '@/types';

export const COUNTRIES: CountryConfig[] = [
  {
    id: 'IT',
    name: 'Italia',
    categoryId: 31,
    leagues: [
      { id: 23, name: 'Serie A' },
      { id: 53, name: 'Serie B' },
    ],
  },
  {
    id: 'EN',
    name: 'Inghilterra',
    categoryId: 1,
    leagues: [
      { id: 17, name: 'Premier League' },
      { id: 18, name: 'Championship' },
    ],
  },
  {
    id: 'ES',
    name: 'Spagna',
    categoryId: 32,
    leagues: [
      { id: 8, name: 'La Liga' },
      { id: 54, name: 'La Liga 2' },
    ],
  },
  {
    id: 'DE',
    name: 'Germania',
    categoryId: 30,
    leagues: [
      { id: 35, name: 'Bundesliga' },
      { id: 44, name: '2. Bundesliga' },
    ],
  },
  {
    id: 'FR',
    name: 'Francia',
    categoryId: 7,
    leagues: [
      { id: 34, name: 'Ligue 1' },
      { id: 182, name: 'Ligue 2' },
    ],
  },
  {
    id: 'EU',
    name: 'Europa',
    categoryId: 1465,
    leagues: [
      { id: 7, name: 'Champions League' },
      { id: 679, name: 'Europa League' },
      { id: 17015, name: 'Conference League' },
      { id: 341, name: 'Supercoppa UEFA' },
    ],
  },
];

export default function CountryList({ panelIndex = 0 }: { panelIndex?: number }) {
  const { state, selectCountry } = useNavigation();
  const panel = state.panels[panelIndex];

  return (
    <div className="py-2">
      {COUNTRIES.map((country) => {
        const isActive = panel.countryId === country.id;
        return (
          <button
            key={country.id}
            onClick={() => selectCountry(panelIndex, country.id, country.name)}
            className={`
              w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors text-left
              ${isActive
                ? 'text-neon border-l-2 border-neon bg-neon/5'
                : 'text-text-secondary hover:text-text-primary hover:bg-surface-hover border-l-2 border-transparent'
              }
            `}
          >
            <span className="font-mono text-xs w-5 text-center opacity-60">{country.id}</span>
            <span className="font-medium">{country.name}</span>
          </button>
        );
      })}
    </div>
  );
}
