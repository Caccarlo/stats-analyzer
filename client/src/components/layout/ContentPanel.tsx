import { useNavigation } from '@/context/NavigationContext';
import type { PanelState } from '@/types';

interface ContentPanelProps {
  children: React.ReactNode;
  splitContent?: React.ReactNode;
  topBar?: React.ReactNode;
}

export default function ContentPanel({ children, splitContent, topBar }: ContentPanelProps) {
  const { state, closeSplit, goBack } = useNavigation();
  const hasSplit = state.panels.length > 1 && splitContent;

  const getBackLabel = (panel: PanelState) => {
    switch (panel.view) {
      case 'player': return panel.teamName ?? 'Indietro';
      case 'team': return panel.leagueName ?? 'Indietro';
      case 'teams': return panel.countryName ?? 'Indietro';
      case 'leagues': return 'Paesi';
      default: return 'Indietro';
    }
  };

  const renderPanelHeader = (panelIndex: number) => {
    const panel = state.panels[panelIndex];
    const showBack = panelIndex === 1
      ? panel?.view !== 'home' && !(panel?.view === 'player' && panel?.teamId === state.panels[0]?.teamId)
      : panel?.view === 'player';

    return (
      <div className="hidden lg:flex items-center justify-between px-6 pt-4 pb-0 flex-shrink-0">
        {showBack && panel ? (
          <button
            onClick={() => goBack(panelIndex)}
            className="flex items-center gap-1.5 text-text-secondary hover:text-neon transition-colors text-sm"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            {getBackLabel(panel)}
          </button>
        ) : (
          <div />
        )}
        <button
          onClick={() => closeSplit(panelIndex)}
          className="text-text-muted hover:text-text-primary transition-colors"
          aria-label="Chiudi"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    );
  };

  return (
    <div className="md:ml-[210px] flex-1 flex flex-col min-h-screen">
      {topBar && (
        <div className="px-6 pt-16 md:pt-6 pb-16 md:pb-6 max-w-xl mx-auto w-full">
          {topBar}
        </div>
      )}
      <div className="flex-1 flex">
        {/* Main panel */}
        <div className={`flex-1 flex flex-col overflow-y-auto ${hasSplit ? 'w-1/2' : 'w-full'}`}>
          {hasSplit && renderPanelHeader(0)}
          <div className={`flex-1 p-6 ${hasSplit ? 'pt-4' : topBar ? 'pt-4' : 'pt-16 md:pt-6'}`}>
            {children}
          </div>
        </div>

        {/* Split panel */}
        {hasSplit && (
          <div className="hidden lg:flex flex-col w-1/2 border-l border-border overflow-y-auto">
            {renderPanelHeader(1)}
            <div className="flex-1 p-6 pt-4">
              {splitContent}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
