import './index.css'

function App() {
  return (
    <div className="flex h-screen">
      <aside className="w-[210px] bg-bg-sidebar border-r border-border flex-shrink-0">
        <div className="p-4">
          <h2 className="text-neon font-bold text-lg">Stats Analyzer</h2>
        </div>
      </aside>
      <main className="flex-1 p-6 overflow-y-auto">
        <h1 className="text-2xl font-bold text-text-primary mb-4">
          Benvenuto in Stats Analyzer
        </h1>
        <p className="text-text-secondary">
          Analizza i falli commessi e subiti di qualsiasi giocatore di calcio.
        </p>
        <div className="mt-6 grid grid-cols-3 gap-4">
          <div className="bg-surface border border-border rounded-lg p-4 hover:border-neon transition-colors">
            <p className="text-text-muted text-sm">Falli commessi</p>
            <p className="text-negative text-2xl font-bold">--</p>
          </div>
          <div className="bg-surface border border-border rounded-lg p-4 hover:border-neon transition-colors">
            <p className="text-text-muted text-sm">Falli subiti</p>
            <p className="text-neon text-2xl font-bold">--</p>
          </div>
          <div className="bg-surface border border-border rounded-lg p-4 hover:border-neon transition-colors">
            <p className="text-text-muted text-sm">Media / 90 min</p>
            <p className="text-text-primary text-2xl font-bold">--</p>
          </div>
        </div>
      </main>
    </div>
  )
}

export default App
