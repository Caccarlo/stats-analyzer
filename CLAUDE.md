# Stats Analyzer

Football/soccer foul analysis web app. Users navigate Countries > Leagues > Teams > Players, or search directly, to view foul statistics, match-by-match breakdowns with field position maps, and side-by-side player comparison via split view. UI is in Italian.

## Stack & Setup

| Layer | Tech | Port |
|-------|------|------|
| Client | React 19, TypeScript 5.9, Vite 8, Tailwind CSS 4 | 5173 |
| Server | Express 4 (CORS proxy to SofaScore) | 3001 |

No database, no auth, no API keys. All data comes from the public SofaScore API through the Express proxy.

```bash
npm run install:all
npm start
```

### Killing Stuck Processes (Windows)

`taskkill` does not work correctly in Git Bash because `/PID` is parsed like a path. Use PowerShell instead.

```bash
# Find PIDs listening on ports 3001 and 5173
netstat -ano | grep -E "LISTENING" | grep -E ":3001 |:5173 "

# Kill by PID
powershell -Command "Stop-Process -Id 1234 -Force -ErrorAction SilentlyContinue; Stop-Process -Id 5678 -Force -ErrorAction SilentlyContinue"
```

## Project Structure

```text
stats-analyzer/
|-- package.json                     # Monorepo: concurrently runs server + client
|-- server/
|   `-- index.js                     # Express proxy (/api/sofascore/* and /api/img/*)
`-- client/
    |-- vite.config.ts               # Proxy /api -> :3001, alias @ -> src/
    |-- tsconfig.app.json            # Client TS config
    `-- src/
        |-- App.tsx                  # Root: wraps NavigationProvider, renders Sidebar + ContentPanel
        |-- index.css                # Tailwind imports + theme variables
        |-- types/index.ts           # Shared TypeScript interfaces
        |-- api/sofascore.ts         # All API functions, client cache, retry with backoff
        |-- context/
        |   `-- NavigationContext.tsx
        |-- hooks/
        |   |-- usePlayerData.ts     # Seasons/stats + all player filter state, including selectedPeriod
        |   |-- useMatchDetails.ts   # Shared match-details cache and helpers for officialStats, lineups, rich comments
        |   |-- useMatchTimeline.ts  # events/last loader + progressive officialStats/lineups/rich data queues
        |   `-- useSplitCardSync.ts  # Cross-panel card height sync
        |-- utils/
        |   |-- foulPairing.ts
        |   |-- statsCalculator.ts
        |   `-- positionMapping.ts
        |-- pages/
        |   |-- HomePage.tsx
        |   `-- PlayerPage.tsx       # Player analysis, derived filters, selection state, stats, timeline, cards
        `-- components/
            |-- layout/
            |   |-- Sidebar.tsx
            |   |-- ContentPanel.tsx
            |   `-- SearchBar.tsx
            |-- navigation/
            |   |-- CountryList.tsx
            |   |-- LeagueList.tsx
            |   |-- TeamGrid.tsx
            |   |-- TeamView.tsx
            |   `-- SidebarTeamList.tsx
            |-- player/
            |   |-- PlayerHeader.tsx
            |   |-- PlayerFilters.tsx
            |   |-- StatsOverview.tsx
            |   |-- MatchTimeline.tsx
            |   |-- MatchCard.tsx
            |   |-- FieldMap.tsx
            |   `-- HeatmapField.tsx
            `-- common/
                |-- Badge.tsx
                `-- PlayerDot.tsx
