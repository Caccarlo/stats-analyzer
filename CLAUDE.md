# Stats Analyzer

Football/soccer foul analysis web app. Users navigate Countries > Leagues > Teams > Players (or search directly) to view foul statistics, match-by-match breakdowns with field position maps, and side-by-side player comparison via split view. UI is in Italian.

## Stack & Setup

| Layer | Tech | Port |
|-------|------|------|
| Client | React 19, TypeScript 5.9, Vite 8, Tailwind CSS 4 | 5173 |
| Server | Express 4 (CORS proxy to SofaScore) | 3001 |

No database, no auth, no API keys. All data comes from the public SofaScore API via the Express proxy.
```bash
npm run install:all   # first time
npm start             # runs both client and server via concurrently
```

### Killing stuck processes (Windows)
`taskkill` doesn't work in Git Bash (interprets `/PID` as a path). Use PowerShell instead:
```bash
# Find PIDs listening on ports 3001 and 5173
netstat -ano | grep -E "LISTENING" | grep -E ":3001 |:5173 "

# Kill by PID (replace 1234 / 5678 with actual PIDs)
powershell -Command "Stop-Process -Id 1234 -Force -ErrorAction SilentlyContinue; Stop-Process -Id 5678 -Force -ErrorAction SilentlyContinue"
```

## Project Structure
```
stats-analyzer/
├── package.json                     # Monorepo: concurrently runs server + client
├── server/
│   └── index.js                     # Express proxy (2 routes: /api/sofascore/*, /api/img/*)
└── client/
    ├── vite.config.ts               # Proxy /api -> :3001, alias @ -> src/
    ├── tsconfig.app.json            # TypeScript client config; mirrors alias @ -> src/* for editor + build resolution
    ├── src/
    │   ├── App.tsx                   # Root: wraps NavigationProvider, renders Sidebar + ContentPanel
    │   ├── index.css                 # Tailwind imports + custom CSS theme variables
    │   ├── types/index.ts            # All TypeScript interfaces
    │   ├── api/sofascore.ts          # All API functions (typed, cached 5min, retry x3 with backoff)
    │   ├── context/
    │   │   └── NavigationContext.tsx  # useReducer state for all navigation + split view
    │   ├── hooks/
    │   │   ├── usePlayerData.ts      # Fetches player seasons/stats, manages filters (showCommitted, showSuffered, showHome, showAway, showCards, showStartersOnly, committedLine, sufferedLine, selectedPeriod); exports SelectedPeriod type; currentSeasonYear auto-derived from selectedPeriod (if 'last' uses availableSeasonYears[0])
    │   │   ├── useMatchDetails.ts    # Fetches independent match data sources with separate caches/statuses; comments are narrative-only; exports fetchMatchDetails(eventId, playerId) + helper separati: fetchMatchOfficialStats, fetchMatchLineupsOnly, fetchMatchRichData, patchMatchDetailsCache
    │   │   ├── useMatchTimeline.ts   # 4 code dopo events/last: (1) officialStats via event/{id}/player/{id}/statistics (batch 8) → initialStatsLoaded dopo prime 5; (2) lineups (batch 5) → allLineupsLoaded; (3) rich/comments ultime 5; (4) lazy per le altre via requestRichDetails(eventId)
    │   │   └── useSplitCardSync.ts   # Cross-panel card height sync via module-level registry + useLayoutEffect
    │   ├── utils/
    │   │   ├── foulPairing.ts        # Extracts fouls from match comments, pairs them, translates zones
    │   │   ├── statsCalculator.ts    # Aggregates stats across tournaments (per-match, per-90, yellow/red cards)
    │   │   └── positionMapping.ts    # SofaScore coords -> SVG coords, 13+ formation templates
    │   ├── pages/
    │   │   ├── HomePage.tsx          # Landing with search bar
    │   │   └── PlayerPage.tsx        # Player analysis: owns all selection logic; in 'last N' mode loader fetches a fixed pool once (`N*3` across all seasons), then displayEvents excludes didNotPlay -> slices first N valid matches -> applies tournament/venue/starter filters on those N only; filter toggles never touch the loader; derivedStats uses official per-match player statistics, never comments
    │   └── components/
    │       ├── layout/
    │       │   ├── Sidebar.tsx       # Fixed 210px left panel, hamburger on mobile
    │       │   ├── ContentPanel.tsx  # Main content area, handles split view (50/50)
    │       │   └── SearchBar.tsx     # Global player search, 500ms debounce, dropdown
    │       ├── navigation/
    │       │   ├── CountryList.tsx   # Hardcoded 6 countries with league IDs
    │       │   ├── LeagueList.tsx    # Leagues for selected country
    │       │   ├── TeamGrid.tsx      # Teams grid from standings
    │       │   ├── TeamView.tsx      # Team roster + next match formation on field
    │       │   └── SidebarTeamList.tsx # Compact team list in sidebar
    │       ├── player/
    │       │   ├── PlayerHeader.tsx  # Avatar, name, team, position, number
    │       │   ├── PlayerFilters.tsx # 3-column layout: col1=Competizioni(vertical), col2=Sede+Periodo+Titolare, col3=Mostra(vertical) con dropdown Over X.5 affiancati; "Periodo:" select raggruppato: prima opzioni "Ultime N" poi stagioni per anno; isSplitView prop controls w-full vs w-1/2
    │       │   ├── StatsOverview.tsx # Stat cards grid: committed(4 cols), suffered(4 cols), cards(4 cols when showCards); quarto card = HitRateCard
    │       │   ├── MatchTimeline.tsx # Horizontal scrollable match timeline with foul badges + select/deselect all toggle; header mostra sempre il totale partite (N); prop isBackgroundLoading: when true shows small green spinner next to the count
    │       │   ├── MatchCard.tsx     # Always-open match card: foul list, FieldMap, Heatmap, active player stats overlay; opponent team name in header is clickable (opens split/swap); active opponent player name is clickable (opens split/swap); foul comments show jersey number after player name outside the clickable button; all clickable elements use text-text-primary hover:text-neon except foul comment player buttons which are text-neon; average-positions loaded on-demand via getMatchAveragePositions when card is opened
    │       │   ├── FieldMap.tsx      # SVG field with clickable position dots; activePlayerId + involvedPlayerIds filtering
    │       │   └── HeatmapField.tsx  # Canvas-based player heatmap; maxWidth prop = half of FieldMap width (measured via ResizeObserver), fallback 119px portrait / 200px landscape
    │       └── common/
    │           ├── Badge.tsx         # Styled badge (3 variants)
    │           └── PlayerDot.tsx     # SVG circle for field map
```

