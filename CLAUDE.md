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
        |-- api/sofascore.ts         # All API functions, client cache, terminal 4xx handling, in-flight dedupe, retry with backoff
        |-- context/
        |   `-- NavigationContext.tsx
        |-- hooks/
        |   |-- usePlayerData.ts     # Seasons/stats + all player filter state, including selectedPeriod
        |   |-- useMatchDetails.ts   # Shared match-details cache and helpers for officialStats, lineups, rich comments
        |   |-- useMatchTimeline.ts  # events/last loader + progressive officialStats/lineups/rich data queues
        |   |-- useTournamentViewData.ts # Shared tournament teams/phases loader with snapshot cache for TeamGrid + SidebarTeamList
        |   `-- useSplitCardSync.ts  # Cross-panel card height sync
        |-- utils/
        |   |-- foulPairing.ts
        |   |-- playerMatchVenue.ts
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
            |   |-- CountryList.tsx     # Top 6 categories pinned first + dynamic full category list from SofaScore
            |   |-- LeagueList.tsx      # Dynamic tournament list for the selected SofaScore category
            |   |-- TeamGrid.tsx         # League standings or cup-phase team grid depending on tournament structure
            |   |-- TeamView.tsx
            |   `-- SidebarTeamList.tsx  # Mirrors the selected league/cup phase team list in the sidebar
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
- Country/category navigation keeps both a UI `countryId` and the SofaScore source-of-truth `countryCategoryId`, so downstream views can keep dynamic country context without relying on hardcoded league mappings.
- Teams navigation can also persist a selected `tournamentPhaseKey` / `tournamentPhaseName` for cup-style competitions, so the main panel and sidebar stay aligned on the chosen phase.
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
- `UPDATE_PANEL_FILTERS`
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
| `sport/football/categories` | Football categories list | CountryList |
| `category/{categoryId}/unique-tournaments` | All tournaments for a football category | LeagueList |
| `search/all?q={query}` | Global player search | SearchBar |
| `unique-tournament/{id}/seasons` | Tournament seasons | TeamGrid |
| `unique-tournament/{id}/season/{id}/standings/total` | Teams from standings | TeamGrid |
| `unique-tournament/{id}/season/{id}/events/last/{page}` | Past tournament matches for phase reconstruction | TeamGrid, SidebarTeamList |
| `unique-tournament/{id}/season/{id}/events/next/{page}` | Upcoming tournament matches for phase reconstruction | TeamGrid, SidebarTeamList |
| `team/{id}/players` | Team roster | TeamView |
| `team/{id}/events/next/0` | Next match | TeamView |
| `event/{id}` | Match metadata (duration, score periods, venue/referee details) | useMatchTimeline |
| `event/{id}/lineups` | Formation + players | TeamView, useMatchDetails |
| `event/{id}/comments` | Match chronicle and foul narrative | useMatchDetails |
| `event/{id}/player/{id}/statistics` | Official player match stats | useMatchDetails, useMatchTimeline |
| `event/{id}/average-positions` | Average positions | MatchCard |
| `player/{id}` | Player info, including current team | PlayerPage |
| `player/{id}/national-team-statistics` | Player national-team history | PlayerPage |
| `player/{id}/statistics/seasons` | Player tournament/season list | usePlayerData |
| `player/{id}/unique-tournament/{tid}/season/{sid}/statistics/overall` | Aggregated season stats | usePlayerData, MatchCard |
| `player/{id}/events/last/{page}` | Match history plus statistics/incidents/onBench seeds | useMatchTimeline |
| `event/{id}/player/{id}/heatmap` | Match heatmap for a player | HeatmapField |
| `team/{id}/image`, `player/{id}/image`, etc. | Images | `/api/img/*` |

## Business Logic

### Tournament Structure

- `TeamGrid` and `SidebarTeamList` both consume `useTournamentViewData`, which resolves the selected/latest season once, reconstructs cup phases or standings once, and keeps a shared in-memory snapshot cache keyed by tournament+season.
- If the tournament exposes meaningful named phases (for example league phase, group stage, round of 16, quarter-finals, semi-finals, final), the app treats it as a phase-based competition instead of relying on `standings/total`.
- A single named knockout-style phase such as `Final` is enough to classify the tournament as phase-based, and even a single generic phase is treated as cup-style when it looks like a compact knockout mini-tournament (few teams, few matches, short date span), preventing pointless standings calls for domestic super cups and similar short cups.
- For phase-based competitions, the teams view shows a phase dropdown ordered by the most recent phase timestamp, and each phase renders the union of home/away teams found in that phase's scheduled or played events.
- `SidebarTeamList` mirrors the same selected phase through `PanelState.tournamentPhaseKey` / `tournamentPhaseName`.
- Tournament event paging treats `404` on `events/last|next/{page}` as a terminal empty page, so closed mini-tournaments such as domestic super cups do not pay retry backoff for nonexistent future pages.

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

Bench appearance in lineups alone no longer implies `didNotPlay`; the player is hidden only when all available evidence still says he stayed on the bench.

Matches marked `didNotPlay` are removed from PlayerPage display and statistics.

### Ultime N

- `selectedPeriod` can be either `{ type: 'last', count }` or `{ type: 'season', year }`. Supported `count` values: `5 | 10 | 15 | 20 | 30 | 50 | 75`.
- In `Ultime N`, PlayerPage passes no season filter to `useMatchTimeline` plus `minPlayedEvents = N` and `maxEvents = N * 2` (safety cap on total events fetched, including didNotPlay).
- `minPlayedEvents` is the real stopper: `useMatchTimeline` counts only events with `onBench === false` and stops paging when it reaches N of those, hits `maxEvents`, or the API ends.
- `PlayerPage` builds `lastPeriodBaseEvents = allEvents -> exclude didNotPlay -> slice(N)`.
- Tournament options in `Ultime N` are derived from that same `lastPeriodBaseEvents` base.
- Tournament, venue, and starter filters are applied locally on that fixed `N`-match base without refetching.

## Current Loading Model

After `events/last` returns the event list plus seeds, `useMatchTimeline` runs four queues:

1. officialStats for all matches, batch size 8, delay 100ms between batches
2. match duration metadata from `event/{id}` for all matches, batch size 10, delay 50ms between batches; this queue is non-blocking and never holds the PlayerPage section loader open
3. substitution timing extraction from `event/{id}/comments` for all matches, batch size 8, delay 75ms between batches; this queue reuses the comments cache but only patches `substituteInMinute` / `substituteOutMinute` for timeline positioning
4. lineups for all matches, batch size 5, delay 150ms between batches

Rich comments for foul narrative are not loaded automatically into `detailsMap`. `MatchCard` still promotes them on-demand through `requestRichDetails(eventId)` when rendered with `commentsStatus === 'idle'`, while `useMatchTimeline` may prefetch raw comments only to extract substitution timing and populate the shared comments cache.

Other current behavior:

- In season mode, the pager can stop after the first irrelevant page once it has already found relevant season matches.
- In cross-season `Ultime N`, that early stop is disabled.
- In season mode, `useMatchTimeline` treats an event as relevant when either the season ID matches the player-season list, the pair `{uniqueTournament.id, season.year}` matches the selected season, or the event belongs to a selected tournament and falls inside the selected season's date window. This covers SofaScore cases where the same cup edition gets different season IDs and even different season-year labels across APIs.
- Timeline relevance now accepts any match with `event.status.type === 'finished'`, so events decided after extra time or penalties are included alongside regular full-time results.
- In `Ultime N`, `useMatchTimeline` now loads all completed events without filtering by season ID and relies on `minPlayedEvents` / `maxEvents` to stop paging.
- `apiFetch` deduplicates in-flight requests per path, so parallel consumers such as `TeamGrid` and `SidebarTeamList` share the same pending SofaScore call instead of duplicating retries.
- `apiFetch` no longer retries terminal `4xx` responses except `429`, caches terminal `404` fallback payloads for endpoints that opt in, and also caches terminal `4xx` errors for the standard TTL.
- `useTournamentViewData` keeps a shared in-memory tournament snapshot cache keyed by `{tournamentId, seasonId}` plus a latest-season alias, so reopening the same tournament view can hydrate synchronously without rebuilding phases or standings.
- `useMatchTimeline` keeps an in-memory cache both for `player/{id}/events/last/{page}` responses and for fully-built timeline snapshots keyed by `{playerId, seasonIdsKeyOrWildcard, tournamentIdsKey, tournamentYearPairsKey, seasonDateRangeKey, maxEvents, minPlayedEvents}`.
- When switching period/season, `useMatchTimeline` first tries to hydrate from the timeline snapshot cache; if that context was never opened, it can still rebuild synchronously from cached `events/last` pages plus `matchDetailsCache` and skip the section loader when those pages already cover the target context.
- Queue effects exit immediately when their corresponding `all*Loaded` flag is already true, and artificial inter-batch delays are skipped when the whole batch was cache hits.
- PlayerPage shows a section loader while `loadingEvents || !allOfficialStatsLoaded || !allLineupsLoaded`.
- `MatchTimeline` always shows the visible match count in the header and a select/deselect-all toggle.
- `PlayerPage` auto-selects the first visible timeline matches when the selection context changes: 3 cards on desktop, 1 card on mobile, with per-match overrides plus select-all / deselect-all controls layered on top.
- In timeline cards, foul badges show `0` when official stats loaded a real zero, and `-` only when the foul value is still unavailable after loading.
- In timeline cards, the compact match UI shows a neutral home/away badge at top-left, a tiny played-minutes label plus any card icon at top-right, the opponent crest in the center, a compact scoreline row below it, foul badges underneath, and a subtle background segment positioned on the match timeline according to `substituteInMinute`, `substituteOutMinute`, `minutesPlayed`, and `matchDuration`.
- Timeline fill duration prefers `event/{id}` metadata (`defaultPeriodCount`, `defaultPeriodLength`, `defaultOvertimeLength`, `time.injuryTime*`) and falls back to 90 minutes if that metadata is still missing or unavailable.
- For subentrati without a parsed substitution minute, timeline cards fall back to right-aligning the played segment using `minutesPlayed` once lineups confirm `isStarter === false`.
- In `MatchCard`, the mini foul counters beside the field/heatmap show a spinner while the selected comparison player is still loading, then show either a real number (including `0`) or `-` when the stat is unavailable.
- In `MatchCard`, the header shows the home-team crest before the home name and the away-team crest after the away name, matching the `PlayerHeader` team-badge size.
- In `MatchCard`, aggregated season averages for the selected comparison player are cached in a module-level in-memory LRU map keyed by `{activePlayerId, selectedTournamentsKey}` (with in-flight dedupe and cached `unavailable` outcomes), so reopening the same player+tournaments context reuses data immediately without spinner.
- In `MatchCard`, clicking a fouled/fouling player, a player dot on the field map, or the active-player name switches `activePlayerId` locally, updating the heatmap plus contextual season/match foul stats for that player.
- In `MatchCard`, clicking the opponent team or a linked player can open or swap the opposite split panel on desktop; on mobile it navigates in-place.
- In `MatchCard`, field map and heatmap orientation depend on the measured width of the positions section: multi-card layouts stay portrait, while a single selected card uses landscape only when that section is at least `620px` wide; otherwise both views switch to portrait without changing the two-column layout.
- In `MatchCard`, the comparison stat boxes around the heatmap are also width-aware: they stay on the left/right sides only when the heatmap column is at least `620px` wide and still has enough extra room beyond the heatmap itself; otherwise the season averages move above the heatmap and the in-match foul counters move below it.
- `PlayerPage` derives season club badges from `allEvents` plus progressively-loaded `playerSide` lineup data, so season logos in the period dropdown can appear incrementally as lineups finish loading.

## Filters

### Filter state persistence

All user-set filter values (`selectedPeriod`, `enabledTournaments`, `showCommitted`, `showSuffered`, `showHome`, `showAway`, `showCards`, `showStartersOnly`, `committedLine`, `sufferedLine`) are persisted inside the panel's `PanelState.filterState` in NavigationContext via `updatePanelFilters`. `usePlayerData` accepts `initialFilterState` and `onFiltersChange` to read/write this state. Because `PanelState` travels with the panel during `CLOSE_SPLIT`, filters survive split↔fullscreen transitions. When a panel is truly closed (the other side of a split close), its `PanelState` is discarded and the next open starts from defaults.

Additional rules:
- `SET_VIEW` clears `filterState` when `playerId` changes, so navigating to a different player always starts from defaults.
- `UPDATE_PANEL_FILTERS` is the reducer action that writes the latest player-filter state back into the owning panel.
- The tournament auto-enable effect in `usePlayerData` skips execution while `tournamentSeasons` is still empty (preventing it from overwriting restored state before the API responds), and also skips on the very first load if saved `enabledTournaments` are present.

### Periodo

- Lives in `usePlayerData` as `selectedPeriod`.
- Renders as a custom dropdown: `Ultime N` first, then season years.
- The selected `Ultime N` value can show up to two club logos derived from the latest played matches in that N-window; the opened dropdown list remains text-only.
- Season options can show up to two club logos derived from loaded match lineups for that year; when lineup data is unavailable, the year remains text-only.
- The `Titolare` toggle is rendered below the period select, not inline to its right.
- Changing period resets venue/show/cards/starter toggles in PlayerPage.

### Player Header

- `PlayerHeader` can show the current club badge plus up to two national-team badges in debut order.
- National-team data comes from `player/{id}/national-team-statistics`; if missing, the header falls back to the existing club-only layout.

### Competizioni

- In season mode, available competitions come from the current season.
- In `Ultime N`, available competitions come only from the current `lastPeriodBaseEvents`.
- If the user disables the only active competition, the next one is auto-enabled first.

### Casa / Trasferta

- Controlled by `showHome` and `showAway`.
- Venue detection prefers `playerSide` derived from lineups.
- If lineups are not ready, PlayerPage temporarily falls back to current team ID matching.
- The home/away badge in `MatchTimeline` uses that same venue-resolution helper, so national-team matches no longer default to the club-based fallback icon.

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
- MatchCard field/heatmap orientation is width-aware: single-card layouts may render in landscape, but only when the measured positions-section width is at least `620px`; narrower single cards and all double/multi-card layouts use portrait.
- MatchCard heatmap-side stat placement is width-aware: the heatmap column keeps season averages on the left and match foul counters on the right only when it reaches `620px` and preserves extra clearance around the heatmap; narrower columns switch to averages above and foul counters below.
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
