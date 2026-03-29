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

## Project Structure

```
stats-analyzer/
├── package.json                     # Monorepo: concurrently runs server + client
├── server/
│   └── index.js                     # Express proxy (2 routes: /api/sofascore/*, /api/img/*)
└── client/
    ├── vite.config.ts               # Proxy /api -> :3001, alias @ -> src/
    ├── src/
    │   ├── App.tsx                   # Root: wraps NavigationProvider, renders Sidebar + ContentPanel
    │   ├── index.css                 # Tailwind imports + custom CSS theme variables
    │   ├── types/index.ts            # All TypeScript interfaces
    │   ├── api/sofascore.ts          # All API functions (typed, cached 5min, retry x3 with backoff)
    │   ├── context/
    │   │   └── NavigationContext.tsx  # useReducer state for all navigation + split view
    │   ├── hooks/
    │   │   ├── usePlayerData.ts      # Fetches player seasons/stats, manages filters (showCommitted, showSuffered, showHome, showAway, showCards)
    │   │   ├── useMatchDetails.ts    # Fetches match fouls + positions; exports shared cache + fetchMatchDetails(eventId, playerId) callable for any player
    │   │   ├── useMatchTimeline.ts   # Loads all match events eagerly, progressive detail loading, selection state, selectAll/deselectAll
    │   │   └── useSplitCardSync.ts   # Cross-panel card height sync via module-level registry + useLayoutEffect
    │   ├── utils/
    │   │   ├── foulPairing.ts        # Extracts fouls from match comments, pairs them, translates zones
    │   │   ├── statsCalculator.ts    # Aggregates stats across tournaments (per-match, per-90, yellow/red cards)
    │   │   └── positionMapping.ts    # SofaScore coords -> SVG coords, 13+ formation templates
    │   ├── pages/
    │   │   ├── HomePage.tsx          # Landing with search bar
    │   │   └── PlayerPage.tsx        # Player analysis: stats + timeline + selectable match cards; computes venueFilteredEvents from showHome/showAway
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
    │       │   ├── PlayerFilters.tsx # 3-column layout: col1=Competizioni(vertical), col2=Sede+Stagione, col3=Mostra(vertical); isSplitView prop controls w-full vs w-1/2
    │       │   ├── StatsOverview.tsx # Stat cards grid: committed(3 cols), suffered(3 cols), cards(4 cols when showCards); compact sizing (p-2.5, text-lg)
    │       │   ├── MatchTimeline.tsx # Horizontal scrollable match timeline with foul badges + select/deselect all toggle
    │       │   ├── MatchCard.tsx     # Always-open match card: foul list, FieldMap, Heatmap, active player stats overlay
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
| `event/{id}/lineups` | Formation + players | TeamView |
| `event/{id}/comments` | Match chronicle (fouls) | useMatchDetails |
| `event/{id}/average-positions` | Player avg positions | useMatchDetails |
| `player/{id}` | Player info (includes current team) | PlayerPage |
| `player/{id}/statistics/seasons` | Player tournament list | usePlayerData |
| `player/{id}/unique-tournament/{tid}/season/{sid}/statistics/overall` | Season stats (includes yellowCards, redCards) | usePlayerData, MatchCard (active player) |
| `player/{id}/events/last/{page}` | Match history (paginated) | usePlayerData |
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
Aggregates across multiple tournaments: sums fouls/minutes/appearances/yellowCards/redCards, then calculates:
- `avgPerMatch = totalFouls / appearances`
- `avgPer90 = (totalFouls * 90) / minutesPlayed`
- `avgYellowCardsPerMatch = totalYellowCards / appearances`
- `avgRedCardsPerMatch = totalRedCards / appearances`

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
- Match details loaded progressively in background (selected first, then remaining in batches of 3), cached for session
- Card layout: 1 card = 100%, 2 = `calc(50%-4px)`, 3+ = `calc(33.333%-6px)` (flexbox wrap, gap-compensated); 100% below `md:` (768px) and in split view
- Player who changed team mid-season: separate matches with visual divider showing team name
- MatchCard layout modes driven by `cardCount`: single (1 card, landscape FieldMap), double (2 cards, portrait FieldMap), multi (3+ cards, portrait FieldMap)
- MatchCard active player: clicking a dot in FieldMap sets the active player; shows their season averages (aggregated across all selected tournaments) left of heatmap, and their own match foul counts right of heatmap; hidden when active player is the main PlayerPage player
- MatchCard mirrored perspective: showCommitted filter → show active player's suffered stats (they're the victim); showSuffered → show active player's committed stats; both/neither → show all 4 boxes
- FieldMap `involvedPlayerIds` filtered by current foul type: committed shows fouled victims, suffered shows foulers; if active player is no longer in the involved set after a filter change, selection resets to main player
- MatchTimeline has a select/deselect all toggle button that syncs with the current selection state
- Stat cards: compact sizing `p-2.5` padding, `text-lg` value font size, `text-xs` label

## Filters

### Venue filter (Casa / Trasferta)
- State lives in `usePlayerData` as `showHome` / `showAway` (both `true` by default)
- Rendered in `PlayerFilters` colonna 2, affiancati, con Stagione sotto
- "At least one always active" logic: if the active one is the only one active, click is ignored
- In `PlayerPage`, `venueFilteredEvents` is computed via `useMemo` **after** the `useMatchTimeline` destructuring, filtering `filteredEvents` by comparing `event.homeTeam.id` to `resolvedPlayer?.team?.id`; when both filters are active the full list is returned unfiltered
- `venueFilteredEvents` is passed to `MatchTimeline` (as `events`) and used for `selectedEvents` and `toggleMode` sync; `selectAll` / `deselectAll` from `useMatchTimeline` still operate on the full unfiltered set

### Mostra filter (Falli commessi / Falli subiti / Cartellini)
- State lives in `usePlayerData` as `showCommitted` / `showSuffered` (both `true` by default) and `showCards` (`false` by default)
- Rendered in `PlayerFilters` colonna 3, in verticale
- "At least one always active" logic: `activeCount = [showCommitted, showSuffered, showCards].filter(Boolean).length` — if the toggle being deactivated is the only active one, click is ignored. Adding future toggles: just add the new value to this array.
- `showCards` controls visibility of the 4 card stat boxes in `StatsOverview` (gialli totali, rossi totali, media gialli/partita, media rossi/partita) displayed in a `grid-cols-4` row

### PlayerFilters layout
- 3-column grid (`grid-cols-3 gap-6`)
- Width: `w-1/2` in full-screen, `w-full` in split view — controlled via `isSplitView` prop passed from `PlayerPage`
- All buttons and labels use `text-xs` and `px-2 py-1` for compact sizing
- Colonna 1 and 3 use `items-start` on the flex container so buttons shrink to content width

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