## Architecture
```
Browser (5173) -> React App -> sofascore.ts (client cache 5min + retry x3)
    -> Vite dev proxy /api/* -> Express (3001, server cache: JSON 5min/500 entries, images 30min/200 entries)
        -> sofascore.com/api/v1/*      (JSON data)
        -> api.sofascore.app/api/v1/*  (images)
```

- **Server**: Minimal proxy. Spoofs browser headers (User-Agent, Referer, Accept-Language: it-IT). In-memory `Map` cache with TTL. No controllers, no middleware beyond CORS.
- **Client**: No React Router. Custom state-based routing via `NavigationContext` (useReducer). Data fetching via custom hooks with cancellation tokens. Match details progressively loaded in background via `useMatchTimeline`.

## Navigation & Split View

### View Hierarchy
```
home -> leagues -> teams -> team -> player
```
Going back cascades resets (e.g., back from `team` clears player data).

### State Model (NavigationContext)
```typescript
state = { panels: PanelState[] }  // 1 panel = normal, 2 = split view

PanelState = {
  view: 'home' | 'leagues' | 'teams' | 'team' | 'player',
  countryId?, countryName?, leagueId?, leagueName?, seasonId?,
  teamId?, teamName?, playerId?, playerData?
}
```

### Reducer Actions
- `SET_VIEW` — navigate to a view with data
- `GO_BACK` — step back in hierarchy, cascade-clear child data
- `OPEN_SPLIT` — open second panel (player, team, or home)
- `CLOSE_SPLIT` — close a panel (other becomes full-width)
- `SWAP_SPLIT_AND_OPEN` — rotate panels: [A][B] -> [B][new]
- `RESET` — return to home

