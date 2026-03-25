import CountryList from '@/components/navigation/CountryList';

export default function HomePage({ panelIndex = 0 }: { panelIndex?: number }) {
  return (
    <div>
      {panelIndex > 0 ? (
        <div className="mt-4">
          <p className="text-text-secondary text-sm mb-3 px-4">Seleziona un paese per iniziare:</p>
          <CountryList panelIndex={panelIndex} />
        </div>
      ) : (
        <div className="mt-4 text-center">
          <p className="text-text-secondary text-sm">
            Seleziona un paese dal pannello a sinistra oppure cerca un giocatore dalla barra di ricerca.
          </p>
        </div>
      )}
    </div>
  );
}
