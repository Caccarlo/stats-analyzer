# Shot predictions V1

## Scope

Model version `shots-v1.3.0-football-data` estimates total shots for future and historical matches in Serie A, Premier League, LaLiga, Bundesliga, and Ligue 1 when the target season is covered by the local two-season archive.

The response contains expected home, away, and total shots, an 80% interval, and seven consecutive half-shot Under/Over lines with fair no-margin odds. Team-total probabilities remain out of scope.

## Local data boundary

`server/shot-data-archive.js` imports Football-Data `HS`/`AS` shot columns into `server/.shot-data/shots.sqlite`. Bootstrap downloads at most five top-flight files for each of the current and previous seasons. Current-season refresh then runs once per day.

All files are parsed and validated before one atomic SQLite transaction. An invalid or interrupted update cannot replace a valid database. A current-season `300`/`404` means the source has not published that league yet; it is reported as skipped and retried later. Successful imports prune rows older than the previous season.

For target event `E` with kickoff `T`, every usable row satisfies:

```text
startTimestamp < T
same domestic league as E
season = target season or immediately preceding season
not the same home/away pairing within six hours of T
```

The final rule protects against target leakage because Football-Data and SofaScore use different event IDs and may record slightly different timestamps.

## Calculation

```text
mu_home = L_H x A_home x V_away x exp(f(D))
mu_away = L_A x A_away x V_home x exp(g(D))
mu_total = mu_home + mu_away
```

- `L_H` and `L_A` are time-weighted league home/away baselines.
- Attack and vulnerability ratings are corrected using the opponent rating available before each observation and shrunk toward `1`.
- Walk-forward backtesting selects half-life from `60, 90, 120, 180, 270, 365` days and shrinkage from `5, 10, 20` equivalent matches.
- Linear/quadratic strength terms are retained only with at least 1% out-of-sample NLL improvement, non-worse MAE, and acceptable calibration.
- Poisson and negative-binomial total distributions are compared by out-of-sample NLL; the total is calibrated directly rather than built from independent team counts.
- A line `x.5` uses `P(Under)=P(T<=x)`, `P(Over)=1-P(Under)`, and fair odds `1/p`.

Promotion transfer remains neutral until the bounded archive includes second divisions. No manual multiplier is allowed. Football-Data's Serie A shot-definition caveat is exposed in forecast warnings.

## Runtime flow

1. `MatchupPage` stores the real match kickoff in navigation state.
2. Selecting `Previsioni` sends `POST /api/predictions/shots/:eventId` with the match snapshot already loaded by the UI.
3. The POST rejects an incomplete snapshot with `422 invalid_target_snapshot`; it never falls back to SofaScore. A GET can only read or follow an already primed target.
4. The server persists the snapshot and starts one deduplicated job. The chronological parameter backtest runs in a worker thread so the proxy stays responsive.
5. `useShotPrediction` polls the GET route while that local job runs.
6. Details and the two independent average panels query SQLite lazily.

Every numerical value shown by the page comes from Football-Data or a local calculation: `HS`/`AS` provide match shots; expected values, intervals, probabilities, fair odds, historical rows, and averages are derived from those observations. The event id, kickoff, competition, season, and team labels are display/target metadata reused from the match already opened in the app. Team badges use local initials, so opening `Previsioni` adds no SofaScore JSON or image request.

Historical predictions are immutable for a model version. Future predictions are reused for six hours. Prediction JSON lives under `server/.shot-model-cache/`; raw observations live only in SQLite.

## APIs

```text
POST /api/predictions/shots/:eventId
GET  /api/predictions/shots/:eventId
GET  /api/predictions/shots/:eventId/details?selection=under:28.5&source=home&page=1&pageSize=25
GET  /api/teams/:teamId/shot-averages/catalog?teamName=...
GET  /api/teams/:teamId/shot-averages?teamName=...&competitionId=23&seasonId=2026&venue=home
GET  /api/shot-data/status
```

## Verification

```bash
cd server
npm test

cd ../client
npm test
npm run lint
npm run build
```

Tests cover CSV parsing, atomic rollback, two-season pruning, team reconciliation, descriptive averages, point-in-time cutoff, model math, worker-based chronological selection, snapshot priming, GET initialization guards, and a source-level invariant that forbids HTTP transport inside the prediction model.