### Helper Functions
`navigateTo`, `selectCountry`, `selectLeague`, `selectTeam`, `selectPlayer`, `openSplitPlayer`, `openSplitTeam`, `swapSplitAndOpenTeam`, `swapSplitAndOpenPlayer`, `openSplitHome`, `closeSplit`, `goBack` — all panel-index-aware.

### Split View Rules
- Desktop only (lg: 1024px+), panels 50/50
- "+" button rendered in `App.tsx` (centered via `left-1/2`) when viewing team or player full-screen: opens split with home view (country selection) for independent navigation
- Clicking player in TeamView: if no split open, opens split with that player; if split already open (two teams), navigates in-place in the same panel
- Clicking foul-involved player in MatchCard: from left panel opens split on right; from right panel swaps (current player → left, new player → right)
- Clicking opponent team name in MatchCard header: from left panel opens split on right; from right panel swaps (current panel → left, new team → right)
- Clicking active opponent player name in MatchCard (above heatmap): same split/swap logic as foul-involved player click
- Clicking opponent team in TeamView/MatchCard: swaps panels or opens team in split
- Each panel navigates independently
- Right panel back button shows contextual labels at each hierarchy level (league name, country name, "Paesi"); hidden only when panel 0 is team view and panel 1 player is from the same team
- Clicking opponent team in TeamView passes full navigation context (leagueId, leagueName, countryId, countryName) derived from the match tournament and `COUNTRIES` config, so back button works through the full hierarchy
- Left panel back button shows team name or "Indietro"
- SearchBar only shown inside individual views when NOT in split mode; in split mode the `topBar` in `ContentPanel` shows two separate SearchBars (one per panel, each 50% width)
- Navigation components (CountryList, LeagueList, TeamGrid, HomePage) accept `panelIndex` prop for panel-aware navigation

## SofaScore API Endpoints

All via `/api/sofascore/` prefix. Images via `/api/img/`.

| Endpoint | Purpose | Used in |
|----------|---------|---------|
| `sport/football/categories` | Football categories list | (available, not yet used) |
| `search/all?q={query}` | Global player search | SearchBar |
| `unique-tournament/{id}/seasons` | Tournament seasons | LeagueList, TeamGrid |
| `unique-tournament/{id}/season/{id}/standings/total` | Teams from standings | TeamGrid |
| `team/{id}/players` | Team roster | TeamView |
| `team/{id}/events/next/0` | Next match | TeamView |
| `event/{id}/lineups` | Formation + players; used in fetchMatchDetails to detect didNotPlay and build jerseyMap | TeamView, useMatchDetails |
| `event/{id}/comments` | Match chronicle (foul narrative only) | useMatchDetails |
| `event/{id}/player/{id}/statistics` | Official player match statistics (fouls, wasFouled, minutes, rating, etc.) | useMatchDetails |
| `event/{id}/average-positions` | Player avg positions | MatchCard (on-demand, only when card is opened) |
| `player/{id}` | Player info (includes current team) | PlayerPage |
| `player/{id}/statistics/seasons` | Player tournament list | usePlayerData |
| `player/{id}/unique-tournament/{tid}/season/{sid}/statistics/overall` | Season stats | usePlayerData |
| `player/{id}/events/last/{page}` | Match history (paginated) + statisticsMap + incidentsMap + onBenchMap | useMatchTimeline |
| `event/{id}/player/{id}/heatmap` | Player heatmap points for a match | HeatmapField |
| `team/{id}/image`, `player/{id}/image`, etc. | Images | via /api/img/ |

## Business Logic

