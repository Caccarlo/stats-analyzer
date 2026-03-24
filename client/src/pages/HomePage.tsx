import SearchBar from '@/components/layout/SearchBar';

export default function HomePage() {
  return (
    <div>
      <SearchBar />
      <div className="mt-8">
        <p className="text-text-secondary">
          Seleziona un paese dal pannello a sinistra oppure cerca un giocatore dalla barra di ricerca.
        </p>
      </div>
    </div>
  );
}
