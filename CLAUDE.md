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
        |   |-- useCalendarData.ts   # Home daily schedule loader, local date cache, country/tournament grouping, today auto-refresh
        |   |-- usePlayerData.ts     # Seasons/stats + all player filter state, including selectedPeriod
        |   |-- useMatchDetails.ts   # Shared match-details cache and helpers for officialStats, lineups, rich comments
        |   |-- useMatchTimeline.ts  # events/last loader + progressive officialStats/lineups/rich data queues
        |   |-- useTournamentViewData.ts # Shared tournament teams/phases loader with snapshot cache for TeamGrid + SidebarTeamList
        |   |-- useViewport.ts       # Shared window width/height hook used by responsive layout and density decisions
        |   `-- useSplitCardSync.ts  # Cross-panel card height sync
        |-- utils/
        |   |-- foulPairing.ts
        |   |-- playerMatchVenue.ts
        |   |-- statsCalculator.ts
        |   `-- positionMapping.ts
        |-- pages/
        |   |-- HomePage.tsx         # Home daily schedule entry point; renders HomeCalendar on panel 0
        |   `-- PlayerPage.tsx       # Player analysis, derived filters, selection state, stats, timeline, cards
        `-- components/
            |-- home/
            |   |-- HomeCalendar.tsx   # Daily football schedule container; lifts date state from App when top-bar calendar is active
            |   |-- CalendarStrip.tsx  # Horizontally scrollable infinite date strip centered on selected day
            |   |-- DaySchedule.tsx    # Loading/error/empty states plus country list for selected date
            |   |-- CountrySection.tsx # Country accordion with match counters and nested leagues
            |   |-- LeagueSection.tsx  # Tournament accordion with direct league navigation and inline match rows
            |   `-- MatchRow.tsx       # Compact fixture row with live/FT status and clickable teams
            |-- layout/
            |   |-- Sidebar.tsx
            |   |-- ContentPanel.tsx          # Supports standard bordered top bar or raw top bar for home search + calendar strip
            |   `-- SearchBar.tsx             # Searches players, teams, and tournaments; filters non-football results; clears stale hierarchy context; compact header mode
            |-- navigation/
            |   |-- CountryList.tsx     # Top 7 categories pinned first (IT, EN, ES, DE, FR, EU, World) + dynamic full category list from SofaScore
            |   |-- LeagueList.tsx      # Dynamic tournament list for the selected SofaScore category
            |   |-- TeamGrid.tsx         # League standings or cup-phase team grid depending on tournament structure
            |   |-- TeamView.tsx         # Team roster + next match; opponent click always opens home left / away right
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
- `Tournament` objects in event data include an optional `category` field (id, name, alpha2) exposing country context. `TeamView` uses this in a fallback effect to populate missing `leagueId` and `countryId`/`countryCategoryId` on the panel, so `GO_BACK` can traverse the full hierarchy (player → team → teams → leagues) even when navigation started from search rather than the country list.
- `SearchResult` is a discriminated union: `PlayerSearchResult | TeamSearchResult | TournamentSearchResult`. Clicking any result calls `navigateTo` directly with all hierarchy fields not relevant to the target view set to `undefined` (leagueId, countryId, countryCategoryId, seasonId, etc.), so stale context from a previous navigation path is never inherited. Non-football results are filtered out in `searchAll` by checking `sport.slug` on the player entity or its team.
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
- SearchBar always lives in the shared top bar: duplicated per panel in split view, single compact instance in standard single-panel views, and paired with the calendar strip on the home page.
- SearchBar uses fixed control heights per density (`h-9` header mode, `h-10` compact, `h-11` standard) so the field does not visually resize when nearby divider lines appear/disappear across layouts.
- Home panels in split view reuse the same shared calendar date state as panel 0, so the scheduled-match calendar remains visible and synchronized when the home screen is opened on the right panel.
- When the home screen is opened in the split panel, it also shows an internal compact countries sidebar beside the schedule so country navigation remains available without relying on the global left sidebar.
- Split-panel scrolling is panel-specific: standard views keep the panel itself scrollable, while split home uses internal scroll containers so its compact countries sidebar and match schedule can scroll independently without breaking other split pages.
- In split home, the close button is rendered as overlay chrome instead of taking layout height, so the compact countries sidebar and the schedule start directly under the shared top-bar divider and align with the main left sidebar header line.
- In split home, the calendar strip spans the full schedule column width under the overlay close button, while the match list below keeps its own horizontal padding; the compact countries sidebar still ignores the overlay chrome and starts directly under the top-bar divider.
- The desktop main top bar and the left sidebar header now share the same fixed height (`h-14`) to avoid subpixel divider drift and keep their bottom border perfectly aligned.
- On mobile single-panel views, the SearchBar sits on the same top row as the fixed sidebar toggle, with left offset space reserved for the toggle instead of pushing the whole page down.
- The mobile sidebar toggle is controlled from `App.tsx`; when the drawer is open, the same button switches to a close icon instead of rendering a second overlapping control.
- On the single-panel home view, `App.tsx` lifts `calendarDate` state and renders a raw top bar made of compact search row + `CalendarStrip`, while the content area starts flush under that strip with no duplicate padding.
- Clicking "next opponent" in `TeamView` always arranges the match as home team on the left (panel 0) and away team on the right (panel 1), regardless of which panel the click came from. If the arrangement is already correct, the click does nothing. If one panel has a player page, it is preserved on the side matching the player's team; only the other panel is replaced with the new team.
- `TeamView` derives `teamName` from `panel.teamName` (set at navigation time) as the primary source, then falls back to `nextEvent.homeTeam/awayTeam.name` if the panel name is missing. This prevents national team pages from showing a club name taken from a player's team.
- `App.tsx` now measures the real available width of each rendered `TeamView` panel through a stable wrapper that stays mounted even while the team view is loading, and passes that width into `TeamView` so the formation layout never falls back to raw viewport width.
- `TeamView` bench cards are minimal text chips only: no player avatars, reduced padding, abbreviated names, and optional compact jersey number.