### Foul Pairing (foulPairing.ts)
Parses match `comments[]` to extract fouls for a specific player:
- `freeKickLost` + adjacent `freeKickWon` = committed foul (finds victim)
- `freeKickWon` + adjacent `freeKickLost` = suffered foul (finds fouler)
- Handball detected by keyword in text
- Zone text translated from English to Italian ("in the defensive half" -> "nella propria meta campo")
- Substitutions extracted from `type: 'substitution'` comments

### Stats Calculator (statsCalculator.ts)
Still exists for season/tournament aggregation from `/statistics/overall`, but the player page match-by-match numbers now come from official per-match player statistics.

### Derived Stats (PlayerPage.tsx)
All statistics shown in `StatsOverview` are computed via a single `derivedStats` useMemo over visible matches with `officialStatsStatus === 'loaded'`. Source of truth is `event/{id}/player/{id}/statistics` plus incident/card seeds from `player/{id}/events/last/{page}`. Comments are never used as numeric source of truth.

Per ogni partita caricata:
- `officialStats.fouls` → falli commessi ufficiali
- `officialStats.wasFouled` → falli subiti ufficiali
- `officialStats.minutesPlayed` → minutaggio ufficiale
- `cardInfo` → yellow / red / yellowRed da incidents seed o comments fallback narrativo

Output di `derivedStats`:
- `stats: AggregatedStats` — totalFoulsCommitted, totalFoulsSuffered, totalMinutesPlayed, totalAppearances, avgFoulsCommittedPerMatch, avgFoulsCommittedPer90, avgFoulsSufferedPerMatch, avgFoulsSufferedPer90, totalYellowCards, totalRedCards, avgYellowCardsPerMatch, avgRedCardsPerMatch
- `committedHitRate: { over, total }` — partite con falli commessi > committedLine
- `sufferedHitRate: { over, total }` — partite con falli subiti > sufferedLine

### Did Not Play Detection (useMatchDetails.ts)
Rilevato combinando fonti indipendenti:
- `onBenchMap` da `player/{id}/events/last/{page}`
- `officialStats.minutesPlayed`
- `lineups` se disponibili
- `comments` solo per l'eventuale minuto di ingresso, non come prerequisito
- Le partite `didNotPlay` vengono escluse da `displayEvents` in `PlayerPage` e auto-deselezionate quando i dettagli confermano che il giocatore non è entrato
- In modalità `Ultime N`, l'esclusione `didNotPlay` avviene prima del taglio a N, così il conteggio mostra sempre N partite realmente valide

### Jersey Map (useMatchDetails.ts)
Costruita in `fetchMatchDetails` dopo il caricamento delle lineups:
- `jerseyMap: Map<number, string>` — mappa `playerId → jerseyNumber`
- Popolata iterando su `[...lineups.home.players, ...lineups.away.players]`
- Salvata in `CachedMatchDetails` e usata in `MatchCard` per mostrare il numero di maglia nei commenti dei falli

### Average Positions (MatchCard.tsx)
Caricata on-demand tramite `getMatchAveragePositions(event.id)` dentro un `useEffect` in `MatchCard`, solo quando la card viene renderizzata. Non più caricata nel loop progressivo di `useMatchTimeline`. Stato locale `positions` in `MatchCard` (useState), inizialmente `null`, popolato al primo render della card.

### Hit Rate (PlayerPage.tsx)
Parte di `derivedStats` (vedi sopra). Calcolato sulle partite visibili con statistiche ufficiali disponibili. Cresce progressivamente.
- `committedHitRate` = `{ over, total }` dove `over` = partite con falli commessi > `committedLine`
- `sufferedHitRate` = `{ over, total }` dove `over` = partite con falli subiti > `sufferedLine`

### Position Mapping (positionMapping.ts)
- SofaScore coords: `avgX` 0-100 (own goal to opponent), `avgY` 0-100 (right to left)
- Home team maps to top half of SVG, away team to bottom half (inverted)
- 13+ hardcoded formation templates; unknown formations auto-distributed

## Hardcoded Countries & Leagues

