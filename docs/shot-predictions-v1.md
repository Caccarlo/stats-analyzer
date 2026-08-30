# Shot predictions V1

## Scope

The V1 estimates match total shots for real SofaScore events in Serie A, Premier League, LaLiga, Bundesliga, and Ligue 1. It runs on demand only when `Previsioni` is selected and uses one pipeline for scheduled, live, and finished events.

It returns expected home shots, expected away shots, expected total shots, an 80% central interval, a directly calibrated total-count distribution, and seven consecutive half-shot Under/Over lines with fair no-margin odds. Team-total market probabilities are intentionally out of scope until marginal team distributions are modelled separately.

## Temporal boundary

For target event `E` with kickoff `T`, the dataset is filtered before every statistic or fit:

```text
startTimestamp < T
eventId != E
```

This applies to baselines, point-in-time opponent strength, temporal weights, ratings, promotion transfers, parameter selection, dispersion, and backtests. A historical target result or any later match therefore cannot change its forecast. Server tests mutate both and assert an identical forecast.

The predictive window contains only the target season up to kickoff and its immediately preceding season. For a 2025/26 target, no 2023/24 observation is downloaded or fitted.

Descriptive averages expose only the team's latest available season and the immediately preceding season. Within either selected season they intentionally use all currently finished data, so they may contain the target and later events and never share their rows with the model dataset. The compact `Formazioni` history remains an independent recent-match view.

## Data and model

- Source: `event/{eventId}/statistics`, period `ALL`, key `totalShotsOnGoal` (“Total shots” in the SofaScore UI).
- Only events from the target domestic league enter the prediction dataset.
- Missing shot statistics are excluded and counted. Red-card matches remain.
- Temporal weight: `2 ^ (-days / H)`.
- Effective sample: `(sum(w)^2) / sum(w^2)`.
- Ratings are venue-specific, corrected by the opponent rating available before each observation, and shrunk toward `1`.
- Half-life candidates: `60, 90, 120, 180, 270, 365` days.
- Shrinkage candidates: `5, 10, 20` equivalent matches.
- The optional continuous strength term is selected only with at least 1% out-of-sample likelihood improvement, non-worse MAE, and acceptable calibration.
- Poisson and negative binomial are compared on the observed total directly; the simpler Poisson wins when the likelihood difference is negligible.
- Promotion priors can use the corresponding second division's immediately preceding season. Older transition cohorts are not downloaded; when a transition cannot be estimated inside the two-season window, the transferred prior is neutralized toward `1`, the interval is expanded, and the limitation is shown explicitly.

## Runtime flow

1. `MatchupPage` enables `useShotPrediction` only after the user selects `Previsioni`; `Formazioni` produces no model request.
2. A cache hit returns `200 ready`.
3. A cache miss creates one deduplicated background job and returns `202 building` with progress.
4. The client polls with bounded backoff. Leaving the page does not cancel server work.
5. Model details and paginated source rows are loaded only after the user selects a result or market side.

The global model fetch queue permits at most three simultaneous SofaScore requests and starts them at least one second apart by default. The relay reuses one warmed SofaScore page instead of navigating to the homepage for every statistic. A first upstream `403` or `429` clears all pending work and opens a 15-minute cooldown circuit, both configurable through `SOFASCORE_MODEL_MIN_INTERVAL_MS` and `SOFASCORE_MODEL_COOLDOWN_MS`.

## Persistent cache

Runtime files live under `server/.shot-model-cache/` and are excluded from Git:

- `metadata/`: competition, season, and event-page metadata;
- `raw-statistics/`: immutable finished-event statistics;
- `point-in-time/`: cutoff-filtered observation snapshots, separate from descriptive data;
- `average-catalog/` and `averages/`: descriptive selectors and results;
- `predictions/`: `eventId + modelVersion` forecasts;
- `prediction-details/`: source rows for the calculation drill-down.

Past predictions are immutable for the same model version. Future predictions are checked for a newly completed relevant event and otherwise expire after six hours. A model-version change invalidates forecasts without invalidating raw match statistics.

## API responses

```text
GET /api/predictions/shots/:eventId
GET /api/predictions/shots/:eventId/details?selection=under:28.5&source=home&page=1&pageSize=25
GET /api/teams/:teamId/shot-averages/catalog
GET /api/teams/:teamId/shot-averages?competitionId=23&seasonId=...&venue=home
```

Prediction status codes are `200 ready`, `202 building`, `422 unsupported_or_insufficient_data`, and `502 upstream_error`/`upstream_temporarily_blocked`.

## Verification

```bash
cd server
npm test

cd ../client
npm test
npm run lint
npm run build
```

The test suite covers the Total shots parser, time weights, effective sample, Poisson/negative-binomial CDFs, seven half-shot lines and fair odds, explicit cutoff leakage, the two-season boundary, descriptive/predictive separation, lazy prediction startup, independent average-panel changes, terminal proxy fallback, and queue cancellation after `403`.
