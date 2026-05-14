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
- Data source: public SofaScore API, accessed client-direct first for JSON with the local Express proxy as fallback
- No database
- No auth
- No API keys

## Stack

| Layer | Tech | Port |
| --- | --- | --- |
| Client | React 19, TypeScript 5.9, Vite 8, Tailwind CSS 4 | 5173 |
| Server | Express 4 browser-backed proxy with CORS enabled, `playwright-core` | 3001 |

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
|   `-- index.js
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
        |   `-- useTournamentViewData.ts
        |-- pages/
        |   |-- HomePage.tsx
        |   `-- PlayerPage.tsx
        `-- components/
```

Key responsibilities:

- `client/src/App.tsx`: root composition, top bar, sidebar, split view, lifted home calendar state, measured team panel width
- `client/src/context/NavigationContext.tsx`: reducer-driven navigation state, split open/close/swap logic, per-panel filter persistence, real-match-only `MatchupView` opening
- `client/src/api/sofascore.ts`: all client API calls, client-direct SofaScore JSON fetch with proxy fallback, client TTL cache, in-flight dedupe, terminal 4xx handling, tournament paging helpers, shared matchup target resolvers
- `client/src/components/navigation/TeamView.tsx`: team page, next-match context persistence, split-view opponent orchestration, real-match matchup resolution
- `client/src/components/navigation/MatchupView.tsx`: full-screen single-match comparison view with canonical event-driven lineups and season-aware team stats loading for the opened match
- `client/src/hooks/usePlayerData.ts`: player seasons, period/filter state, tournament enablement, aggregated season stats
- `client/src/hooks/useMatchTimeline.ts`: event paging, context snapshots, progressive official stats / duration / substitution / lineup loading
- `client/src/hooks/useMatchDetails.ts`: shared match-detail cache and rich-data helpers
- `client/src/hooks/useTournamentViewData.ts`: standings vs phase reconstruction, latest valid season resolution, shared tournament snapshot cache
- `client/src/pages/PlayerPage.tsx`: coordinates filters, timeline, selection, derived stats, empty/loading states, card layout
- `client/src/components/common/PriorityImage.tsx`: client-side image queue for home logos/flags with visible-first loading, separate above-the-fold reveal-session tracking, expansion-triggered priority boosts, invisible placeholders, and timeout-based failure fallback
- `server/index.js`: Express proxy for JSON and images with server-side TTL cache, in-flight dedupe, direct-first image fetches, and persistent Chrome relay fallback for SofaScore

## Architecture And Conventions

- The app does not use React Router. Navigation is state-driven through `NavigationContext`.
- Split view is desktop-only and starts at `1024px`.
- Panel behavior matters. Many layout decisions depend on measured panel width, not only viewport width.
- `MatchupView` is a match-specific screen. It must open only from a resolved real event (`eventId`); generic team-vs-team compare mode is intentionally unsupported.
- Team panels persist a compact `nextMatchSummary` in `PanelState` after loading `nextEvent`, so split views can prove both sides reference the same real match before auto-opening or merging into `MatchupView`.
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
- Both client and server use in-memory TTL caching. Reuse existing cache-aware helpers instead of bypassing them.
- SofaScore JSON calls are client-direct first (`https://www.sofascore.com/api/v1/*`) and fall back to `/api/sofascore/*` when direct browser access is blocked by challenge/CORS/fetch errors, timeout, non-JSON responses, `403`, or `429`.
- Direct client JSON fetches must use `credentials: 'omit'`; do not send cross-origin SofaScore credentials from the app origin.
- Client data-access flags:
  - `VITE_SOFASCORE_DIRECT=false` disables direct browser JSON fetches.
  - `VITE_SOFASCORE_PROXY_FALLBACK=false` disables proxy fallback when direct is enabled.
  - `VITE_SOFASCORE_DIRECT_ORIGIN` overrides the default `https://www.sofascore.com/api/v1`.
  - `VITE_SOFASCORE_DIRECT_TIMEOUT_MS` controls the direct browser timeout.
- Images still go through `/api/img/*`; the proxy now tries a fast direct fetch from `img.sofascore.com` first and only falls back to the browser relay when needed.
- The server no longer relies only on raw Node `fetch()` to SofaScore. In production it is expected to use a persistent real Chrome/Chromium session, either by:
  - connecting to an existing browser via `SOFASCORE_BROWSER_CDP_URL`
  - launching a local Chrome/Chromium binary via `SOFASCORE_BROWSER_EXECUTABLE_PATH`
- In local development, if `SOFASCORE_BROWSER_EXECUTABLE_PATH` is not set, the server auto-detects a common Chrome/Chromium/Edge executable path before falling back to direct Node fetches.
- The browser relay keeps a warmed page on `https://www.sofascore.com/` and executes in-page `fetch()` calls for JSON plus fallback image requests, so blocked SofaScore requests can still inherit a real browser session instead of a plain server-side fingerprint.
- Home schedule logos and flags should use `PriorityImage`, which keeps load priority separate from reveal gating: visible items load first, offscreen items trickle only after the visible queue drains, and newly expanded sections are promoted to high priority immediately.
- `HomeCalendar` opens a fresh reveal session on every date change and closes the green loader once the images that were actually inside the initial viewport have either loaded or failed; images below the fold must never hold that gate open.
- `DaySchedule` should keep schedule content mounted but visually hidden during the reveal session so `IntersectionObserver` and image requests can start immediately, without showing a separate centered overlay spinner or letting the hidden list capture interaction.
- `SOFASCORE_DIRECT_FALLBACK` controls whether the old direct Node-fetch fallback remains allowed when no browser relay is configured.
- The server exposes `/api/sofascore-browser/status` for relay diagnostics.
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
