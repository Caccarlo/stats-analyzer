import { createContext, useContext, useReducer, type ReactNode } from 'react';
import type { PanelState, Player, ViewType } from '@/types';

// === Stato ===

interface NavState {
  panels: PanelState[];
}

const initialPanel: PanelState = { view: 'home' };
const initialState: NavState = { panels: [initialPanel] };

// === Azioni ===

type NavAction =
  | { type: 'SET_VIEW'; panel: number; view: ViewType; data?: Partial<PanelState> }
  | { type: 'GO_BACK'; panel: number }
  | { type: 'OPEN_SPLIT'; panelState: PanelState }
  | { type: 'SWAP_SPLIT_AND_OPEN'; panelState: PanelState }
  | { type: 'CLOSE_SPLIT'; panel: number }
  | { type: 'RESET' };

function reducer(state: NavState, action: NavAction): NavState {
  const panels = [...state.panels];

  switch (action.type) {
    case 'SET_VIEW': {
      const current = panels[action.panel] ?? initialPanel;
      panels[action.panel] = { ...current, view: action.data?.view ?? current.view, ...action.data };
      return { panels };
    }

    case 'GO_BACK': {
      const current = panels[action.panel];
      if (!current) return state;

      const viewOrder: ViewType[] = ['home', 'leagues', 'teams', 'team', 'player'];
      const idx = viewOrder.indexOf(current.view);

      if (idx <= 0) {
        // Se siamo nel pannello split, chiudilo
        if (action.panel > 0) {
          return { panels: [panels[0]] };
        }
        return state;
      }

      // Find appropriate previous view, skipping levels without required context
      let prevIdx = idx - 1;
      while (prevIdx > 0) {
        const candidate = viewOrder[prevIdx];
        if (candidate === 'team' && !current.teamId) { prevIdx--; continue; }
        if (candidate === 'teams' && !current.leagueId) { prevIdx--; continue; }
        if (candidate === 'leagues' && !current.countryId) { prevIdx--; continue; }
        break;
      }

      const prevView = viewOrder[prevIdx];
      const newPanel = { ...current, view: prevView };

      // Reset a cascata
      if (prevView === 'home') {
        newPanel.countryId = undefined;
        newPanel.countryName = undefined;
        newPanel.leagueId = undefined;
        newPanel.leagueName = undefined;
        newPanel.seasonId = undefined;
        newPanel.teamId = undefined;
        newPanel.teamName = undefined;
        newPanel.playerId = undefined;
        newPanel.playerData = undefined;
      } else if (prevView === 'leagues') {
        newPanel.leagueId = undefined;
        newPanel.leagueName = undefined;
        newPanel.seasonId = undefined;
        newPanel.teamId = undefined;
        newPanel.teamName = undefined;
        newPanel.playerId = undefined;
        newPanel.playerData = undefined;
      } else if (prevView === 'teams') {
        newPanel.teamId = undefined;
        newPanel.teamName = undefined;
        newPanel.playerId = undefined;
        newPanel.playerData = undefined;
      } else if (prevView === 'team') {
        newPanel.playerId = undefined;
        newPanel.playerData = undefined;
      }

      panels[action.panel] = newPanel;
      return { panels };
    }

    case 'OPEN_SPLIT': {
      if (panels.length >= 2) {
        panels[1] = action.panelState;
      } else {
        panels.push(action.panelState);
      }
      return { panels };
    }

    case 'SWAP_SPLIT_AND_OPEN': {
      // [A][B] -> [B][new]: move panel 1 to panel 0, put new state in panel 1
      if (panels.length >= 2) {
        return { panels: [panels[1], action.panelState] };
      }
      // No split open: just open split normally
      return { panels: [panels[0], action.panelState] };
    }

    case 'CLOSE_SPLIT': {
      if (action.panel === 0 && panels.length > 1) {
        return { panels: [panels[1]] };
      }
      return { panels: [panels[0]] };
    }

    case 'RESET':
      return initialState;

    default:
      return state;
  }
}