## SofaScore API Endpoints

All JSON calls go through `/api/sofascore/*`. Images go through `/api/img/*`.

| Endpoint | Purpose | Used in |
|----------|---------|---------|
| `sport/football/categories` | Football categories list | CountryList |
| `sport/football/scheduled-events/{date}` | Daily football schedule for the home calendar | useCalendarData, HomeCalendar |
| `category/{categoryId}/unique-tournaments` | All tournaments for a football category | LeagueList |
| `search/all?q={query}` | Global search returning players, teams, and tournaments | SearchBar |
| `unique-tournament/{id}/seasons` | Tournament seasons | TeamGrid |
| `unique-tournament/{id}/season/{id}/standings/total` | Teams from standings, including per-group tables when provided | TeamGrid |
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

### Home Daily Schedule

- The default home screen on panel 0 is no longer a static intro: it shows the selected day's football schedule grouped as `country -> tournament -> matches`.
- `useCalendarData` fetches `sport/football/scheduled-events/{date}`, keeps a local `Map<date, events[]>` cache, suppresses the spinner when revisiting a date already loaded in the current session, and applies a final client-side filter so the home calendar shows only matches whose local `startTimestamp` falls on the selected date.
- `todayISO()` is derived from the browser's local calendar date (not UTC), so the selected "today" stays aligned with the user's timezone.
- When the selected date is today, `useCalendarData` auto-refreshes the schedule every 60 seconds with `skipCache=true` so live scores can advance without manual reload.
- Home grouping is built from `event.tournament.uniqueTournament` and its `category`; matches inside a tournament are ordered by `startTimestamp`.
- Country ordering is priority-based: the top categories are Italy, England, Spain, Germany, France, Europe, and World. If one of those has a configured primary competition on that day, it is promoted ahead of all other categories.
- Inside each prioritized country, configured primary competitions (for example Serie A, Premier League, LaLiga, Bundesliga, Ligue 1, UEFA club cups, World Cup / Club World Cup) are shown first; the remaining competitions follow in alphabetical order.
- Country sections default to expanded. Within each country, only the first available primary tournament is auto-expanded; if none is present, the first tournament is expanded.
- `LeagueSection` allows direct navigation to the tournament teams view via `selectLeague`, preserving `seasonId` from the scheduled event payload.
- `MatchRow` allows direct navigation to either team page from the home calendar, carrying tournament/category context (`leagueId`, `leagueName`, `seasonId`, `countryCategoryId`, `countryId`, `countryName`) so downstream back-navigation remains coherent.

