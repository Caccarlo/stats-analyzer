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
  | { type: 'OPEN_SPLIT'; playerData: Player }
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

      const prevView = viewOrder[idx - 1];
      const newPanel = { ...current, view: prevView };

      // Reset a cascata
      if (prevView === 'home') {
        newPanel.countryId = undefined;
        newPanel.leagueId = undefined;
        newPanel.seasonId = undefined;
        newPanel.teamId = undefined;
        newPanel.playerId = undefined;
        newPanel.playerData = undefined;
      } else if (prevView === 'leagues') {
        newPanel.leagueId = undefined;
        newPanel.seasonId = undefined;
        newPanel.teamId = undefined;
        newPanel.playerId = undefined;
        newPanel.playerData = undefined;
      } else if (prevView === 'teams') {
        newPanel.teamId = undefined;
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
        panels[1] = {
          view: 'player',
          playerId: action.playerData.id,
          playerData: action.playerData,
        };
      } else {
        panels.push({
          view: 'player',
          playerId: action.playerData.id,
          playerData: action.playerData,
        });
      }
      return { panels };
    }

    case 'CLOSE_SPLIT': {
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
  openSplitPlayer: (player: Player) => void;
  closeSplit: () => void;
  selectCountry: (panel: number, countryId: string) => void;
  selectLeague: (panel: number, leagueId: number, seasonId?: number) => void;
  selectTeam: (panel: number, teamId: number) => void;
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

  const openSplitPlayer = (player: Player) => {
    dispatch({ type: 'OPEN_SPLIT', playerData: player });
  };

  const closeSplit = () => {
    dispatch({ type: 'CLOSE_SPLIT', panel: 1 });
  };

  const selectCountry = (panel: number, countryId: string) => {
    navigateTo(panel, 'leagues', { countryId });
  };

  const selectLeague = (panel: number, leagueId: number, seasonId?: number) => {
    navigateTo(panel, 'teams', { leagueId, seasonId });
  };

  const selectTeam = (panel: number, teamId: number) => {
    navigateTo(panel, 'team', { teamId });
  };

  const selectPlayer = (panel: number, playerId: number, playerData?: Player) => {
    navigateTo(panel, 'player', { playerId, playerData });
  };

  return (
    <NavContext.Provider
      value={{
        state,
        dispatch,
        navigateTo,
        goBack,
        openSplitPlayer,
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