// === Context ===

interface NavContextValue {
  state: NavState;
  dispatch: React.Dispatch<NavAction>;
  // Helper functions
  navigateTo: (panel: number, view: ViewType, data?: Partial<PanelState>) => void;
  goBack: (panel: number) => void;
  openSplitPlayer: (player: Player, overrideTeamId?: number, overrideTeamName?: string) => void;
  openSplitTeam: (teamId: number, teamName?: string, context?: Partial<PanelState>) => void;
  swapSplitAndOpenTeam: (teamId: number, teamName?: string, context?: Partial<PanelState>) => void;
  openSplitHome: () => void;
  closeSplit: (panel?: number) => void;
  selectCountry: (panel: number, countryId: string, countryName?: string) => void;
  selectLeague: (panel: number, leagueId: number, leagueName?: string, seasonId?: number) => void;
  selectTeam: (panel: number, teamId: number, teamName?: string) => void;
  selectPlayer: (panel: number, playerId: number, playerData?: Player) => void;
}

const NavContext = createContext<NavContextValue | null>(null);

export function NavigationProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  const navigateTo = (panel: number, view: ViewType, data?: Partial<PanelState>) => {
    dispatch({ type: 'SET_VIEW', panel, view, data: { ...data, view } });
  };

  const goBack = (panel: number) => {
    dispatch({ type: 'GO_BACK', panel });
  };

  const openSplitPlayer = (player: Player, overrideTeamId?: number, overrideTeamName?: string) => {
    dispatch({
      type: 'OPEN_SPLIT',
      panelState: {
        view: 'player',
        playerId: player.id,
        playerData: player,
        teamId: overrideTeamId ?? player.team?.id,
        teamName: overrideTeamName ?? player.team?.name,
      },
    });
  };

  const openSplitTeam = (teamId: number, teamName?: string, context?: Partial<PanelState>) => {
    dispatch({
      type: 'OPEN_SPLIT',
      panelState: { view: 'team', teamId, teamName, ...context },
    });
  };

  const swapSplitAndOpenTeam = (teamId: number, teamName?: string, context?: Partial<PanelState>) => {
    dispatch({
      type: 'SWAP_SPLIT_AND_OPEN',
      panelState: { view: 'team', teamId, teamName, ...context },
    });
  };

  const openSplitHome = () => {
    dispatch({ type: 'OPEN_SPLIT', panelState: { view: 'home' } });
  };

  const closeSplit = (panel: number = 1) => {
    dispatch({ type: 'CLOSE_SPLIT', panel });
  };

  const selectCountry = (panel: number, countryId: string, countryName?: string) => {
    navigateTo(panel, 'leagues', { countryId, countryName });
  };

  const selectLeague = (panel: number, leagueId: number, leagueName?: string, seasonId?: number) => {
    navigateTo(panel, 'teams', { leagueId, leagueName, seasonId });
  };

  const selectTeam = (panel: number, teamId: number, teamName?: string) => {
    navigateTo(panel, 'team', { teamId, teamName });
  };

  const selectPlayer = (panel: number, playerId: number, playerData?: Player) => {
    const data: Partial<PanelState> = { playerId, playerData };
    if (playerData?.team) {
      data.teamId = playerData.team.id;
      data.teamName = playerData.team.name;
    }
    navigateTo(panel, 'player', data);
  };

  return (
    <NavContext.Provider
      value={{
        state,
        dispatch,
        navigateTo,
        goBack,
        openSplitPlayer,
        openSplitTeam,
        swapSplitAndOpenTeam,
        openSplitHome,
        closeSplit,
        selectCountry,
        selectLeague,
        selectTeam,
        selectPlayer,
      }}
    >
      {children}
    </NavContext.Provider>
  );
}

export function useNavigation() {
  const ctx = useContext(NavContext);
  if (!ctx) throw new Error('useNavigation must be used within NavigationProvider');
  return ctx;
}