### Tournament Structure

- `TeamGrid` and `SidebarTeamList` both consume `useTournamentViewData`, which resolves the selected/latest season once, reconstructs cup phases or standings once, and keeps a shared in-memory snapshot cache keyed by tournament+season.
- If the tournament exposes meaningful named phases (for example league phase, group stage, round of 16, quarter-finals, semi-finals, final), the app treats it as a phase-based competition instead of relying on `standings/total`.
- A single named knockout-style phase such as `Final` is enough to classify the tournament as phase-based, and even a single generic phase is treated as cup-style when it looks like a compact knockout mini-tournament (few teams, few matches, short date span), preventing pointless standings calls for domestic super cups and similar short cups.
- When no season is preselected, `useTournamentViewData` now skips placeholder-only editions and defaults to the most recent season that has at least one visible phase with real participants or a non-empty standings table.
- For phase-based competitions, the teams view shows a phase dropdown ordered by the most recent phase timestamp, and each phase now renders only the real teams already assigned to that phase's scheduled or played matches, while placeholder slots such as `1A`, `A1`, `W49`, `Winner Match 49`, `1st Group A`, `TBA`, or `Winner Group A` stay hidden.
- When SofaScore exposes `standings/total` for a phase-based competition, `TeamGrid` reuses those standings inside the matching phase or group section, so league phases and grouped stages can render position, points, and matches played in standings order instead of plain alphabetical team cards.
- Group-style subphases such as `Group H`, `Group J`, or collapsed generic matchdays are grouped under a single `League phase` entry and rendered in one page with small subsection labels per group/matchday.
- Qualification subphases such as `Qualification round 1` and `Qualification round 2` are grouped under a single `Qualification` entry and rendered in one page with small subsection labels per round.
- Phase grouping now includes sub-competition context from `event.tournament.name`, so labels like `Qualification Playoffs - Final` no longer get merged with the main tournament `Final`.
- `SidebarTeamList` mirrors the same selected phase through `PanelState.tournamentPhaseKey` / `tournamentPhaseName`.
- Tournament event paging treats `404` on `events/last|next/{page}` as a terminal empty page, so closed mini-tournaments such as domestic super cups do not pay retry backoff for nonexistent future pages.

### Tournament Season Selector

- `TeamGrid` now always renders a season dropdown for both standings-based leagues and phase-based cups.
- In phase mode, the season selector sits beside a narrower phase selector; in standings mode, it sits to the right of the tournament title.
- The phase/season controls stay on the same row even in narrow panel widths by using a fixed narrow season column and a flexible phase column.
- Changing season resets the selected phase for that tournament view and rebuilds teams/phases from the chosen season only.

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

`didNotPlay` is derived primarily from official minutes:

- `officialStats.minutesPlayed > 0` => the player is treated as having played
- missing or zero official minutes => the player is treated as `didNotPlay`

`onBenchMap`, lineups, and substitution comments are still useful for other UI details, but they no longer override official minutes when deciding whether a match counts as a real appearance.

Matches marked `didNotPlay` are removed from PlayerPage display and statistics.

### Ultime N

