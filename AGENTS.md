# Stats Analyzer AGENTS.md

This file is the Codex instruction file for the entire `stats-analyzer/` repository.

- Codex reads `AGENTS.md` automatically when working in this repo scope.
- `AGENTS.md` is the Codex counterpart of `CLAUDE.md`.
- This file does not update itself automatically. Keeping it accurate is part of the normal workflow for every relevant change.

## Project Snapshot

Stats Analyzer is a football/soccer foul-analysis web app with an Italian UI.

- Main navigation flow: `home -> leagues -> teams -> team -> player`
- Main user paths:
  - browse Countries -> Leagues -> Teams -> Players
  - search directly for players, teams, or competitions
  - compare contexts with desktop split view
- Data sources: public SofaScore API for navigation/match metadata and Football-Data CSV files for the local top-five-league shot archive
- Local SQLite database for shot observations only; no user database
- No auth
- No API keys

## Stack

| Layer | Tech | Port |
| --- | --- | --- |
| Client | React 19, TypeScript 5.9, Vite 8, Tailwind CSS 4 | 5173 |
| Server | Express 4 browser-backed proxy, `playwright-core`, Node built-in SQLite | 3001 |

Monorepo entrypoints:

- root `package.json`: starts client and server together
- `client/`: frontend app
- `server/`: SofaScore proxy

Useful commands:

```bash
npm run install:all
npm start
```

Client-only commands:

```bash
cd client
npm run build
npm run lint
npm test
```

Server model tests:

```bash
cd server
npm test
```

## Structure That Matters

```text
stats-analyzer/
|-- AGENTS.md
|-- CLAUDE.md
|-- docs/
|   `-- deploy/
|       |-- sofascore-cdp-vps.md
|       |-- stats-analyzer.env.example
|       |-- stats-analyzer-browser.service.example
|       `-- stats-analyzer-app.service.example
|-- package.json
|-- server/
|   |-- index.js
|   |-- shot-data-archive.js
|   |-- shot-predictions.js
|   `-- test/
`-- client/
    |-- .env.example
    |-- vite.config.ts
    `-- src/
        |-- App.tsx
        |-- index.css
        |-- api/sofascore.ts
        |-- context/NavigationContext.tsx
        |-- hooks/
        |   |-- usePlayerData.ts
        |   |-- useMatchTimeline.ts
        |   |-- useMatchDetails.ts
        |   |-- useTournamentViewData.ts
        |   `-- useShotPrediction.ts
        |-- pages/
        |   |-- HomePage.tsx
        |   `-- PlayerPage.tsx
        `-- components/
```

Key responsibilities:

- `client/src/App.tsx`: root composition, top bar, sidebar, split view, lifted home calendar state, measured team panel width
- `client/src/context/NavigationContext.tsx`: reducer-driven navigation state, split open/close/swap logic, per-panel filter persistence, real-match-only `MatchupView` opening
- `client/src/api/sofascore.ts`: all client API calls, client-direct SofaScore JSON fetch with proxy fallback, client TTL cache, in-flight dedupe, terminal 4xx handling, tournament paging helpers, shared matchup target resolvers
- `client/src/api/persistentCache.ts`: failure-safe, versioned `localStorage` cache for stable SofaScore metadata and short-lived calendar snapshots across page reloads
- `client/src/api/requestGate.ts`: global direct-browser SofaScore pacing and queue-clearing cooldown circuit used by every client JSON request
- `client/src/components/navigation/TeamView.tsx`: team page, next-match context persistence, split-view opponent orchestration, real-match matchup resolution
- `client/src/components/navigation/MatchupView.tsx`: full-screen single-match comparison view with canonical event-driven lineups and season-aware team stats loading for the opened match
- `client/src/components/navigation/MatchupPage.tsx`: matchup shell that swaps between `Formazioni` and `Previsioni` and enables the prediction job only for the latter
- `client/src/components/navigation/ShotPredictionsView.tsx`: shot forecast summary, seven fair total-shot lines, calculation/history drill-down, and two independent descriptive-average panels
- `client/src/hooks/useShotPrediction.ts`: primes the server with the already-opened match snapshot, then starts and polls the on-demand prediction job without cancelling server work when the view unmounts
- `client/src/hooks/usePlayerData.ts`: player seasons, period/filter state, tournament enablement, aggregated season stats
- `client/src/hooks/useMatchTimeline.ts`: event paging, context snapshots, progressive official stats / duration / substitution / lineup loading
- `client/src/hooks/useMatchDetails.ts`: shared match-detail cache and rich-data helpers
- `client/src/hooks/useTournamentViewData.ts`: standings vs phase reconstruction, latest valid season resolution, shared tournament snapshot cache
- `client/src/pages/PlayerPage.tsx`: coordinates filters, timeline, selection, derived stats, empty/loading states, card layout
- `client/src/components/common/PriorityImage.tsx`: client-side image queue for home logos/flags with visible-first loading, separate above-the-fold reveal-session tracking, expansion-triggered priority boosts, invisible placeholders, and timeout-based failure fallback
- `server/index.js`: Express proxy for JSON and images with server-side TTL cache, in-flight dedupe, direct-first image fetches, and persistent Chrome relay fallback for SofaScore
- `server/persistent-asset-cache.js`: disk-backed image cache with asset-specific lifetimes for flags, tournament/team logos, player images, and short negative caching
- `server/upstream-gate.js`: shared concurrency, pacing, and `403`/`429` cooldown protection for all server-side SofaScore JSON and image traffic
- `server/shot-data-archive.js`: atomic Football-Data CSV importer, two-season SQLite archive, daily refresh, team-name reconciliation, prediction datasets, descriptive averages, and archive status
- `server/shot-predictions.js`: point-in-time total-shots model, chronological parameter/distribution selection, persistent forecast cache, background-job dedupe, prediction/detail APIs, and archive-backed descriptive averages

