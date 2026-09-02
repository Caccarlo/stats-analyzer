# Shot predictions V1

## Scope

Model version `shots-v1.4.0-football-data-transitions` estimates total shots for future and historical matches in Premier League, Championship, Bundesliga, 2. Bundesliga, Serie A, Serie B, LaLiga, LaLiga 2, Ligue 1, and Ligue 2.

The response contains expected home, away, and total shots, an 80% interval, and seven consecutive half-shot Under/Over lines with fair no-margin odds. Team-total probabilities remain out of scope.

## Local data boundary

`server/shot-data-archive.js` imports Football-Data `HS`/`AS` shot columns into `server/.shot-data/shots.sqlite`. Bootstrap downloads the current season plus six predecessors for all ten competitions, at most 70 files. Current-season refresh then downloads at most ten files once per day.

All files are parsed and validated before one atomic SQLite transaction. An invalid or interrupted update cannot replace a valid database. A current-season `300`/`404` means the source has not published that league yet; it is reported as skipped and retried later. Successful imports retain seven seasons; an archive-version mismatch forces a complete rebuild.

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

For a club changing division, each source-season rating is transferred as:

```text
transition_prior_component = source_rating_component x calibrated_level_factor_component
destination_rating_component =
  (n_eff x observed_destination_rating + shrinkage x 1 + equivalent_matches x transition_prior_component)
  / (n_eff + shrinkage + equivalent_matches)
```

Promotion and relegation are calibrated separately for each country and for home attack, home vulnerability, away attack, and away vulnerability. The cohort uses the last five completed transition seasons, requires at least eight club-season moves over three seasons, and admits each club only with eight home and eight away matches in both source and destination seasons. A chronological comparison against unchanged source-rating transfer selects 5, 10, or 20 equivalent matches. A level factor is retained only with at least 0.5% NLL improvement and MAE no more than 2% worse; otherwise that factor is neutral (`1`).

A club arriving from an uncovered third tier has no source prior and cannot be predicted before eight relevant venue matches in its destination league. No manual multiplier or invented observation is allowed. Football-Data's Serie A shot-definition caveat remains exposed in forecast warnings.

## Runtime flow

1. `MatchupPage` stores the real match kickoff in navigation state.
2. Selecting `Previsioni` sends `POST /api/predictions/shots/:eventId` with the match snapshot already loaded by the UI.
3. The POST rejects an incomplete snapshot with `422 invalid_target_snapshot`; it never falls back to SofaScore. A GET can only read or follow an already primed target.
4. The server persists the snapshot and starts one deduplicated job. The chronological parameter backtest runs in a worker thread so the proxy stays responsive.
5. `useShotPrediction` polls the GET route while that local job runs.
6. Details and the two independent average panels query SQLite lazily.

Deterministic `422` failures have distinct codes: `unsupported_competition`, `team_not_recognized`, `insufficient_team_history`, `insufficient_competition_history`, `transition_calibration_unavailable`, and `invalid_target_snapshot`. The UI explains these states without offering a retry that cannot change the result. Successful transition forecasts expose the source/destination competitions, source season, cohort size, selected equivalent-match weight, and whether validation retained the level effect.

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

Tests cover CSV parsing, atomic rollback, seven-season/ten-competition retention, canonical team reconciliation, descriptive averages, point-in-time cutoff, four-component promotion and relegation calibration, transition-prior blending, cold-start blocking, model math, worker-based chronological selection, snapshot priming, GET initialization guards, transition diagnostics in React, and a source-level invariant that forbids HTTP transport inside the prediction model.
