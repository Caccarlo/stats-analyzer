import { useState, useEffect, useMemo } from 'react';
import { useNavigation } from '@/context/NavigationContext';
import type { MatchEvent, Player, FoulMatchup, PlayerPosition } from '@/types';
import type { CachedMatchDetails } from '@/hooks/useMatchDetails';
import { COUNTRIES } from '@/components/navigation/CountryList';
import FieldMap from './FieldMap';
import HeatmapField from './HeatmapField';

interface MatchCardProps {
  event: MatchEvent;
  playerId: number;
  playerTeamId?: number;
  showCommitted: boolean;
  showSuffered: boolean;
  panelIndex?: number;
  detailsMap: Map<number, CachedMatchDetails>;
  filteredEvents: MatchEvent[];
  onDeselect: (eventId: number) => void;
}

export default function MatchCard({
  event,
  playerId,
  playerTeamId,
  showCommitted,
  showSuffered,
  panelIndex = 0,
  detailsMap,
  filteredEvents,
  onDeselect,
}: MatchCardProps) {
  const { openSplitPlayer, swapSplitAndOpenPlayer, selectPlayer } = useNavigation();

  const [activePlayerId, setActivePlayerId] = useState(playerId);

  useEffect(() => {
    setActivePlayerId(playerId);
  }, [playerId]);

  // Deriva details direttamente dalla map
  const details = detailsMap.get(event.id);

  const fouls = details?.fouls ?? [];
  const positions = details?.positions ?? null;
  const substituteInMinute = details?.substituteInMinute;
  const substituteOutMinute = details?.substituteOutMinute;

  const isHome = event.homeTeam.id === playerTeamId;

  const activeIsHome = positions
    ? positions.home.some((p: PlayerPosition) => p.player.id === activePlayerId)
    : isHome;

  const date = new Date(event.startTimestamp * 1000);
  const dateStr = date.toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' });

  const committedFouls = fouls.filter((f) => f.type === 'committed' || f.type === 'handball');
  const sufferedFouls = fouls.filter((f) => f.type === 'suffered');

  const visibleFouls: FoulMatchup[] = [
    ...(showCommitted ? committedFouls : []),
    ...(showSuffered ? sufferedFouls : []),
  ];

  const involvedPlayerIds = new Set<number>();
  fouls.forEach((f) => {
    if (f.playerFouled?.id) involvedPlayerIds.add(f.playerFouled.id);
    if (f.playerFouling?.id) involvedPlayerIds.add(f.playerFouling.id);
  });

  const isDesktop = typeof window !== 'undefined' && window.innerWidth >= 1024;

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
        swapSplitAndOpenPlayer(player, player.team?.id, player.team?.name, navContext);
      } else {
        openSplitPlayer(player, player.team?.id, player.team?.name, navContext);
      }
    } else {
      selectPlayer(0, player.id, player);
    }
  };

  const abbreviateName = (name: string) => {
    const parts = name.trim().split(/\s+/);
    if (parts.length <= 1) return name;
    return `${parts[0][0]}. ${parts.slice(1).join(' ')}`;
  };

  // Giocatore attivo (per foto e nome sopra heatmap)
  const activePlayer = useMemo(() => {
    if (!positions) return null;
    return (
      positions.home.find((p: PlayerPosition) => p.player.id === activePlayerId)?.player ??
      positions.away.find((p: PlayerPosition) => p.player.id === activePlayerId)?.player ??
      null
    );
  }, [positions, activePlayerId]);

  // Medie falli del giocatore attivo su tutte le partite filtrate caricate
  const activePlayerStats = useMemo(() => {
    let committed = 0;
    let suffered = 0;
    let matchCount = 0;

    for (const ev of filteredEvents) {
      const d = detailsMap.get(ev.id);
      if (!d) continue;
      matchCount++;
      d.fouls.forEach((f) => {
        if (f.playerFouling?.id === activePlayerId) committed++;
        if (f.playerFouled?.id === activePlayerId) suffered++;
      });
    }

    return {
      matchCount,
      committedPerGame: matchCount > 0 ? committed / matchCount : 0,
      sufferedPerGame: matchCount > 0 ? suffered / matchCount : 0,
    };
  }, [activePlayerId, filteredEvents, detailsMap]);

  const renderFoul = (f: FoulMatchup, i: number) => (
    <div key={i} className="text-sm text-text-secondary py-0.5">
      {f.type === 'handball' ? (
        <span>
          {f.minute != null && <span className="text-text-muted">{f.minute}' </span>}
          Fallo di mano
          {f.zoneText && <span className="text-text-muted"> {f.zoneText}</span>}
        </span>
      ) : f.type === 'suffered' ? (
        <span>
          {f.minute != null && <span className="text-text-muted">{f.minute}' </span>}
          {f.playerFouling ? (
            <>
              da{' '}
              <button onClick={() => f.playerFouling && handlePlayerClick(f.playerFouling)} className="text-neon hover:underline">
                {abbreviateName(f.playerFouling.name)}
              </button>
            </>
          ) : 'punizione conquistata'}
          {f.zoneText && <span className="text-text-muted"> {f.zoneText}</span>}
        </span>
      ) : (
        <span>
          {f.minute != null && <span className="text-text-muted">{f.minute}' </span>}
          {f.playerFouled ? (
            <>
              su{' '}
              <button onClick={() => f.playerFouled && handlePlayerClick(f.playerFouled)} className="text-neon hover:underline">
                {abbreviateName(f.playerFouled.name)}
              </button>
            </>
          ) : 'fallo commesso'}
          {f.zoneText && <span className="text-text-muted"> {f.zoneText}</span>}
        </span>
      )}
    </div>
  );

  const showTwoColumns = showCommitted && showSuffered;

  return (
    <div className="bg-surface border border-border rounded-lg overflow-hidden h-full w-full flex flex-col">
      {/* Header */}
      <div className="flex items-start justify-between px-4 py-3">
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
        </div>
        <div className="text-xs text-text-muted text-right flex-shrink-0 mx-2">
          <p>{substituteInMinute != null ? `Entrato al ${substituteInMinute}'` : 'Titolare'}</p>
          {substituteOutMinute != null && (
            <p>Uscito al {substituteOutMinute}'</p>
          )}
        </div>
        <button
          onClick={() => onDeselect(event.id)}
          className="flex-shrink-0 p-1 text-text-muted hover:text-text-primary transition-colors"
          title="Rimuovi"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Content */}
      <div className="px-4 pb-4 border-t border-border pt-3 flex-1">
        {!details ? (
          <div className="flex items-center gap-2 text-text-muted text-sm">
            <div className="w-3 h-3 border-2 border-neon border-t-transparent rounded-full animate-spin" />
            Caricamento dettagli...
          </div>
        ) : (
          <>
            {positions ? (
              <div className="grid grid-cols-2 gap-3 mb-7 items-stretch pt-3">
                {/* Colonna sinistra: FieldMap */}
                <div className="flex justify-center">
                  <FieldMap
                    homePositions={positions.home}
                    awayPositions={positions.away}
                    selectedPlayerId={playerId}
                    activePlayerId={activePlayerId}
                    involvedPlayerIds={involvedPlayerIds}
                    onActivePlayerChange={setActivePlayerId}
                  />
                </div>
                {/* Colonna destra: giocatore attivo + medie + heatmap */}
                <div className="relative flex items-center justify-center">
                  {/* Testo in alto, allineato al top del FieldMap */}
                  <div className="absolute top-0 left-0 right-0 flex flex-col items-center gap-1">
                    {activePlayer && (
                      <div className="flex items-center gap-2 w-full justify-center">
                        <img
                          src={`https://api.sofascore.com/api/v1/player/${activePlayerId}/image`}
                          alt={activePlayer.name}
                          className="w-7 h-7 rounded-full object-cover bg-surface-2"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                        />
                        <span className="text-sm text-text-primary font-medium truncate max-w-[100px]">
                          {abbreviateName(activePlayer.name)}
                        </span>
                      </div>
                    )}
                    <div className="w-full grid grid-cols-2 gap-1 px-10 mt-1">
                      {(showSuffered || (!showCommitted && !showSuffered)) && (
                        <>
                          <div className="bg-surface border border-border rounded px-2 py-0.5 flex items-center justify-between">
                            <p className="text-text-muted text-[9px] uppercase tracking-wide">Comm./p</p>
                            <p className="text-negative text-xs font-bold">—</p>
                          </div>
                          <div className="bg-surface border border-border rounded px-2 py-0.5 flex items-center justify-between">
                            <p className="text-text-muted text-[9px] uppercase tracking-wide">Comm./90</p>
                            <p className="text-negative text-xs font-bold">—</p>
                          </div>
                        </>
                      )}
                      {(showCommitted || (!showCommitted && !showSuffered)) && (
                        <>
                          <div className="bg-surface border border-border rounded px-2 py-0.5 flex items-center justify-between">
                            <p className="text-text-muted text-[9px] uppercase tracking-wide">Sub./p</p>
                            <p className="text-neon text-xs font-bold">—</p>
                          </div>
                          <div className="bg-surface border border-border rounded px-2 py-0.5 flex items-center justify-between">
                            <p className="text-text-muted text-[9px] uppercase tracking-wide">Sub./90</p>
                            <p className="text-neon text-xs font-bold">—</p>
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Heatmap centrata verticalmente */}
                  <HeatmapField
                    eventId={event.id}
                    playerId={activePlayerId}
                    isHome={activeIsHome}
                  />
                </div>
              </div>
            ) : (
              <div className="text-xs text-text-secondary mb-3 text-center">
                <span>{substituteInMinute != null ? `Entrato al ${substituteInMinute}'` : 'Titolare'}</span>
                {substituteOutMinute != null && (
                  <span> · Uscito al {substituteOutMinute}'</span>
                )}
              </div>
            )}

            {/* Falli */}
            {showTwoColumns ? (
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col items-center text-center">
                  <p className="text-negative text-xs font-semibold uppercase tracking-wide mb-2">
                    Falli commessi ({committedFouls.length})
                  </p>
                  {committedFouls.length > 0
                    ? committedFouls.map(renderFoul)
                    : <p className="text-text-muted text-sm">Nessuno</p>
                  }
                </div>
                <div className="flex flex-col items-center text-center">
                  <p className="text-neon text-xs font-semibold uppercase tracking-wide mb-2">
                    Falli subiti ({sufferedFouls.length})
                  </p>
                  {sufferedFouls.length > 0
                    ? sufferedFouls.map(renderFoul)
                    : <p className="text-text-muted text-sm">Nessuno</p>
                  }
                </div>
              </div>
            ) : (
              <>
                {showSuffered && sufferedFouls.length > 0 && (
                  <div className="mb-3 flex flex-col items-center text-center">
                    <p className="text-neon text-xs font-semibold uppercase tracking-wide mb-2">
                      Falli subiti ({sufferedFouls.length})
                    </p>
                    {sufferedFouls.map(renderFoul)}
                  </div>
                )}
                {showCommitted && committedFouls.length > 0 && (
                  <div className="mb-3 flex flex-col items-center text-center">
                    <p className="text-negative text-xs font-semibold uppercase tracking-wide mb-2">
                      Falli commessi ({committedFouls.length})
                    </p>
                    {committedFouls.map(renderFoul)}
                  </div>
                )}
                {visibleFouls.length === 0 && (
                  <p className="text-text-muted text-sm text-center">Nessun fallo in questa partita</p>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}