## Architecture And Conventions

- The app does not use React Router. Navigation is state-driven through `NavigationContext`.
- Split view is desktop-only and starts at `1024px`.
- Panel behavior matters. Many layout decisions depend on measured panel width, not only viewport width.
- `MatchupView` is a match-specific screen. It must open only from a resolved real event (`eventId`); generic team-vs-team compare mode is intentionally unsupported.
- Matchup `PanelState` persists `matchupSection` plus separate home/away descriptive-average selections. `Formazioni` remains the default; `Previsioni` replaces the field/players instead of overlaying them.
- `MatchupPage` starts the prediction job only when the user selects `Previsioni`; opening or using `Formazioni` alone must never enqueue model traffic. Once started, the server job survives client navigation and is deduplicated by event/model version.
- Model version `shots-v1.3.0-football-data` supports future and historical reconstruction whenever the target season is present in the local archive.
- Every model observation must satisfy `startTimestamp < target.startTimestamp`; the importer also excludes the target home/away pairing within a six-hour window so source-specific IDs or small timestamp differences cannot leak the target event. Only the target season and its immediately preceding season are queried.
- Abbreviated SofaScore season labels such as `26/27` must be parsed as start year `2026`; labels such as `70/71` mean `1970`, never a recent season. Descriptive shot-average catalogs expose only the team's latest available season and the immediately preceding one.
- Descriptive data is deliberately separate from predictive data. Team averages and `MatchupView` history may include the opened match and later completed matches; prediction details never may. The opened event is fetched explicitly, deduplicated in both team histories, highlighted, and shows final total shots when available.
- Shot predictions and archive-backed descriptive averages support Serie A (23), Premier League (17), LaLiga (8), Bundesliga (35), and Ligue 1 (34).
- Football-Data columns `HS`/`AS` are the predictive total-shot source; `HST`/`AST` are stored for future extensions. Rows without complete `HS`/`AS` are omitted. Red-card columns are retained. SofaScore `totalShotsOnGoal` remains used only by the independent formations/history UI and the legacy no-archive test path.
- Model selection is chronological over half-life `[60,90,120,180,270,365]` and shrinkage `[5,10,20]`. Linear/quadratic strength terms must improve out-of-sample NLL by at least 1%, not worsen MAE, and remain calibrated; Poisson versus negative-binomial is selected from out-of-sample NLL. The promotion correction stays neutral and widens uncertainty when needed until second-division CSVs are added; never invent a manual multiplier.
- Prediction and average routes are local Express APIs under `/api/predictions/*` and `/api/teams/*`; they must not use the client-direct SofaScore origin.
- `server/.shot-data/shots.sqlite` is the Git-ignored source archive. Startup downloads and validates the five league CSVs for the current and previous seasons, commits all available files atomically, and refreshes the current season once per day. A not-yet-published current-season file (`300`/`404`) is reported as skipped without discarding valid leagues or the previous snapshot. The archive never retains more than two season start years.
- `server/.shot-model-cache/` stores versioned forecasts, details, point-in-time snapshots, and target metadata. Predictions are keyed by `eventId + modelVersion`; historical predictions are immutable for the same version and future predictions refresh after six hours.
- The prediction POST is primed with the match snapshot already present in `PanelState` (`startTimestamp`, competition, season and teams). The model must read this snapshot or its disk cache before considering an upstream target fetch; archive-backed prediction and average calculations must not request per-match SofaScore statistics.
- Descriptive average catalogs and numerical rows remain lazy and independent per team. Their local season IDs are start years (for example `2026` for `2026/27`) and the UI reconciles them after catalog load.
- Team panels persist a compact `nextMatchSummary` in `PanelState` after loading `nextEvent`, so split views can prove both sides reference the same real match before auto-opening or merging into `MatchupView`.
- Matchup navigation payloads must preserve `startTimestamp` and `seasonYear` alongside `seasonId`, both for point-in-time reconstruction and because SofaScore season IDs differ across endpoints.
- `MatchupView` player stats tables should load finished matches across the opened match's full season context, not just the first page of team history, so the default competition filter remains populated reliably.
- Home is a real data view, not a static landing page. It shows the daily football schedule and keeps calendar state in `App.tsx`.
- Search is global and can open players, teams, or tournaments directly.
- Player filter state is persisted in `PanelState.filterState`, so filters survive split/fullscreen transitions when the panel survives.
- Match-by-match player data is progressively hydrated:
  - official stats
  - match duration metadata
  - substitution timing
  - lineups
