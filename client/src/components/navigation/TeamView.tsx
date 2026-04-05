import { useState, useEffect } from 'react';
import { useNavigation } from '@/context/NavigationContext';
import {
  getTeamPlayers,
  getTeamNextEvent,
  getMatchLineups,
  getTeamImageUrl,
  getPlayerImageUrl,
} from '@/api/sofascore';
import { getFormationPositions } from '@/utils/positionMapping';
import { getMatchRoundLabel } from '@/utils/matchRoundLabel';
import type { Player, MatchEvent, LineupPlayer } from '@/types';

interface TeamViewProps {
  teamId: number;
  isSplit?: boolean;
  panelIndex?: number;
}

export default function TeamView({ teamId, isSplit = false, panelIndex = 0 }: TeamViewProps) {
  const { state, selectPlayer, openSplitPlayer, openSplitTeam, selectTeam, navigateTo } = useNavigation();
  const hasSplit = state.panels.length > 1;
  const panel = state.panels[panelIndex];
  const [roster, setRoster] = useState<Player[]>([]);
  const [nextEvent, setNextEvent] = useState<MatchEvent | null>(null);
  const [lineupPlayers, setLineupPlayers] = useState<LineupPlayer[]>([]);
  const [formation, setFormation] = useState('');
  const [loading, setLoading] = useState(true);
  const [teamName, setTeamName] = useState(panel?.teamName ?? '');
  const [isHome, setIsHome] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    // Resetta subito il nome quando cambia squadra
    setTeamName(panel?.teamName ?? '');
    setNextEvent(null);
    setLineupPlayers([]);
    setFormation('');

    (async () => {
      try {
        // Carica rosa e prossima partita in parallelo
        const [playersData, event] = await Promise.all([
          getTeamPlayers(teamId),
          getTeamNextEvent(teamId),
        ]);

        if (cancelled) return;

        const players = playersData.map((p) => p.player);
        setRoster(players);

        if (event) {
          setNextEvent(event);
          const eventIsHome = event.homeTeam.id === teamId;
          setIsHome(eventIsHome);
          // Ricava il nome della squadra dall'evento se non già disponibile dal panel
          if (!panel?.teamName) {
            const nameFromEvent = eventIsHome ? event.homeTeam.name : event.awayTeam.name;
            if (nameFromEvent) setTeamName(nameFromEvent);
          }

          // Carica formazione probabile
          const lineups = await getMatchLineups(event.id);
          if (!cancelled && lineups) {
            const teamLineup = event.homeTeam.id === teamId ? lineups.home : lineups.away;
            setFormation(teamLineup.formation);
            setLineupPlayers(teamLineup.players);
          }
        }
      } catch (e) {
        console.error('TeamView error:', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [teamId]);

  // Fallback: se il pannello non ha contesto league o paese, ricavalo dal torneo del prossimo evento.
  useEffect(() => {
    if (!nextEvent?.tournament?.uniqueTournament) return;
    if (panel?.leagueId && panel?.countryId) return;

    const ut = nextEvent.tournament.uniqueTournament;
    navigateTo(panelIndex, 'team', {
      leagueId: panel?.leagueId ?? ut.id,
      leagueName: panel?.leagueName ?? ut.name,
      countryId: panel?.countryId ?? ut.category?.alpha2 ?? (ut.category?.id !== undefined ? String(ut.category.id) : undefined),
      countryName: panel?.countryName ?? ut.category?.name,
      countryCategoryId: panel?.countryCategoryId ?? ut.category?.id,
      tournamentPhaseKey: panel?.tournamentPhaseKey,
      tournamentPhaseName: panel?.tournamentPhaseName,
    });
  }, [
    nextEvent,
    panel?.leagueId,
    panel?.leagueName,
    panel?.countryId,
    panel?.countryName,
    panel?.countryCategoryId,
    panel?.tournamentPhaseKey,
    panel?.tournamentPhaseName,
    panelIndex,
    navigateTo,
  ]);

  const starters = lineupPlayers.filter((p) => !p.substitute);
  const starterIds = new Set(starters.map((p) => p.player.id));
  const bench = roster.filter((p) => !starterIds.has(p.id));
  const formationPositions = formation ? getFormationPositions(formation) : [];

  const opponent = nextEvent
    ? (isHome ? nextEvent.awayTeam : nextEvent.homeTeam)
    : null;
  const roundLabel = nextEvent ? getMatchRoundLabel(nextEvent.roundInfo, 'full') : null;

  const isDesktop = typeof window !== 'undefined' && window.innerWidth >= 1024;

  const navContext = {
    leagueId: panel?.leagueId,
    leagueName: panel?.leagueName,
    countryId: panel?.countryId,
    countryName: panel?.countryName,
    countryCategoryId: panel?.countryCategoryId,
    tournamentPhaseKey: panel?.tournamentPhaseKey,
    tournamentPhaseName: panel?.tournamentPhaseName,
  };

  const handlePlayerClick = (player: Player) => {
    if (isDesktop && panelIndex === 0 && !hasSplit) {
      // Desktop panel 0, no split yet: open split with player on right
      openSplitPlayer(player, teamId, teamName, navContext);
    } else if (isDesktop && panelIndex === 0 && hasSplit && state.panels[1]?.teamId === teamId) {
      // Split with same team (team + teammate): replace player on right
      openSplitPlayer(player, teamId, teamName, navContext);
    } else {
      // Different teams split (navigate in-place), mobile, or panel 1
      selectPlayer(panelIndex, player.id, player);
    }
  };

  const handleOpponentClick = () => {
    if (!opponent || !nextEvent) return;

    const homeTeam = nextEvent.homeTeam;
    const awayTeam = nextEvent.awayTeam;
    const ut = nextEvent.tournament.uniqueTournament;
    const matchNavContext = {
      leagueId: ut.id,
      leagueName: ut.name,
      countryId: ut.category?.alpha2 ?? (ut.category?.id !== undefined ? String(ut.category.id) : navContext.countryId),
      countryName: ut.category?.name ?? navContext.countryName,
      countryCategoryId: ut.category?.id ?? navContext.countryCategoryId,
    };

    if (!isDesktop) {
      selectTeam(0, opponent.id, opponent.name);
      return;
    }

    if (!hasSplit) {
      // Schermo intero → apri split: casa a sinistra, trasferta a destra
      navigateTo(0, 'team', { teamId: homeTeam.id, teamName: homeTeam.name, ...matchNavContext });
      openSplitTeam(awayTeam.id, awayTeam.name, matchNavContext);
      return;
    }

    // Split view: cattura i panel prima di qualsiasi dispatch
    const p0 = state.panels[0];
    const p1 = state.panels[1];

    // Già corretta: casa a sinistra, trasferta a destra → non fare nulla
    if (p0?.teamId === homeTeam.id && p1?.teamId === awayTeam.id) return;

    const p0IsPlayer = p0?.view === 'player';
    const p1IsPlayer = p1?.view === 'player';

    if (p1IsPlayer && p1?.teamId === homeTeam.id) {
      // Player (home) a destra → spostalo a sinistra, away a destra
      navigateTo(0, 'player', { ...p1 });
      navigateTo(1, 'team', { teamId: awayTeam.id, teamName: awayTeam.name, ...matchNavContext });
    } else if (p1IsPlayer && p1?.teamId === awayTeam.id) {
      // Player (away) già a destra → home a sinistra, player rimane
      navigateTo(0, 'team', { teamId: homeTeam.id, teamName: homeTeam.name, ...matchNavContext });
    } else if (p0IsPlayer && p0?.teamId === homeTeam.id) {
      // Player (home) già a sinistra → player rimane, away a destra
      navigateTo(1, 'team', { teamId: awayTeam.id, teamName: awayTeam.name, ...matchNavContext });
    } else if (p0IsPlayer && p0?.teamId === awayTeam.id) {
      // Player (away) a sinistra → spostalo a destra, home a sinistra
      navigateTo(0, 'team', { teamId: homeTeam.id, teamName: homeTeam.name, ...matchNavContext });
      navigateTo(1, 'player', { ...p0 });
    } else {
      // Nessun player rilevante → entrambi i team page
      navigateTo(0, 'team', { teamId: homeTeam.id, teamName: homeTeam.name, ...matchNavContext });
      navigateTo(1, 'team', { teamId: awayTeam.id, teamName: awayTeam.name, ...matchNavContext });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-text-muted">
        <div className="w-4 h-4 border-2 border-neon border-t-transparent rounded-full animate-spin" />
        Caricamento squadra...
      </div>
    );
  }

  const positionLabels: Record<string, string> = {
    G: 'Portieri',
    D: 'Difensori',
    M: 'Centrocampisti',
    F: 'Attaccanti',
  };

  // Raggruppa panchina per ruolo
  const benchByPosition = bench.reduce<Record<string, Player[]>>((acc, p) => {
    const pos = p.position || 'F';
    if (!acc[pos]) acc[pos] = [];
    acc[pos].push(p);
    return acc;
  }, {});

  return (
    <div>
      {/* Header squadra */}
      <div className="flex items-center gap-3 mb-4">
        <img
          src={getTeamImageUrl(teamId)}
          alt=""
          className="w-10 h-10 object-contain"
        />
        <h2 className="text-xl font-bold text-text-primary">{teamName || 'Squadra'}</h2>
      </div>

      {/* Prossima partita */}
      {nextEvent && opponent && (
        <div className="mb-6 text-text-secondary text-sm">
          <span>Prossima partita: </span>
          {isHome ? teamName : (
            <button onClick={handleOpponentClick} className="text-neon hover:underline">
              {opponent.name}
            </button>
          )}
          <span> vs </span>
          {isHome ? (
            <button onClick={handleOpponentClick} className="text-neon hover:underline">
              {opponent.name}
            </button>
          ) : teamName}
          {nextEvent.tournament && (
            <span> | {nextEvent.tournament.name}</span>
          )}
          {roundLabel && (
            <span> {roundLabel}</span>
          )}
          {formation && (
            <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded bg-neon/15 text-neon text-xs font-medium">
              {formation}
            </span>
          )}
        </div>
      )}

      {/* Layout desktop: campo a sinistra, panchina a destra */}
      <div className={`flex flex-col ${isSplit ? '' : 'lg:flex-row lg:gap-6 lg:items-start'}`}>
        {/* Campo con formazione */}
        {starters.length > 0 && formationPositions.length > 0 && (
          <div className={`mb-6 ${isSplit ? 'w-full flex justify-center' : 'lg:mb-0 lg:flex-shrink-0 lg:w-[400px]'}`}>
            <div
              className={`relative bg-field-bg border border-field-lines rounded-lg overflow-hidden ${isSplit ? 'w-[400px]' : 'w-full mx-auto lg:mx-0'}`}
              style={{ aspectRatio: '68/105' }}
            >
              {/* Linee campo */}
              <svg className="absolute inset-0 w-full h-full" viewBox="0 0 680 1050" preserveAspectRatio="none">
                {/* Bordo */}
                <rect x="10" y="10" width="660" height="1030" fill="none" stroke="#2a5535" strokeWidth="2" />
                {/* Linea centrocampo */}
                <line x1="10" y1="525" x2="670" y2="525" stroke="#2a5535" strokeWidth="2" />
                {/* Cerchio centrocampo */}
                <circle cx="340" cy="525" r="91.5" fill="none" stroke="#2a5535" strokeWidth="2" />
                {/* Area rigore top */}
                <rect x="138" y="10" width="404" height="165" fill="none" stroke="#2a5535" strokeWidth="2" />
                <rect x="218" y="10" width="244" height="55" fill="none" stroke="#2a5535" strokeWidth="2" />
                {/* Area rigore bottom */}
                <rect x="138" y="875" width="404" height="165" fill="none" stroke="#2a5535" strokeWidth="2" />
                <rect x="218" y="985" width="244" height="55" fill="none" stroke="#2a5535" strokeWidth="2" />
              </svg>

              {/* Giocatori */}
              {starters.map((lp, idx) => {
                const pos = formationPositions[idx];
                if (!pos) return null;

                return (
                  <button
                    key={lp.player.id}
                    onClick={() => handlePlayerClick(lp.player)}
                    className="absolute flex flex-col items-center transform -translate-x-1/2 -translate-y-1/2 group"
                    style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
                  >
                    <div className="w-8 h-8 rounded-full bg-neon/80 flex items-center justify-center text-xs font-bold text-black group-hover:bg-neon transition-colors">
                      {lp.player.jerseyNumber ?? idx + 1}
                    </div>
                    <span className="text-[10px] text-white mt-0.5 font-medium text-center leading-tight max-w-[60px] truncate">
                      {lp.player.shortName ?? lp.player.name.split(' ').pop()}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Panchina / Rosa */}
        <div className="lg:flex-1 lg:min-w-0">
          <h3 className="text-sm font-semibold text-text-secondary mb-3 uppercase tracking-wide">
            Rosa completa
          </h3>
          {['G', 'D', 'M', 'F'].map((pos) => {
            const players = benchByPosition[pos];
            if (!players?.length) return null;
            return (
              <div key={pos} className="mb-4">
                <p className="text-xs text-text-muted mb-2">{positionLabels[pos]}</p>
                <div className="flex flex-wrap gap-2">
                  {players.map((p) => {
                    const parts = p.name.split(' ');
                    const shortName = parts.length > 1
                      ? `${parts[0][0]}. ${parts.slice(1).join(' ')}`
                      : p.name;
                    return (
                      <button
                        key={p.id}
                        onClick={() => handlePlayerClick(p)}
                        className="flex items-center gap-2 bg-surface border border-border rounded-full px-3 py-1.5 text-sm text-text-primary hover:border-neon transition-colors"
                      >
                        <img
                          src={getPlayerImageUrl(p.id)}
                          alt=""
                          className="w-6 h-6 rounded-full object-cover bg-border"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                        />
                        {shortName}
                        {p.jerseyNumber && (
                          <span className="text-text-muted text-xs">#{p.jerseyNumber}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
