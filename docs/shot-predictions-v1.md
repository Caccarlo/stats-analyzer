# Shot predictions V1 lightweight

## Scope

Model version `shots-v1.2.0-lite` estimates total shots only for not-yet-started SofaScore events in Serie A, Premier League, LaLiga, Bundesliga, and Ligue 1. Historical and live forecasts are disabled until the persistent local top-five-league archive is complete enough for reproducible point-in-time backtests.

The response contains expected home shots, expected away shots, expected total shots, an indicative 80% interval, and seven consecutive half-shot Under/Over lines with fair no-margin odds. Team-total probabilities remain out of scope.

## Bounded collection

For a target event `E` with kickoff `T`, every usable row satisfies:

```text
startTimestamp < T
eventId != E
same domestic league as E
season = target season or immediately preceding season
```

The server reads team history rather than paging the whole league:

- at most 40 home matches for the target home team;
- at most 40 away matches for the target away team;
- at most eight team-history pages per side;
- match statistics fetched sequentially, one request in flight;
- model requests begin at least five seconds apart by default.

SofaScore labels such as `26/27` are parsed as season start year 2026. The pivot is deliberate: `70/71` is 1970, so an ancient season cannot be mistaken for the previous one because of a nonchronological API id.

## Lightweight calculation

The V1 uses:

```text
μ_home = L_H × A_home × V_away
μ_away = L_A × A_away × V_home
μ_total = μ_home + μ_away
```

- observations decay with a fixed 180-day half-life;
- ratings are shrunk toward `1` with a fixed 10-match prior;
- `L_H` and `L_A` are baselines of the targeted two-team sample, not full-league baselines;
- the extra continuous-strength term is disabled;
- promoted-team transfer is disabled;
- the total uses a Poisson distribution that is explicitly marked as not yet calibrated on the complete league archive;
- chronological parameter selection and the negative-binomial comparison are deferred.

This is intentionally an operational baseline, not the final statistical model. The existing point-in-time helpers remain covered by leakage tests so they can be reused when the archive enables the full model.

## Why match rows matter

- Temporal trend: a match from ten days ago receives more weight than one from a year ago, allowing the estimate to react gradually to how a team is playing now.
- Home/away: individual rows identify the venue without relying on a combined season average. The lightweight dataset uses only the venue relevant to the forecast.
- Opponent strength: it can distinguish the same shot total achieved against a strong or weak opponent, but the additional forecast adjustment is disabled in this version until it can be validated out of sample.
- Variance and distribution: the mean says the central expectation; the spread of historical totals is required to estimate how frequently actual totals land far from it and therefore to calibrate Under/Over probabilities.
- Point-in-time backtest: for each historical test match, the model is rebuilt using only information that existed before its kickoff. This measures real predictive performance without letting future results leak backward.

## Runtime flow and protection

1. `MatchupPage` enables the job only after the user selects `Previsioni`.
2. A cache hit younger than six hours returns `200 ready` without probing SofaScore again.
3. A cache miss creates one deduplicated background job and returns `202 building`.
4. `403` or `429` clears queued work and opens a disk-persisted 24-hour model cooldown by default, including across server restarts.
5. Details load only after a result or market selection.
6. Descriptive averages remain unmounted until the prediction is ready and the user clicks `Carica medie`; their statistics are sequential too.

The cooldown must not be bypassed by restarting the server. `/api/sofascore-browser/status` exposes the persisted model-circuit deadline; before changing network, use its isolated `?probe=1` check rather than loading the entire app. The probe follows the same warmed SofaScore page plus in-page `fetch()` path as normal JSON traffic, because direct API navigation can produce a false `403`.

## Persistent local cache

Runtime files live under the Git-ignored `server/.shot-model-cache/`:

- `metadata/`: season and event metadata;
- `raw-statistics/`: reusable finished-event statistics;
- `point-in-time/`: filtered observation snapshots;
- `average-catalog/` and `averages/`: descriptive data;
- `predictions/`: forecasts keyed by `eventId + modelVersion`;
- `prediction-details/`: calculation rows.
- `runtime-state/`: persistent upstream cooldown state.

This is already a persistent on-demand local archive. A separate slow daily top-five-league synchronizer should be added only after the new network passes the isolated probe and its request budget is independently enforced; it must not perform an unattended full bootstrap on application startup.

## API responses

```text
GET /api/predictions/shots/:eventId
GET /api/predictions/shots/:eventId/details?selection=under:28.5&source=home&page=1&pageSize=25
GET /api/teams/:teamId/shot-averages/catalog
GET /api/teams/:teamId/shot-averages?competitionId=23&seasonId=...&venue=home
```

Prediction responses are `200 ready`, `202 building`, `422 future_matches_only` or `unsupported_or_insufficient_data`, and `502 upstream_error`/`upstream_temporarily_blocked`.

## Verification

```bash
cd server
npm test

cd ../client
npm test -- --run
npm run lint
npm run build
```

The tests cover season parsing, the Total shots parser, time weights, CDF and market math, cutoff leakage, team/venue/two-season boundaries, future-only rejection, lazy independent averages, and immediate circuit opening after one failed statistic request.