- Rich foul narrative is loaded on demand from match comments.
- Both client and server use in-memory TTL caching. Stable navigation metadata and five-minute calendar snapshots also use a versioned browser-persistent cache, while proxied images use the Git-ignored `server/.asset-cache/` disk cache. Reuse existing cache-aware helpers instead of bypassing them.
- SofaScore JSON calls are client-direct first (`https://api.sofascore.com/api/v1/*`) and fall back to `/api/sofascore/*` when direct browser access is blocked by challenge/CORS/fetch errors, timeout, non-JSON responses, `403`, or `429`.
- Direct client JSON fetches must use `credentials: 'omit'`; do not send cross-origin SofaScore credentials from the app origin.
- A direct `403` may fall through once to the proxy, but a proxy `403` is terminal for that request and must not enter the generic retry loop.
- SofaScore removed the global `sport/football/scheduled-events/:date` board. The home calendar reconstructs a bounded top-five snapshot from page zero of `events/last` and `events/next` for tournaments `[23,17,8,35,34]`, after resolving the season containing the selected date. Tournament loading is sequential, publishes partial results when the selected date is found, shares the global gate, and persists each snapshot for five minutes across reloads; never reintroduce the removed board or a burst over every scheduled tournament.
- All client-direct JSON calls pass through one single-flight gate paced at 750 ms by default. A final `403`/`429` opens a 15-minute circuit and rejects queued work before it can reach SofaScore.
- All server-side JSON calls, including the proxy, prediction model, averages, and metadata, pass through a second global gate with the same queue-clearing circuit. Essential team/tournament/player images and background category flags use independent paced gates, so a long flag list can never delay match logos.
- Client data-access flags:
  - `VITE_SOFASCORE_DIRECT=false` disables direct browser JSON fetches.
  - `VITE_SOFASCORE_PROXY_FALLBACK=false` disables proxy fallback when direct is enabled.
  - `VITE_SOFASCORE_DIRECT_ORIGIN` overrides the default `https://api.sofascore.com/api/v1`.
  - `VITE_SOFASCORE_X_REQUESTED_WITH` optionally supplies a known-current rotating request token; leave it empty by default rather than committing a stale value.
  - `VITE_SOFASCORE_DIRECT_TIMEOUT_MS` controls the direct browser timeout.
  - `VITE_SOFASCORE_MIN_INTERVAL_MS` controls client-direct request spacing (750 ms by default).
  - `VITE_SOFASCORE_COOLDOWN_MS` controls the client circuit cooldown (15 minutes by default).
- Images still go through `/api/img/*`; the proxy first checks memory and `server/.asset-cache/`, then tries a fast direct fetch from `img.sofascore.com`, and only falls back to the browser relay when needed. Cache lifetime is longest for flags and tournament logos, shorter for team/player images, and one day for missing images.
- The server no longer relies only on raw Node `fetch()` to SofaScore. In production it is expected to use a persistent real Chrome/Chromium session, either by:
  - connecting to an existing browser via `SOFASCORE_BROWSER_CDP_URL`
  - launching a local Chrome/Chromium binary via `SOFASCORE_BROWSER_EXECUTABLE_PATH`