```

## Architecture

```text
Browser (5173) -> React App -> sofascore.ts
    -> Vite dev proxy /api/* -> Express (3001)
        -> sofascore.com/api/v1/*      # JSON data
        -> api.sofascore.app/api/v1/*  # images
```

- Server: minimal proxy with browser-like headers and in-memory TTL cache.
- Client: no React Router; navigation is reducer-driven through `NavigationContext`.
- Match details are loaded progressively by `useMatchTimeline`, with cache reuse in `useMatchDetails`.

## Navigation & Split View

### View Hierarchy

```text
home -> leagues -> teams -> team -> player
```

### Reducer Actions

- `SET_VIEW`
- `GO_BACK`
- `OPEN_SPLIT`
- `CLOSE_SPLIT`
- `SWAP_SPLIT_AND_OPEN`
- `RESET`

### Split View Rules

- Split view is desktop-only, starting at `lg` / 1024px.
- Panels are independent and render 50/50.
- Team and player views can open the opposite side in split mode.
- Opponent team/player clicks inside match UI can open or swap the other panel.
- SearchBar is shared in single view and duplicated per panel in split view.

## SofaScore API Endpoints

All JSON calls go through `/api/sofascore/*`. Images go through `/api/img/*`.

| Endpoint | Purpose | Used in |
|----------|---------|---------|
| `sport/football/categories` | Football categories list | available, not currently used |
| `search/all?q={query}` | Global player search | SearchBar |
| `unique-tournament/{id}/seasons` | Tournament seasons | LeagueList, TeamGrid |
| `unique-tournament/{id}/season/{id}/standings/total` | Teams from standings | TeamGrid |
| `team/{id}/players` | Team roster | TeamView |
| `team/{id}/events/next/0` | Next match | TeamView |
| `event/{id}/lineups` | Formation + players | TeamView, useMatchDetails |
| `event/{id}/comments` | Match chronicle and foul narrative | useMatchDetails |
| `event/{id}/player/{id}/statistics` | Official player match stats | useMatchDetails, useMatchTimeline |
| `event/{id}/average-positions` | Average positions | MatchCard |
| `player/{id}` | Player info, including current team | PlayerPage |
| `player/{id}/statistics/seasons` | Player tournament/season list | usePlayerData |
| `player/{id}/unique-tournament/{tid}/season/{sid}/statistics/overall` | Aggregated season stats | usePlayerData, MatchCard |
| `player/{id}/events/last/{page}` | Match history plus statistics/incidents/onBench seeds | useMatchTimeline |
| `event/{id}/player/{id}/heatmap` | Match heatmap for a player | HeatmapField |
| `team/{id}/image`, `player/{id}/image`, etc. | Images | `/api/img/*` |

## Business Logic

### Foul Pairing

`foulPairing.ts` parses match comments to build foul matchups:

- `freeKickLost` + adjacent `freeKickWon` -> committed foul
- `freeKickWon` + adjacent `freeKickLost` -> suffered foul
- handball is derived from comment text
- zone text is translated to Italian
- substitutions are derived from substitution comments

### Stats Source Of Truth

- PlayerPage match-by-match numbers come from official per-match statistics, not from comments.
- `officialStats.fouls` drives committed fouls.
- `officialStats.wasFouled` drives suffered fouls.
- `officialStats.minutesPlayed` drives minute totals.
- Cards come from incidents seed first, with comments only as fallback.

### Did Not Play

`didNotPlay` is derived by combining:

- `onBenchMap` from `player/{id}/events/last/{page}`
- official minutes
- lineups when available
- substitution comments only as optional support

Matches marked `didNotPlay` are removed from PlayerPage display and statistics.

### Ultime N

- `selectedPeriod` can be either `{ type: 'last', count }` or `{ type: 'season', year }`.
- In `Ultime N`, PlayerPage passes all player season IDs to `useMatchTimeline` plus `maxEvents = N * 3`.
- `useMatchTimeline` keeps paging across seasons until it reaches `maxEvents` or the API ends.
- `PlayerPage` builds `lastPeriodBaseEvents = allEvents -> exclude didNotPlay -> slice(N)`.
- Tournament options in `Ultime N` are derived from that same `lastPeriodBaseEvents` base.
- Tournament, venue, and starter filters are applied locally on that fixed `N`-match base without refetching.

## Current Loading Model

After `events/last` returns the event list plus seeds, `useMatchTimeline` runs four queues:

1. officialStats for all matches, batch size 8
2. lineups for all matches, batch size 5
3. rich comments for the first 5 non-`didNotPlay` matches, batch size 2
4. lazy rich comments for other selected cards through `requestRichDetails(eventId)`

Other current behavior:

- In season mode, the pager can stop after the first irrelevant page once it has already found relevant season matches.
- In cross-season `Ultime N`, that early stop is disabled.
- `useMatchTimeline` keeps an in-memory cache both for `player/{id}/events/last/{page}` responses and for fully-built timeline snapshots keyed by `{playerId, seasonIdsKey, maxEvents}`.
- When switching period/season, `useMatchTimeline` first tries to hydrate from the timeline snapshot cache; if that context was never opened, it can still rebuild synchronously from cached `events/last` pages plus `matchDetailsCache` and skip the section loader when those pages already cover the target context.
- Queue effects exit immediately when their corresponding `all*Loaded` flag is already true, and artificial inter-batch delays are skipped when the whole batch was cache hits.
- PlayerPage shows a section loader while `loadingEvents || !allOfficialStatsLoaded || !allLineupsLoaded || !recentRichLoaded`.
- `MatchTimeline` always shows the visible match count in the header and a select/deselect-all toggle.
- In timeline cards, foul badges show `0` when official stats loaded a real zero, and `-` only when the foul value is still unavailable after loading.
- In `MatchCard`, the mini foul counters beside the field/heatmap show a spinner while the selected comparison player is still loading, then show either a real number (including `0`) or `-` when the stat is unavailable.

## Filters

### Filter state persistence

All user-set filter values (`selectedPeriod`, `enabledTournaments`, `showCommitted`, `showSuffered`, `showHome`, `showAway`, `showCards`, `showStartersOnly`, `committedLine`, `sufferedLine`) are persisted inside the panel's `PanelState.filterState` in NavigationContext via `updatePanelFilters`. `usePlayerData` accepts `initialFilterState` and `onFiltersChange` to read/write this state. Because `PanelState` travels with the panel during `CLOSE_SPLIT`, filters survive split↔fullscreen transitions. When a panel is truly closed (the other side of a split close), its `PanelState` is discarded and the next open starts from defaults.

Additional rules:
- `SET_VIEW` clears `filterState` when `playerId` changes, so navigating to a different player always starts from defaults.
- The tournament auto-enable effect in `usePlayerData` skips execution while `tournamentSeasons` is still empty (preventing it from overwriting restored state before the API responds), and also skips on the very first load if saved `enabledTournaments` are present.

### Periodo

- Lives in `usePlayerData` as `selectedPeriod`.
- Renders grouped options: `Ultime N` first, then season years.
- The `Titolare` toggle is rendered below the period select, not inline to its right.
- Changing period resets venue/show/cards/starter toggles in PlayerPage.

### Competizioni

- In season mode, available competitions come from the current season.
- In `Ultime N`, available competitions come only from the current `lastPeriodBaseEvents`.
- If the user disables the only active competition, the next one is auto-enabled first.

### Casa / Trasferta

- Controlled by `showHome` and `showAway`.
- Venue detection prefers `playerSide` derived from lineups.
- If lineups are not ready, PlayerPage temporarily falls back to current team ID matching.

### Titolare

- Controlled by `showStartersOnly`.
- Disabled until `allLineupsLoaded === true`.
- Uses `details.isStarter === true` when lineups are loaded.
- If active before lineups are ready during a recompute, PlayerPage returns `[]` rather than partial starter data.

### Mostra

- Controlled by `showCommitted`, `showSuffered`, `showCards`.
- If the user disables the only active display filter, the next filter is auto-enabled.

## Design System

### Theme

- Background: `--color-bg: #0d0f11`
- Sidebar: `#11141a`
- Surface: `#151a22`
- Border: `--color-border: #1e2530`
- Accent green: `--color-neon: #4ade80`
- Accent red: `--color-negative: #E24B4A`
- Text primary: `#e0e0e0`
- Text secondary: `#8a96a6`
- Text muted: `#5a6a7a`
- Field background: `#1a3320`
- Field lines: `#2a5535`

### Layout Rules

- Field must always keep `aspect-ratio: 68/105`.
- Split view is only available above 1024px.
- Card widths:
  - 1 card: `100%`
  - 2 cards: `calc(50% - 4px)`
  - 3+ cards: `calc(33.333% - 6px)`

## Workflow Rules

These rules must be followed automatically on every task.

### Git Workflow

1. Before starting work, check `git status`, current branch, and `git branch`.
2. Reuse or create a branch before making code changes. Do not edit while on `master`.
3. Commit often with concise messages describing why.
4. When complete, push the branch, create a PR with `gh pr create`, and merge with `gh pr merge`.
5. After merge, switch back to `master` and pull.

### Keep CLAUDE.md Up To Date

After every change that affects structure, architecture, or conventions:

1. Update the relevant sections of this file.
2. Include the CLAUDE.md update in the same commit as the code change.
3. Typical triggers: new files, new APIs, new hooks/utilities, navigation changes, design-token changes, or changed loading/filter behavior.
