import { useState } from 'react';
import { useNavigation } from '@/context/NavigationContext';

export default function Sidebar({ children }: { children: React.ReactNode }) {
  const { state, goBack } = useNavigation();
  const panel = state.panels[0];
  const [mobileOpen, setMobileOpen] = useState(false);

  const canGoBack = panel.view !== 'home';

  return (
    <>
      {/* Hamburger button - mobile only */}
      <button
        onClick={() => setMobileOpen(true)}
        className="md:hidden fixed top-4 left-4 z-50 bg-surface border border-border rounded-lg p-2 hover:border-neon transition-colors"
        aria-label="Menu"
      >
        <svg className="w-5 h-5 text-text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      {/* Overlay - mobile */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/50 z-40"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed top-0 left-0 h-screen w-[210px] bg-bg-sidebar border-r border-border
          flex flex-col z-40 transition-transform duration-200
          md:translate-x-0
          ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
      >
        {/* Header */}
        <div className="p-4 border-b border-border">
          <h1 className="text-neon font-bold text-lg tracking-tight">Stats Analyzer</h1>
        </div>

        {/* Back button */}
        {canGoBack && (
          <button
            onClick={() => {
              goBack(0);
              setMobileOpen(false);
            }}
            className="flex items-center gap-2 px-4 py-2 text-text-secondary hover:text-neon transition-colors text-sm"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Indietro
          </button>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto" onClick={() => setMobileOpen(false)}>
          {children}
        </div>
      </aside>
    </>
  );
}