- In local development, if `SOFASCORE_BROWSER_EXECUTABLE_PATH` is not set, the server auto-detects a common Chrome/Chromium/Edge executable path before falling back to direct Node fetches.
- The browser relay keeps a warmed football page on `https://www.sofascore.com/football` and executes in-page `fetch()` calls for JSON, so blocked direct Node requests can inherit a real browser session instead of a plain server-side fingerprint. It captures a rotating `x-requested-with` header when the page emits one; a fixed token is optional configuration, not a reliable bypass. Fallback images use isolated pages and never navigate the homepage first.
- Local auto-launched Chrome is headful by default because a headless page may be rejected before it can establish a SofaScore session. Production examples explicitly set `SOFASCORE_BROWSER_HEADLESS=true`; CDP to an already validated browser remains preferable on challenged networks.
- Home schedule logos and flags should use `PriorityImage`, which keeps load priority separate from reveal gating: visible items load first, offscreen schedule assets trickle only after the visible queue drains, and newly expanded sections are promoted to high priority immediately. Country-navigation flags use `deferOffscreen` and must not be requested until they approach the viewport.
- `HomeCalendar` opens a fresh reveal session on every date change and closes the green loader once the images that were actually inside the initial viewport have either loaded or failed; images below the fold must never hold that gate open.
- `DaySchedule` should keep schedule content mounted but visually hidden during the reveal session so `IntersectionObserver` and image requests can start immediately, without showing a separate centered overlay spinner or letting the hidden list capture interaction.
- Today's calendar starts its five-minute refresh only after an initial successful response and stops the interval after any refresh error. Never keep retrying a failed schedule in the background.
- `ASSET_CACHE_DIR` overrides the persistent image-cache directory; its default is `server/.asset-cache/`.
- `SOFASCORE_DIRECT_FALLBACK` controls whether the old direct Node-fetch fallback remains allowed when no browser relay is configured.
- `SOFASCORE_GLOBAL_MIN_INTERVAL_MS` and `SOFASCORE_GLOBAL_COOLDOWN_MS` control the server-wide upstream gate (750 ms and 15 minutes by default).
- The server exposes `/api/sofascore-browser/status` for local relay plus global/image/model circuit diagnostics. The model circuit includes its persisted block deadline. Adding `?probe=1` performs one deliberately isolated categories request through the exact same warmed-page/in-page-fetch path as ordinary JSON traffic; never implement the probe as direct navigation to an API URL, because that can produce a false `403`. Use it before loading the app on a new network.
- Production deploy should treat CDP mode (`SOFASCORE_BROWSER_CDP_URL`) as a proxy fallback, preferably on an IP/environment that is verified to pass SofaScore JSON. Example env and `systemd` units live in `docs/deploy/`.

## Working Rules For Codex

Follow these rules automatically on every task in this repo.

### Git Workflow

1. Before starting work, check `git status`, current branch, and `git branch`.
2. Reuse or create a branch before making code changes. Do not edit while on `master`.
3. Commit often with concise messages describing why.
4. When complete, push the branch, create a PR with `gh pr create`, and merge with `gh pr merge`.
5. After merge, switch back to `master` and pull.

### Local Changes Safety

- Do not overwrite, revert, or discard unrelated local changes unless the user explicitly asks.
- If the worktree is dirty, isolate your own changes and leave unrelated edits intact.
- Generated local artifacts such as `.playwright-mcp/`, `server-*.log`, `stats-analyzer-current.tar.gz`, `temp-*-profile/`, and `server/.sofascore-browser-profile*` should stay untracked and be cleaned up or ignored rather than committed.

### Keep Docs In Sync

After every change that affects structure, architecture, conventions, data flow, hooks, navigation, design tokens, or workflow:

1. Update `AGENTS.md`.
2. Update `CLAUDE.md`.
3. Include the documentation update in the same commit as the code change.

Typical triggers:

- new files or folders that change how the repo is organized
- new APIs or changed endpoint usage
- new hooks, utilities, or caches
- navigation changes or split-view behavior changes
- loading model or filter behavior changes
- design-token or layout-rule changes
- workflow-rule changes

### Documentation Priority

- Treat `CLAUDE.md` as the Claude-oriented sibling file.
- Treat `AGENTS.md` as the Codex-oriented primary instruction file for this repo.
- Keep both files aligned in intent. If one changes for a project-level rule, the other usually needs the same update.