- `selectedPeriod` can be either `{ type: 'last', count }` or `{ type: 'season', year }`. Supported `count` values: `5 | 10 | 15 | 20 | 30 | 50 | 75`.
- In `Ultime N`, PlayerPage passes no season filter to `useMatchTimeline` plus `minPlayedEvents = N` and `maxEvents = N * 2` (safety cap on total events fetched, including didNotPlay).
- `minPlayedEvents` is the real stopper: `useMatchTimeline` counts only events with `officialStats.minutesPlayed > 0` and stops paging when it reaches N of those, hits `maxEvents`, or the API ends.
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
- If the selected season context resolves to no valid season IDs, `useMatchTimeline` now completes with an explicit empty snapshot instead of leaving the section loader spinning forever.
- When `player/{id}/statistics/seasons` has no usable data, PlayerPage falls back to loading recent events from `player/{id}/events/last/*` so isolated appearances can still surface without season metadata.
- Competition filters on PlayerPage are derived only from matches the player actually played in the loaded event set, so tournaments with only did-not-play rows no longer appear as selectable filters.
- When PlayerPage finishes loading but `displayEvents` is empty, it shows an empty-state message: generic no-data copy when no player matches are available at all, and a filter-based message when matches exist but the current filters exclude them.
- `MatchTimeline` always shows the visible match count in the header and a select/deselect-all toggle.
- `PlayerPage` auto-selects the first visible timeline matches when the selection context changes: 3 cards on desktop, 1 card on mobile, with per-match overrides plus select-all / deselect-all controls layered on top.
- In timeline cards, foul badges show `0` when official stats loaded a real zero, and `-` only when the foul value is still unavailable after loading.
- In timeline cards, the compact match UI shows a neutral home/away badge at top-left, a tiny played-minutes label plus any card icon at top-right, the opponent crest in the center flanked by goal (⚽, right) and assist (👟, left) icons from `incidents` (always visible regardless of filter, with a number suffix/prefix when >1), a compact scoreline row below it, foul badges underneath, and a subtle background segment positioned on the match timeline according to `substituteInMinute`, `substituteOutMinute`, `minutesPlayed`, and `matchDuration`.
- Timeline fill duration prefers `event/{id}` metadata (`defaultPeriodCount`, `defaultPeriodLength`, `defaultOvertimeLength`, `time.injuryTime*`) and falls back to 90 minutes if that metadata is still missing or unavailable.
- For subentrati without a parsed substitution minute, timeline cards fall back to right-aligning the played segment using `minutesPlayed` once lineups confirm `isStarter === false`.
- In `MatchCard`, the mini foul counters beside the field/heatmap show a spinner while the selected comparison player is still loading, then show either a real number (including `0`) or `-` when the stat is unavailable.
- In `MatchCard`, the header shows the home-team crest before the home name and the away-team crest after the away name, matching the `PlayerHeader` team-badge size. Goal (⚽) and assist (👟) icons from `incidents` are always shown on the score row, with a number suffix when >1.
- In `MatchCard`, aggregated season averages for the selected comparison player are cached in a module-level in-memory LRU map keyed by `{activePlayerId, selectedTournamentsKey}` (with in-flight dedupe and cached `unavailable` outcomes), so reopening the same player+tournaments context reuses data immediately without spinner.
- In `MatchCard`, clicking a fouled/fouling player, a player dot on the field map, or the active-player name switches `activePlayerId` locally, updating the heatmap plus contextual season/match foul stats for that player.
- In `MatchCard`, clicking the opponent team or a linked player can open or swap the opposite split panel on desktop; on mobile it navigates in-place.
- In `MatchCard`, field map and heatmap orientation depend on the measured width of the positions section: multi-card layouts stay portrait, while a single selected card uses landscape only when that section is at least `620px` wide; otherwise both views switch to portrait without changing the two-column layout.
- In `MatchCard`, the comparison stat boxes around the heatmap are also width-aware: they stay on the left/right sides only when the heatmap column is at least `620px` wide and still has enough extra room beyond the heatmap itself; otherwise the season averages move above the heatmap and the in-match foul counters move below it.
- In `MatchCard`, clicking a shot on the field map opens a compact centered SVG tooltip with only shot metadata (`minute + body part + outcome`, then centered `xG` / `xGOT`); field-map shot colors and trajectory endpoints are outcome-based, so saved shots stay on-target while blocked shots stop at the block point instead of being misclassified by auxiliary shotmap coordinates.
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