| Country | categoryId | Leagues (uniqueTournament ID) |
|---------|-----------|-------------------------------|
| Italia | 31 | Serie A (23), Serie B (53) |
| Inghilterra | 1 | Premier League (17), Championship (18) |
| Spagna | 32 | La Liga (8), La Liga 2 (54) |
| Germania | 30 | Bundesliga (35), 2. Bundesliga (44) |
| Francia | 7 | Ligue 1 (34), Ligue 2 (182) |
| Europa | 1465 | Champions League (7), Europa League (679), Conference League (17015), Supercoppa UEFA (341) |

Defined in `CountryList.tsx`.

## Design System

### Theme (CSS variables in index.css)
- Background: `--color-bg: #0d0f11`, sidebar: `#11141a`, surface: `#151a22`
- Borders: `--color-border: #1e2530`, hover: `#4ade80`
- Accent: `--color-neon: #4ade80` (green), `--color-negative: #E24B4A` (red)
- Text: primary `#e0e0e0`, secondary `#8a96a6`, muted `#5a6a7a`
- Field: bg `#1a3320`, lines `#2a5535`
- Cards: yellow `text-yellow-400 / bg-yellow-400/15 / border-yellow-400`
- Hit rate card: percentuale `text-lg font-bold`, rapporto inline `text-xs font-normal text-text-muted ml-1`, label `text-xs text-text-muted uppercase tracking-wide`

### Responsive Breakpoints
- Mobile (<768px): sidebar hidden, hamburger overlay, single panel
- Tablet (768px+): sidebar fixed 210px, content fills remaining
- Desktop (1024px+): same + split view available

### Scrollbar
`html { scrollbar-gutter: stable }` — prevents layout shift when navigating between views with different content heights (scrollbar appearing/disappearing changes content width).

### Field SVG
Dimensions: 680x1050 (aspect-ratio 68/105). Home team top half, away bottom half.

## Rules & Constraints

