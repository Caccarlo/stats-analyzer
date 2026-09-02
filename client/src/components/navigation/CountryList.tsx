import { useEffect, useMemo, useState } from 'react';
import { getCategories, getCategoryImageUrl } from '@/api/sofascore';
import { useNavigation } from '@/context/NavigationContext';
import type { Category, CountryConfig } from '@/types';

const TOP_COUNTRIES: CountryConfig[] = [
  {
    id: 'IT',
    name: 'Italia',
    categoryId: 31,
  },
  {
    id: 'EN',
    name: 'Inghilterra',
    categoryId: 1,
  },
  {
    id: 'ES',
    name: 'Spagna',
    categoryId: 32,
  },
  {
    id: 'DE',
    name: 'Germania',
    categoryId: 30,
  },
  {
    id: 'FR',
    name: 'Francia',
    categoryId: 7,
  },
  {
    id: 'EU',
    name: 'Europa',
    categoryId: 1465,
  },
  {
    id: 'WO',
    name: 'World',
    categoryId: 1468,
  },
];

function CountryButton({
  name,
  categoryId,
  isActive,
  onClick,
}: {
  name: string;
  categoryId: number;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`
        w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors text-left
        ${isActive
          ? 'text-neon border-l-2 border-neon bg-neon/5'
          : 'text-text-secondary hover:text-text-primary hover:bg-surface-hover border-l-2 border-transparent'
        }
      `}
    >
      <img
        src={getCategoryImageUrl(categoryId)}
        alt=""
        className="w-5 h-5 object-contain"
        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
      />
      <span className="font-medium">{name}</span>
    </button>
  );
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Errore nel caricamento dei paesi';
}

export default function CountryList({
  panelIndex = 0,
  scrollOnlyOthers = false,
}: {
  panelIndex?: number;
  scrollOnlyOthers?: boolean;
}) {
  const { state, selectCountry } = useNavigation();
  const panel = state.panels[panelIndex];
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        setError(null);
        const allCategories = await getCategories();
        if (!cancelled) {
          setCategories(allCategories);
        }
      } catch (e: unknown) {
        if (!cancelled) {
          setError(getErrorMessage(e));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const topCategoryIds = useMemo(
    () => new Set(TOP_COUNTRIES.map((country) => country.categoryId)),
    [],
  );

  const otherCategories = useMemo(
    () => categories
      .filter((category) => !topCategoryIds.has(category.id))
      .sort((a, b) => a.name.localeCompare(b.name, 'it')),
    [categories, topCategoryIds],
  );

  return (
    <div className={`py-2 ${scrollOnlyOthers ? 'flex h-full min-h-0 flex-col' : ''}`}>
      <div className={scrollOnlyOthers ? 'shrink-0 bg-bg-sidebar pb-2' : 'sticky top-0 z-10 bg-bg'}>
        {TOP_COUNTRIES.map((country) => (
          <CountryButton
            key={country.id}
            name={country.name}
            categoryId={country.categoryId}
            isActive={panel.countryCategoryId === country.categoryId}
            onClick={() => selectCountry(panelIndex, country.id, country.name, country.categoryId)}
          />
        ))}

        <hr className="my-2 mx-4 border-border" />
      </div>

      <div className={scrollOnlyOthers ? 'min-h-0 flex-1 overflow-y-auto' : ''}>
        {loading && (
          <div className="px-4 py-2 text-sm text-text-muted">Caricamento paesi...</div>
        )}

        {!loading && error && (
          <div className="px-4 py-2 text-sm text-negative">Errore: {error}</div>
        )}

        {!loading && !error && otherCategories.map((category) => (
          <CountryButton
            key={category.id}
            name={category.name}
            categoryId={category.id}
            isActive={panel.countryCategoryId === category.id}
            onClick={() => selectCountry(panelIndex, String(category.id), category.name, category.id)}
          />
        ))}
      </div>
    </div>
  );
}