- In season mode, available competitions come from the current season API data plus any extra tournaments discovered in loaded events (e.g. friendlies whose tournament isn't in the player's `tournamentSeasons` API).
- In `Ultime N`, available competitions come from the current `lastPeriodBaseEvents`.
- Tournaments discovered from loaded events are auto-enabled once via `ensureTournamentsEnabled`; the tracking resets on player/period/season change so manual disables within a session are preserved.
- `isRelevantTimelineEvent` accepts any finished event within the season date window regardless of tournament membership, so friendly matches appear in season mode.
- If the user disables the only active competition, the next one is auto-enabled first.
- Competition chips now wrap across the full available row instead of living in a fixed narrow column, reducing vertical height on compact layouts and split view.

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

- Controlled by `showCommitted`, `showSuffered`, `showCards`, `showGoalsAssists`.
- If the user disables the only active display filter among `showCommitted`/`showSuffered`/`showShots`/`showShotsOnTarget`/`showCards`, the next one is auto-enabled.
- `showGoalsAssists` is an independent toggle (default `false`): toggling it never auto-enables other filters.
- When `showGoalsAssists` is active, `StatsOverview` shows a goal totals + avg row and an assist totals + avg row. Goal/assist icons (⚽/👟) in timeline cards and MatchCard score rows are always visible regardless of this toggle.

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
- Responsive density is driven by actual viewport size, not just Tailwind breakpoints: compact density is used on narrow mobile widths and short desktop heights (for example `390x844` and `1024x768`), while `768x1024` keeps the regular density.
- Responsive panel layouts should be panel-aware, not viewport-only: when the effective content width is reduced by the sidebar or by split view, cards and filters must react to the measured panel width rather than assuming a full desktop canvas.
- MatchCard field/heatmap orientation is width-aware: single-card layouts may render in landscape, but only when the measured positions-section width is at least `620px`; narrower single cards and all double/multi-card layouts use portrait.
- MatchCard heatmap-side stat placement is width-aware: the heatmap column keeps season averages on the left and match foul counters on the right only when it reaches `620px` and preserves extra clearance around the heatmap; narrower columns switch to averages above and foul counters below.
- TeamView formation layout is also panel-aware: orientation and field width are driven by measured panel width passed from `App.tsx` instead of viewport breakpoints or the rendered content width itself, with layout priority `landscape-right -> portrait-right -> portrait-bottom`, a `20px` horizontal gap, a matches column that targets `220px` width but can contract slightly before falling back below the field, and a stronger minimum panel-width guard so landscape is used only when the side-by-side layout has real breathing room.
- Player match cards no longer use fixed `md`/`lg` width fractions; `PlayerPage` measures the panel width and renders cards in an auto-fit grid so compact desktop widths show 2 cards per row and tablet widths can drop to 1.
- `TeamGrid` uses a compact card style whenever the viewport is short or the page is rendered inside split view, shrinking crest sizes and metadata so standings remain readable.

## Workflow Rules

These rules must be followed automatically on every task.

### Git Workflow

1. Before starting work, check `git status`, current branch, and `git branch`.
2. Reuse or create a branch before making code changes. Do not edit while on `master`.
3. Commit often with concise messages describing why.
4. When complete, push the branch, create a PR with `gh pr create`, and merge with `gh pr merge`.
5. After merge, switch back to `master` and pull.

### Keep AGENTS.md And CLAUDE.md Up To Date

`AGENTS.md` is the Codex counterpart of this file and should stay aligned with it.

After every change that affects structure, architecture, or conventions:

1. Update the relevant sections of `CLAUDE.md`.
2. Update the relevant sections of `AGENTS.md`.
3. Include both documentation updates in the same commit as the code change.
4. Typical triggers: new files, new APIs, new hooks/utilities, navigation changes, design-token changes, changed loading/filter behavior, or workflow-rule changes.