- All data from SofaScore via proxy — never invent data
- All images via `/api/img/` proxy — never direct SofaScore URLs
- Field always `aspect-ratio: 68/105` — never stretched
- Foul colors: green (`--color-neon`) = suffered, red (`--color-negative`) = committed
- Card colors: yellow (`yellow-400`) = yellow card, red (`--color-negative`) = red card
- Match comments from API are in English — zone text must be translated to Italian
- Numbers always rounded — no long decimals (use `.toFixed(2)`)
- Split view only above 1024px width
- Match timeline: horizontal scrollable bar with all matches, foul count badges loaded progressively
- Match cards: always open (not expandable), selectable via timeline; most recent 3 pre-selected on desktop, 1 on mobile
- Every `Periodo` change resets the card selection back to automatic preselection (latest 3 on desktop, 1 on mobile), exactly like a season-context change
- Match selection uses a context-level default (`latest 3`, `all`, or `none`) plus per-match overrides, so `Seleziona tutte` / `Deseleziona tutte` keep affecting newly visible matches inside the same period when tournament or venue filters change
- In `Periodo = Ultime N`, `useMatchTimeline` riceve un `maxEvents = N * 3` fisso e tutte le season ID del giocatore, così il pool viene caricato una sola volta attraverso tutte le stagioni; i toggle campionati lavorano solo sul display e non fanno refetch
- Match details caricati in 4 code parallele dopo events/last: (1) **officialStats** via `event/{id}/player/{id}/statistics` per tutte le partite (batch 8, 100ms) — `initialStatsLoaded` scatta dopo il primo batch (prime 5); (2) **lineups** per tutte le partite (batch 5, 150ms) → `allLineupsLoaded` abilita filtro Titolare; (3) **rich data** (comments) solo per ultime 5 partite (batch 2, 200ms); (4) per le altre partite, comments caricati lazy al primo render della card selezionata via `onRequestRichDetails`; average-positions on-demand in MatchCard; tutto cached per sessione
- Card layout: 1 card = 100%, 2 = `calc(50%-4px)`, 3+ = `calc(33.333%-6px)` (flexbox wrap, gap-compensated); 100% below `md:` (768px) and in split view
- Player who changed team mid-season: separate matches with visual divider showing team name
- MatchCard layout modes driven by `cardCount`: single (1 card, landscape FieldMap), double (2 cards, portrait FieldMap), multi (3+ cards, portrait FieldMap)
- MatchCard active player: clicking a dot in FieldMap sets the active player; shows their season averages (aggregated across all selected tournaments) left of heatmap, and their own match foul counts right of heatmap; hidden when active player is the main PlayerPage player
- MatchCard mirrored perspective: showCommitted filter → show active player's suffered stats (they're the victim); showSuffered → show active player's committed stats; both/neither → show all 4 boxes
- FieldMap `involvedPlayerIds` filtered by current foul type: committed shows fouled victims, suffered shows foulers; if active player is no longer in the involved set after a filter change, selection resets to main player
- MatchTimeline has a select/deselect all toggle button that syncs with the current selection state
- MatchTimeline has an `isBackgroundLoading` prop: when true a small green spinner appears next to "Timeline partite (N)"
- Stat cards: compact sizing `p-2.5` padding, `text-lg` value font size, `text-xs` label
- Righe committed/suffered in `StatsOverview`: sempre `grid-cols-4`; quarto card è `HitRateCard` (label "Over X.5", percentuale, rapporto inline)
- Le righe committed/suffered in `StatsOverview` scompaiono completamente dal DOM se il rispettivo filtro è inattivo — nessuna opacity, condizione `{showCommitted && ...}` / `{showSuffered && ...}`
- Nessun segno di spunta (✓) sui bottoni filtro
- Partite in cui il giocatore era in panchina senza mai entrare (`didNotPlay: true`) vengono escluse completamente dalla timeline e da tutti i calcoli
- MatchCard: nome squadra avversaria nell'header e nome giocatore avversario attivo (sopra heatmap) sono cliccabili con `text-text-primary hover:text-neon hover:underline transition-colors`; i bottoni nei commenti falli restano `text-neon` fisso
- MatchCard: nei commenti falli, il numero di maglia del giocatore coinvolto appare tra parentesi dopo il nome, fuori dal `<button>` cliccabile, in `text-text-muted`
- StatsOverview è condizionato a `derivedStats !== null`; non c'è spinner di caricamento statistiche separato — i dati appaiono quando le prime partite sono caricate
- PlayerPage: full-page loader (`initialLoadComplete`) scatta quando `initialStatsLoaded === true` (dopo il primo batch officialStats, prime 5 partite — più veloce della vecchia attesa di stats+comments+lineups); per i cambi di periodo/stagione viene mostrato solo uno spinner nella sezione timeline; se `showStartersOnly && !allLineupsLoaded` viene mostrato un loader contestuale per le formazioni

## Filters

### Periodo filter (ex Stagione)
- State lives in `usePlayerData` as `selectedPeriod: SelectedPeriod` (type exported from `usePlayerData.ts`)
- `SelectedPeriod` can be `'last'` or a specific season year string
- `currentSeasonYear` is auto-derived: if `selectedPeriod === 'last'`, always uses `availableSeasonYears[0]` (most recent season)
- The `availableSeasonYears` sync must preserve an already-selected `last N` period; only invalid season-year selections are reset to the most recent season
- Rendered in `PlayerFilters` colonna 2 as `<select>` with grouped options: first group = "Ultime N" options, second group = seasons by year
- Label changed from "Stagione:" to "Periodo:"
- In modalità `Ultime N`, il caricamento non dipende dai toggle UI: `PlayerPage` passa a `useMatchTimeline` tutte le `seasonId` del giocatore e `maxEvents = N * 3`, così il fetch iniziale costruisce un pool fisso abbastanza ampio da coprire i filtri locali senza nuovi caricamenti

