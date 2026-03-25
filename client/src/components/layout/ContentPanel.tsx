import { useNavigation } from '@/context/NavigationContext';

interface ContentPanelProps {
  children: React.ReactNode;
  splitContent?: React.ReactNode;
  topBar?: React.ReactNode;
}

export default function ContentPanel({ children, splitContent, topBar }: ContentPanelProps) {
  const { state, closeSplit } = useNavigation();
  const hasSplit = state.panels.length > 1 && splitContent;

  return (
    <div className="md:ml-[210px] flex-1 flex flex-col min-h-screen">
      {topBar && (
        <div className="px-6 pt-16 md:pt-6 pb-16 md:pb-6 max-w-xl mx-auto w-full">
          {topBar}
        </div>
      )}
      <div className="flex-1 flex">
        {/* Main panel */}
        <div className={`flex-1 overflow-y-auto p-6 ${topBar ? 'pt-4' : 'pt-16 md:pt-6'} relative ${hasSplit ? 'w-1/2' : 'w-full'}`}>
          {hasSplit && (
            <button
              onClick={() => closeSplit(0)}
              className="hidden lg:block absolute top-4 right-4 text-text-muted hover:text-text-primary transition-colors z-10"
              aria-label="Chiudi"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
          {children}
        </div>

        {/* Split panel */}
        {hasSplit && (
          <div className={`hidden lg:flex w-1/2 border-l border-border overflow-y-auto p-6 ${topBar ? 'pt-4' : ''} relative`}>
            <button
              onClick={() => closeSplit(1)}
              className="absolute top-4 right-4 text-text-muted hover:text-text-primary transition-colors z-10"
              aria-label="Chiudi"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <div className="flex-1">
              {splitContent}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
