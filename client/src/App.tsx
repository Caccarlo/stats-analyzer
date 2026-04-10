import { useState } from 'react';
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
import { useViewport } from '@/hooks/useViewport';


function AppContent() {
  const { width, height } = useViewport();
  const { state, openSplitHome } = useNavigation();
  const panel0 = state.panels[0];
  const panel1 = state.panels[1];
  const [mobileOpen, setMobileOpen] = useState(false);

  const hasSplit = state.panels.length > 1;
  const isDesktop = width >= 1024;
  const hasHamburgerNav = width < 768;
  const compactDensity = width < 640 || height < 820;

  const renderSinglePanelSearch = (panelIndex: number) => (
    <div className={`mb-4 md:mb-6 ${hasHamburgerNav ? 'pl-14' : ''}`}>
      <SearchBar panelIndex={panelIndex} compact={compactDensity} />
    </div>
  );

  const renderContent = (panelIndex: number) => {
    const panel = state.panels[panelIndex];
    if (!panel) return null;

    const showPlusButton = isDesktop && !hasSplit && panelIndex === 0
      && (panel.view === 'team' || panel.view === 'player');

    switch (panel.view) {
      case 'player':
        return panel.playerId ? (
          <div>
            {!hasSplit && panelIndex === 0 && renderSinglePanelSearch(panelIndex)}
            <div className={`${showPlusButton ? 'relative mt-8' : ''} ${!hasSplit ? 'mt-1 md:mt-0' : ''}`}>
              {showPlusButton && (
                <button
                  onClick={openSplitHome}
                  className="absolute left-1/2 top-0 -translate-x-1/2 z-10 w-10 h-10 flex items-center justify-center rounded-full bg-surface border border-border text-text-secondary hover:border-neon hover:text-neon transition-all hover:shadow-[0_0_12px_rgba(74,222,128,0.15)]"
                  aria-label="Apri vista affiancata"
                  title="Apri vista affiancata"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v14M5 12h14" />
                  </svg>
                </button>
              )}
              <PlayerPage
                key={panel.playerId}
                playerId={panel.playerId}
                playerData={panel.playerData}
                panelIndex={panelIndex}
              />
            </div>
          </div>
        ) : null;

      case 'team':
        return panel.teamId ? (
          <div>
            {!hasSplit && panelIndex === 0 && renderSinglePanelSearch(panelIndex)}
            <div className={`${showPlusButton ? 'relative mt-8' : ''} ${!hasSplit ? 'mt-1 md:mt-0' : ''}`}>
              {showPlusButton && (
                <button
                  onClick={openSplitHome}
                  className="absolute left-1/2 top-0 -translate-x-1/2 z-10 w-10 h-10 flex items-center justify-center rounded-full bg-surface border border-border text-text-secondary hover:border-neon hover:text-neon transition-all hover:shadow-[0_0_12px_rgba(74,222,128,0.15)]"
                  aria-label="Apri vista affiancata"
                  title="Apri vista affiancata"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v14M5 12h14" />
                  </svg>
                </button>
              )}
              <TeamView teamId={panel.teamId} isSplit={hasSplit} panelIndex={panelIndex} />
            </div>
          </div>
        ) : null;

      case 'teams':
        return panel.leagueId ? (
          <div>
            {!hasSplit && renderSinglePanelSearch(panelIndex)}
            <div className={!hasSplit ? 'mt-1 md:mt-0' : ''}>
              <TeamGrid leagueId={panel.leagueId} panelIndex={panelIndex} />
            </div>
          </div>
        ) : null;

      case 'leagues':
        return panel.countryId ? (
          <div>
            {!hasSplit && renderSinglePanelSearch(panelIndex)}
            <div className={!hasSplit ? 'mt-1 md:mt-0' : ''}>
              <LeagueList panelIndex={panelIndex} />
            </div>
          </div>
        ) : null;

      case 'home':
      default:
        return (
          <div>
            {!hasSplit && panelIndex === 0 && renderSinglePanelSearch(panelIndex)}
            <HomePage panelIndex={panelIndex} />
          </div>
        );
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
            {panel0.tournamentPhaseName && (
              <p className="px-4 pb-1 text-[11px] text-text-muted/80">
                {panel0.tournamentPhaseName}
              </p>
            )}
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
          <div className="h-full min-h-0 flex flex-col">
            <p className="px-4 pt-3 pb-1 text-xs text-text-muted uppercase tracking-wide">Paesi</p>
            <CountryList scrollOnlyOthers />
          </div>
        );
    }
  };

  return (
    <div className="flex min-h-screen bg-bg">
      <Sidebar
        mobileOpen={mobileOpen}
        onMobileOpenChange={setMobileOpen}
      >
        {renderSidebarContent()}
      </Sidebar>
      <ContentPanel
        splitContent={panel1 ? renderContent(1) : undefined}
        topBar={hasSplit ? (
          <div className="flex">
            <div className="w-1/2 pr-6">
              <SearchBar panelIndex={0} />
            </div>
            <div className="w-1/2 pl-6">
              <SearchBar panelIndex={1} />
            </div>
          </div>
        ) : undefined}
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