### Campionati filter
- In modalità `season`, le opzioni coincidono con `allTournamentsForSeason` e il filtro continua a lavorare come prima sul set stagionale corrente
- In modalità `Ultime N`, le opzioni vengono derivate solo dalle N partite valide correnti: `allEvents` -> esclusione `didNotPlay` -> `slice(0, N)` -> estrazione dei tornei unici
- I toggle campionati in modalità `Ultime N` sono solo di display: filtrano quel sottoinsieme locale di N partite e non attivano nessun refetch o ricalcolo del pool caricato
- Se si disattiva l'unico campionato attivo, il successivo nella lista viene attivato automaticamente prima del toggle

### Venue filter (Casa / Trasferta)
- State lives in `usePlayerData` as `showHome` / `showAway` (both `true` by default)
- Rendered in `PlayerFilters` colonna 2, affiancati, con Periodo sotto
- Toggle logic: se si disattiva l'unico filtro attivo, l'altro viene attivato automaticamente prima (nessun click ignorato)
- In `PlayerPage`, applied inside `displayEvents` useMemo on `allEvents`
- In `PlayerPage`, il filtro sede viene applicato dopo la costruzione del set base (`Ultime N` valide oppure stagione filtrata), quindi non influenza mai il caricamento dal backend
- Lato/campo determinato da `CachedMatchDetails.playerSide: 'home' | 'away' | undefined`, derivato dalle lineup (`derivePlayerSide` in `useMatchDetails.ts`): controlla se il `playerId` è in `lineups.home.players` o `lineups.away.players`
- `playerSide` viene propagato dall'Effetto 3 di `useMatchTimeline` (lineup loader) via patch su `detailsMap`
- Fallback per lineup non ancora caricate: confronto diretto `homeTeam.id === player.team.id`; se nemmeno questo risolve (es. partite di nazionali prima del caricamento lineup), la partita viene inclusa temporaneamente (`isHome === null → return true`)
- Necessario per le nazionali: `player.team` è sempre il club corrente, non la nazionale, quindi il confronto per ID fallirebbe

### Starter filter (Titolare)
- State lives in `usePlayerData` as `showStartersOnly` (`false` by default)
- Rendered in `PlayerFilters` colonna 2, come bottone affiancato a destra del `<select>` del periodo, sulla stessa riga
- Sempre visibile ma `disabled` finché `allLineupsLoaded === false`; diventa cliccabile solo quando tutte le partite hanno caricato le formazioni
- Quando attivo mostra solo le partite in cui il giocatore è partito titolare (non dalla panchina)
- Logica: una partita è "da titolare" se `CachedMatchDetails.isStarter === true`, flag derivato direttamente da `event/{id}/lineups` (`lineupPlayer.substitute !== true`)
- Filtro applicato in `PlayerPage` dentro `displayEvents` useMemo **solo quando `allLineupsLoaded === true`**; se le lineups non sono ancora pronte, `displayEvents` restituisce `[]` per evitare dati parziali
- Quando `showStartersOnly && !allLineupsLoaded`: PlayerPage mostra un loader contestuale ("Caricamento formazioni...") e nasconde StatsOverview e Timeline
- Dipendenze del `useMemo`: `allEvents`, `showHome`, `showAway`, `resolvedPlayer?.team?.id`, `showStartersOnly`, `detailsMap`, `selectedPeriod`, `allLineupsLoaded`
- Le lineups vengono precaricate per tutte le partite in background da `useMatchTimeline` (loop separato, batch 5, 150ms); il filtro non dipende dai comments rich né dalla selezione delle card

### Did Not Play filter (automatico, non configurabile dall'utente)
- Non è un filtro esplicito: le partite in cui il giocatore era in panchina senza mai entrare vengono escluse automaticamente
- Rilevato in `fetchMatchDetails` confrontando lineups e commenti (vedi sezione Business Logic)
- Applicato come primo step in `displayEvents` useMemo in `PlayerPage`
- In modalità `season`, il filtro campionati della stagione sceglie prima il perimetro; in modalità `Ultime N`, invece, `didNotPlay` viene escluso prima del `slice(N)`
- Le opzioni `Ultime 5/10/...` vengono applicate solo dopo questa esclusione, così il conteggio mostra sempre N partite effettivamente valide
- Le partite vengono mostrate finché i dettagli non sono caricati (return true se details undefined), poi spariscono automaticamente se `didNotPlay: true`
- In `useMatchTimeline`, le partite `didNotPlay` vengono anche auto-deselezionate dalla selezione attiva non appena i dettagli del batch vengono caricati

