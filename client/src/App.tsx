import './index.css';
import { NavigationProvider, useNavigation } from '@/context/NavigationContext';
import Sidebar from '@/components/layout/Sidebar';
import ContentPanel from '@/components/layout/ContentPanel';
import HomePage from '@/pages/HomePage';
import PlayerPage from '@/pages/PlayerPage';
import CountryList from '@/components/navigation/CountryList';

function AppContent() {
  const { state } = useNavigation();
  const panel0 = state.panels[0];
  const panel1 = state.panels[1];

  const renderPanelContent = (panelIndex: number) => {
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

      case 'home':
      case 'leagues':
      case 'teams':
      case 'team':
      default:
        return <HomePage />;
    }
  };

  return (
    <div className="flex min-h-screen bg-bg">
      <Sidebar>
        <CountryList />
      </Sidebar>
      <ContentPanel
        splitContent={panel1 ? renderPanelContent(1) : undefined}
      >
        {renderPanelContent(0)}
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
