import { useNavigation } from '@/context/NavigationContext';
import { useViewport } from '@/hooks/useViewport';

interface SidebarProps {
  children: React.ReactNode;
  mobileOpen: boolean;
  onMobileOpenChange: (open: boolean) => void;
}

export default function Sidebar({ children, mobileOpen, onMobileOpenChange }: SidebarProps) {
  const { state, goBack, dispatch } = useNavigation();
  const { width } = useViewport();
  const panel = state.panels[0];
  const isMobile = width < 768;

  const getBackLabel = (): string | null => {
    switch (panel.view) {
      case 'player': return panel.teamName ?? 'Paesi';
      case 'team': return panel.leagueName ?? 'Paesi';
      case 'teams': return panel.countryName ?? 'Paesi';
      default: return null;
    }
  };

  const backLabel = getBackLabel();

  return (
    <>
      {/* Hamburger button - mobile only */}
      <button
        onClick={() => onMobileOpenChange(!mobileOpen)}
        className={`md:hidden fixed top-4 left-4 z-50 rounded-lg p-2 border transition-colors ${
          mobileOpen
            ? 'bg-bg-sidebar border-neon text-neon'
            : 'bg-surface border-border text-text-primary hover:border-neon'
        }`}
        aria-label={mobileOpen ? 'Chiudi menu' : 'Apri menu'}
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          {mobileOpen ? (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          ) : (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          )}
        </svg>
      </button>

      {/* Overlay - mobile */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/50 z-40"
          onClick={() => onMobileOpenChange(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed top-0 left-0 h-screen w-[var(--sidebar-width)] bg-bg-sidebar border-r border-border
          flex flex-col z-40 transition-transform duration-200 shadow-[0_0_28px_rgba(0,0,0,0.35)]
          md:translate-x-0
          ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
      >
        {/* Header */}
        <div className={`border-b border-border flex items-center h-14 ${isMobile ? 'pl-16 pr-4' : 'px-4'}`}>
          <h1
            className="text-neon font-bold text-lg tracking-tight cursor-pointer hover:opacity-80 transition-opacity"
            onClick={() => dispatch({ type: 'RESET' })}
          >Stats Analyzer</h1>
        </div>

        {/* Back button */}
        {backLabel && (
          <button
            onClick={() => {
              goBack(0);
              onMobileOpenChange(false);
            }}
            className="flex items-center gap-2 px-4 py-2 text-text-secondary hover:text-neon transition-colors text-sm"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            {backLabel}
          </button>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto" onClick={() => isMobile && onMobileOpenChange(false)}>
          {children}
        </div>
      </aside>
    </>
  );
}
