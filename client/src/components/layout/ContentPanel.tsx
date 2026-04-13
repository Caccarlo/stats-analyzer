import { useNavigation } from '@/context/NavigationContext';
import { useViewport } from '@/hooks/useViewport';
import type { PanelState } from '@/types';

interface ContentPanelProps {
  children: React.ReactNode;
  splitContent?: React.ReactNode;
  topBar?: React.ReactNode;
  /** When true the topBar manages its own padding and border; ContentPanel wraps it without adding any. */
  rawTopBar?: boolean;
  mainPanelScrollMode?: 'panel' | 'content';
  splitPanelScrollMode?: 'panel' | 'content';
}

export default function ContentPanel({
  children,
  splitContent,
  topBar,
  rawTopBar = false,
  mainPanelScrollMode = 'panel',
  splitPanelScrollMode = 'panel',
}: ContentPanelProps) {
  const { state, closeSplit, goBack } = useNavigation();
  const { width, height } = useViewport();
  const hasSplit = state.panels.length > 1 && splitContent;
  const compactDensity = width < 640 || height < 820;
  const panelPaddingClass = compactDensity ? 'p-4' : 'p-6';
  const topBarPaddingClass = 'px-4 h-14 flex items-center border-b border-border';
  const mainPanelUsesInnerScroll = hasSplit && mainPanelScrollMode === 'content';
  const splitPanelUsesInnerScroll = hasSplit && splitPanelScrollMode === 'content';

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
    const isOverlayHomeHeader = panel?.view === 'home';
    const showBack = panelIndex === 1
      ? panel?.view !== 'home'
        && !(panel?.view === 'player' && state.panels[0]?.view === 'team' && panel?.teamId === state.panels[0]?.teamId)
      : false;

    if (isOverlayHomeHeader) {
      return (
        <div className="hidden lg:flex absolute top-4 right-6 z-20">
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
    }

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
    <div className={`md:ml-[var(--sidebar-width)] flex-1 flex flex-col overflow-hidden ${hasSplit ? 'h-screen' : 'min-h-screen'}`}>
      {topBar && (
        rawTopBar ? (
          <div className="w-full flex-shrink-0">{topBar}</div>
        ) : (
          <div className={`${topBarPaddingClass} w-full flex-shrink-0`}>
            <div className="w-full">{topBar}</div>
          </div>
        )
      )}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* Main panel */}
        <div className={`flex-1 flex flex-col overflow-x-hidden min-w-0 min-h-0 ${
          hasSplit
            ? `relative w-1/2 split-panel ${mainPanelUsesInnerScroll ? 'overflow-y-hidden' : 'overflow-y-auto'}`
            : 'w-full overflow-y-auto'
        }`}>
          {hasSplit && renderPanelHeader(0)}
          <div className={`flex-1 min-h-0 ${panelPaddingClass} ${
            hasSplit
              ? mainPanelUsesInnerScroll
                ? 'overflow-hidden p-0'
                : 'pt-4'
              : rawTopBar
                ? 'pt-0'
                : topBar
                  ? 'pt-4'
                  : 'pt-4 md:pt-6'
          }`}>
            {children}
          </div>
        </div>

        {/* Split panel */}
        {hasSplit && (
          <div className={`hidden lg:flex flex-col w-1/2 border-l border-border overflow-x-hidden min-w-0 min-h-0 split-panel ${
            splitPanelUsesInnerScroll ? 'relative overflow-y-hidden' : 'overflow-y-auto'
          }`}>
            {renderPanelHeader(1)}
            <div className={`flex-1 min-h-0 ${splitPanelUsesInnerScroll ? 'overflow-hidden p-0' : `${panelPaddingClass} pt-4`}`}>
              {splitContent}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
