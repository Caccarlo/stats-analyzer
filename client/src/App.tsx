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

function AppContent() {
  const { state } = useNavigation();
  const panel0 = state.panels[0];
  const panel1 = state.panels[1];

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
            <SearchBar />
            <div className="mt-6">
              <TeamView teamId={panel.teamId} />
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

  // Sidebar mostra la lista paesi tranne che nella vista squadra (mostra le squadre del campionato)
  const renderSidebarContent = () => {
    return <CountryList />;
  };

  return (
    <div className="flex min-h-screen bg-bg">
      <Sidebar>
        {renderSidebarContent()}
      </Sidebar>
      <ContentPanel
        splitContent={panel1 ? renderContent(1) : undefined}
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
