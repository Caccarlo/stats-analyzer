import SearchBar from '@/components/layout/SearchBar';

export default function HomePage() {
  return (
    <div>
      <SearchBar />
      <div className="mt-4 text-center">
        <p className="text-text-secondary text-sm">
          Seleziona un paese dal pannello a sinistra oppure cerca un giocatore dalla barra di ricerca.
        </p>
      </div>
    </div>
  );
}
