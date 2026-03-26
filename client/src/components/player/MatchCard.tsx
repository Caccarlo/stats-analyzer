import { useState, useEffect } from 'react';
import { useMatchDetails } from '@/hooks/useMatchDetails';
import { useNavigation } from '@/context/NavigationContext';
import type { MatchEvent, Player, FoulMatchup } from '@/types';
import { COUNTRIES } from '@/components/navigation/CountryList';
import FieldMap from './FieldMap';

interface MatchCardProps {
  event: MatchEvent;
  playerId: number;
  playerTeamId?: number;
  showCommitted: boolean;
  showSuffered: boolean;
  defaultOpen?: boolean;
  panelIndex?: number;
}

export default function MatchCard({
  event,
  playerId,
  playerTeamId,
  showCommitted,
  showSuffered,
  defaultOpen = false,
  panelIndex = 0,
}: MatchCardProps) {
  const [open, setOpen] = useState(defaultOpen);
  const { fouls, positions, substituteInMinute, substituteOutMinute, loading } =
    useMatchDetails(event.id, playerId, open);
  const { openSplitPlayer, swapSplitAndOpenPlayer, selectPlayer } = useNavigation();

  // Determina se il giocatore è nella squadra di casa o ospite
  const isHome = event.homeTeam.id === playerTeamId;
  const opponent = isHome ? event.awayTeam : event.homeTeam;

  // Data partita
  const date = new Date(event.startTimestamp * 1000);
  const dateStr = date.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });

  // Filtra falli per tipo
  const committedFouls = fouls.filter((f) => f.type === 'committed' || f.type === 'handball');
  const sufferedFouls = fouls.filter((f) => f.type === 'suffered');

  const visibleFouls: FoulMatchup[] = [
    ...(showCommitted ? committedFouls : []),
    ...(showSuffered ? sufferedFouls : []),
  ];

  // Giocatori coinvolti nei falli (per la mappa)
  const involvedPlayerIds = new Set<number>();
  fouls.forEach((f) => {
    if (f.playerFouled?.id) involvedPlayerIds.add(f.playerFouled.id);
    if (f.playerFouling?.id) involvedPlayerIds.add(f.playerFouling.id);
  });

  const isDesktop = typeof window !== 'undefined' && window.innerWidth >= 1024;

  // Build navigation context from match tournament for back button hierarchy
  const buildNavContext = () => {
    if (!event.tournament?.uniqueTournament) return undefined;
    const leagueId = event.tournament.uniqueTournament.id;
    const leagueName = event.tournament.uniqueTournament.name;
    const country = COUNTRIES.find(c => c.leagues.some(l => l.id === leagueId));
    return {
      leagueId,
      leagueName,
      countryId: country?.id,
      countryName: country?.name,
    };
  };

  const handlePlayerClick = (player: Player) => {
    if (isDesktop) {
      const navContext = buildNavContext();
      if (panelIndex > 0) {
        // Right panel: swap current player to left, open new player on right
        swapSplitAndOpenPlayer(player, undefined, undefined, navContext);
      } else {
        openSplitPlayer(player, undefined, undefined, navContext);
      }
    } else {
      selectPlayer(0, player.id, player);
    }
  };

  // Titolarità
  const getTitularityText = () => {
    // Se abbiamo dati di sostituzione
    if (substituteInMinute != null && substituteOutMinute != null) {
      return `Entrato al ${substituteInMinute}' · Uscito al ${substituteOutMinute}'`;
    }
    if (substituteInMinute != null) {
      return `Entrato al ${substituteInMinute}'`;
    }
    if (substituteOutMinute != null) {
      return `Titolare · Uscito al ${substituteOutMinute}'`;
    }
    return 'Titolare';
  };

  return (
    <div className="bg-surface border border-border rounded-lg overflow-hidden break-inside-avoid mb-3">
      {/* Header - sempre visibile */}
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-surface-hover transition-colors text-left"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-xs text-text-muted">
            <span>{event.tournament?.name}</span>
            {event.roundInfo && <span>G.{event.roundInfo.round}</span>}
            <span>· {dateStr}</span>
          </div>
          <div className="text-text-primary font-medium mt-0.5">
            {event.homeTeam.shortName ?? event.homeTeam.name}{' '}
            <span className="text-text-muted">
              {event.homeScore.current} - {event.awayScore.current}
            </span>{' '}
            {event.awayTeam.shortName ?? event.awayTeam.name}
          </div>
          {/* Mini summary */}
          {!open && visibleFouls.length > 0 && (
            <div className="flex gap-3 mt-1 text-xs">
              {showCommitted && committedFouls.length > 0 && (
                <span className="text-negative">{committedFouls.length} commessi</span>
              )}
              {showSuffered && sufferedFouls.length > 0 && (
                <span className="text-neon">{sufferedFouls.length} subiti</span>
              )}
            </div>
          )}
        </div>
        <svg
          className={`w-4 h-4 text-text-muted transition-transform flex-shrink-0 ${open ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Corpo espandibile */}
      {open && (
        <div className="px-4 pb-4 border-t border-border pt-3">
          {loading ? (
            <div className="flex items-center gap-2 text-text-muted text-sm">
              <div className="w-3 h-3 border-2 border-neon border-t-transparent rounded-full animate-spin" />
              Caricamento dettagli...
            </div>
          ) : (
            <>
              {/* Titolarità */}
              <p className="text-text-secondary text-xs mb-3">{getTitularityText()}</p>

              {/* Falli subiti */}
              {showSuffered && sufferedFouls.length > 0 && (
                <div className="mb-3">
                  <p className="text-neon text-xs font-semibold uppercase tracking-wide mb-2">
                    Falli subiti ({sufferedFouls.length})
                  </p>
                  {sufferedFouls.map((f, i) => (
                    <div key={i} className="flex items-start gap-2 text-sm text-text-secondary py-1">
                      {f.minute != null && (
                        <span className="text-text-muted text-xs w-8 flex-shrink-0">{f.minute}'</span>
                      )}
                      <span>
                        Conquista punizione
                        {f.playerFouling && (
                          <>
                            {' da '}
                            <button
                              onClick={() => f.playerFouling && handlePlayerClick(f.playerFouling)}
                              className="text-neon hover:underline"
                            >
                              {f.playerFouling.name}
                            </button>
                          </>
                        )}
                        {f.zoneText && <span className="text-text-muted"> {f.zoneText}</span>}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Falli commessi */}
              {showCommitted && committedFouls.length > 0 && (
                <div className="mb-3">
                  <p className="text-negative text-xs font-semibold uppercase tracking-wide mb-2">
                    Falli commessi ({committedFouls.length})
                  </p>
                  {committedFouls.map((f, i) => (
                    <div key={i} className="flex items-start gap-2 text-sm text-text-secondary py-1">
                      {f.minute != null && (
                        <span className="text-text-muted text-xs w-8 flex-shrink-0">{f.minute}'</span>
                      )}
                      <span>
                        {f.type === 'handball' ? (
                          'Fallo di mano'
                        ) : (
                          <>
                            Fallo
                            {f.playerFouled && (
                              <>
                                {' su '}
                                <button
                                  onClick={() => f.playerFouled && handlePlayerClick(f.playerFouled)}
                                  className="text-neon hover:underline"
                                >
                                  {f.playerFouled.name}
                                </button>
                              </>
                            )}
                          </>
                        )}
                        {f.zoneText && <span className="text-text-muted"> {f.zoneText}</span>}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Nessun fallo */}
              {visibleFouls.length === 0 && (
                <p className="text-text-muted text-sm">Nessun fallo in questa partita</p>
              )}

              {/* Mappa campo */}
              {positions && (
                <FieldMap
                  homePositions={positions.home}
                  awayPositions={positions.away}
                  selectedPlayerId={playerId}
                  involvedPlayerIds={involvedPlayerIds}
                  onPlayerClick={handlePlayerClick}
                />
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
