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
- Data source: public SofaScore API, always accessed through the local Express proxy
- No database
- No auth
- No API keys

## Stack

| Layer | Tech | Port |
| --- | --- | --- |
| Client | React 19, TypeScript 5.9, Vite 8, Tailwind CSS 4 | 5173 |
| Server | Express 4 proxy with CORS enabled | 3001 |

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
|-- package.json
|-- server/
|   `-- index.js
`-- client/
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
- `client/src/context/NavigationContext.tsx`: reducer-driven navigation state, split open/close/swap logic, per-panel filter persistence
- `client/src/api/sofascore.ts`: all client API calls, client TTL cache, in-flight dedupe, terminal 4xx handling, tournament paging helpers
- `client/src/hooks/usePlayerData.ts`: player seasons, period/filter state, tournament enablement, aggregated season stats
- `client/src/hooks/useMatchTimeline.ts`: event paging, context snapshots, progressive official stats / duration / substitution / lineup loading
- `client/src/hooks/useMatchDetails.ts`: shared match-detail cache and rich-data helpers
- `client/src/hooks/useTournamentViewData.ts`: standings vs phase reconstruction, latest valid season resolution, shared tournament snapshot cache
- `client/src/pages/PlayerPage.tsx`: coordinates filters, timeline, selection, derived stats, empty/loading states, card layout
- `server/index.js`: Express proxy for JSON and images with server-side caching

## Architecture And Conventions

- The app does not use React Router. Navigation is state-driven through `NavigationContext`.
- Split view is desktop-only and starts at `1024px`.
- Panel behavior matters. Many layout decisions depend on measured panel width, not only viewport width.
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
- All SofaScore JSON calls go through `/api/sofascore/*`. Images go through `/api/img/*`.

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