### Mostra filter (Falli commessi / Falli subiti / Cartellini)
- State lives in `usePlayerData` as `showCommitted` / `showSuffered` (both `true` by default) and `showCards` (`false` by default)
- Rendered in `PlayerFilters` colonna 3, in verticale
- Toggle logic: se si disattiva l'unico filtro attivo, il successivo nell'array `[committed, suffered, cards]` viene attivato automaticamente (con wrap circolare); nessun click ignorato
- `showCards` controls visibility of the 4 card stat boxes in `StatsOverview`

### Line filter (Over X.5)
- State: `committedLine` / `sufferedLine` in `usePlayerData` (default `0.5`, range `0.5`→`9.5` step `1`)
- Rendered in `PlayerFilters` colonna 3, `<select>` affiancato al rispettivo bottone
- Dropdown sempre visibile; `disabled` + `opacity-40` quando il rispettivo filtro è inattivo
- Passato a `StatsOverview` per il label "Over X.5" e il calcolo della `HitRateCard`
- Hit rate calcolato in `derivedStats` su `displayEvents ∩ detailsMap`

### PlayerFilters layout
- 3-column grid (`grid-cols-3 gap-6`)
- Width: `w-1/2` in full-screen, `w-full` in split view — controlled via `isSplitView` prop passed from `PlayerPage`
- All buttons and labels use `text-xs` and `px-2 py-1` for compact sizing
- Colonna 1 and 3 use `items-start` on the flex container so buttons shrink to content width
- Colonna 2: bottoni Casa/Trasferta affiancati; sotto, sulla stessa riga, il `<select>` periodo e il bottone Titolare affiancati; Titolare usa stato `disabled` + `opacity-40` finché `allLineupsLoaded` è `false`
- Colonna 3: ogni bottone (Falli commessi, Falli subiti) ha affiancato un `<select>` 0.5→9.5 sempre visibile, disabilitato e scurito (`opacity-40`) se il filtro è inattivo
- Nessun segno di spunta (✓) sui bottoni filtro

### Filter toggle behavior (all filters)
- **Campionati**: se si disattiva l'unico campionato attivo, il successivo nella lista viene attivato automaticamente prima del toggle
- **Campionati** in `Ultime N`: la lista mostra solo i tornei presenti nelle N partite valide correnti; il toggle aggiorna solo il display locale, senza refetch
- **Casa/Trasferta**: se si disattiva l'unico attivo, l'altro viene attivato automaticamente
- **Falli commessi/subiti/Cartellini**: se si disattiva l'unico attivo, il successivo nell'array (con wrap circolare) viene attivato automaticamente
- Nessun filtro viene mai bloccato — il click non viene mai ignorato

## Workflow Rules

These rules MUST be followed automatically on every task, without the user asking.

### Git Workflow
1. **Before starting work**: check `git status`, current branch, and list existing branches (`git branch`)
2. **Reuse or create a branch BEFORE making any code changes**: if an existing feature branch is relevant to the current change, switch to it. Only create a new branch (`feature/<short-description>` from `master`) if no suitable branch exists. Never edit files while still on `master`
3. **Commit often** with clear, concise messages describing the "why"
4. **When the task is complete**: push the branch, create a PR via `gh pr create`, and merge it into `master` via `gh pr merge` (squash merge preferred)
5. **After merge**: switch back to `master` and pull

### Keep CLAUDE.md Up-to-Date
After every change that affects the project structure, architecture, or conventions:
1. Update the relevant section(s) of this file (CLAUDE.md)
2. Include the CLAUDE.md update in the same commit as the code change
3. Examples of changes that require an update: new files/components, new API endpoints, new context/hooks, changed navigation logic, new utilities, changed design tokens
