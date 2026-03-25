import './index.css';
import { NavigationProvider, useNavigation } from '@/context/NavigationContext';
import Sidebar from '@/components/layout/Sidebar';
import ContentPanel from '@/components/layout/ContentPanel';
import SearchBar from '@/components/layout/SearchBar';
import HomePage from '@/pages/HomePage';
import PlayerPage from '@/pages/PlayerPage';
import CountryList from '@/components/navigation/CountryList';
import LeagueList from '@/components/navigation/LeagueList';
import TeamGrid from '@/components/navigation/TeamGrid';
import TeamView from '@/components/navigation/TeamView';
import SidebarTeamList from '@/components/navigation/SidebarTeamList';

function AppContent() {
  const { state } = useNavigation();
  const panel0 = state.panels[0];
  const panel1 = state.panels[1];

  const hasSplit = state.panels.length > 1;

  const renderContent = (panelIndex: number) => {
    const panel = state.panels[panelIndex];
    if (!panel) return null;

    switch (panel.view) {
      case 'player':
        return panel.playerId ? (
          <PlayerPage
            playerId={panel.playerId}
            playerData={panel.playerData}
            panelIndex={panelIndex}
          />
        ) : null;

      case 'team':
        return panel.teamId ? (
          <div>
            {!hasSplit && panelIndex === 0 && <SearchBar />}
            <div className={!hasSplit && panelIndex === 0 ? 'mt-8 ml-4' : ''}>
              <TeamView teamId={panel.teamId} isSplit={hasSplit} />
            </div>
          </div>
        ) : null;

      case 'teams':
        return panel.leagueId ? (
          <div>
            <SearchBar />
            <div className="mt-6">
              <TeamGrid leagueId={panel.leagueId} />
            </div>
          </div>
        ) : null;

      case 'leagues':
        return panel.countryId ? (
          <div>
            <SearchBar />
            <div className="mt-6">
              <LeagueList countryId={panel.countryId} />
            </div>
          </div>
        ) : null;

      case 'home':
      default:
        return <HomePage />;
    }
  };

  const renderSidebarContent = () => {
    switch (panel0.view) {
      case 'teams':
        return panel0.leagueId ? (
          <>
            <p className="px-4 pt-3 pb-1 text-xs text-text-muted uppercase tracking-wide">
              {panel0.leagueName ?? 'Campionato'}
            </p>
            <SidebarTeamList leagueId={panel0.leagueId} />
          </>
        ) : null;

      case 'team': {
        const code = panel0.teamName?.substring(0, 2).toUpperCase() ?? '';
        return (
          <>
            <p className="px-4 pt-3 pb-1 text-xs text-text-muted uppercase tracking-wide">
              {panel0.teamName ?? 'Squadra'}
            </p>
            <div className="py-1">
              <div className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-neon border-l-2 border-neon bg-neon/5">
                <span className="font-mono text-xs w-5 text-center opacity-60">{code}</span>
                <span className="font-medium">Formazione</span>
              </div>
            </div>
          </>
        );
      }

      case 'player': {
        const name = panel0.playerData?.shortName ?? panel0.playerData?.name ?? 'Giocatore';
        const initials = name.split(/[\s.]+/).filter(Boolean).map(w => w[0]).join('').substring(0, 2).toUpperCase();
        return (
          <>
            <p className="px-4 pt-3 pb-1 text-xs text-text-muted uppercase tracking-wide">Giocatore</p>
            <div className="py-1">
              <div className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-neon border-l-2 border-neon bg-neon/5">
                <span className="font-mono text-xs w-5 text-center opacity-60">{initials}</span>
                <span className="font-medium">{name}</span>
              </div>
            </div>
          </>
        );
      }

      default:
        return (
          <>
            <p className="px-4 pt-3 pb-1 text-xs text-text-muted uppercase tracking-wide">Paesi</p>
            <CountryList />
          </>
        );
    }
  };

  return (
    <div className="flex min-h-screen bg-bg">
      <Sidebar>
        {renderSidebarContent()}
      </Sidebar>
      <ContentPanel
        splitContent={panel1 ? renderContent(1) : undefined}
        topBar={hasSplit ? <SearchBar /> : undefined}
      >
        {renderContent(0)}
      </ContentPanel>
    </div>
  );
}

function App() {
  return (
    <NavigationProvider>
      <AppContent />
    </NavigationProvider>
  );
}

export default App;
