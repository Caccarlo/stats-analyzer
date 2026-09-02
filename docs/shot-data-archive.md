# Local shot-data archive

Stats Analyzer keeps first- and second-division shot observations in `server/.shot-data/shots.sqlite`. The source is [Football-Data](https://www.football-data.co.uk/downloadm.php); its field notes define `HS`/`AS` as home/away shots and `HST`/`AST` as shots on target.

## Lifecycle

- An empty database triggers a background bootstrap when the server starts.
- Bootstrap requests the current season and six predecessors for Premier League/Championship, Bundesliga/2. Bundesliga, Serie A/Serie B, LaLiga/LaLiga 2, and Ligue 1/Ligue 2: at most 70 CSVs.
- Downloads are sequential and spaced by `SHOT_DATA_DOWNLOAD_INTERVAL_MS` (five seconds by default).
- Every available CSV is parsed and validated before the importer opens one SQLite transaction.
- A failed or invalid download leaves the previous database unchanged.
- A current-season file returning `300` or `404` is treated as not published yet, reported as skipped, and retried by the next daily refresh.
- Successful updates retain seven season start years. A changed archive version forces a new full bootstrap before predictions are considered ready.
- Daily refresh requests only the ten current-season CSVs.
- `HS`/`AS` remain authoritative for the model. If an accessory `HST`/`AST` value is greater than its corresponding total, only that accessory value is stored as `null`; the valid total-shot observation is retained and the discard count is exposed by `/api/shot-data/status`.

Inspect progress without contacting either upstream:

```text
GET http://localhost:3001/api/shot-data/status
```

Run a full import manually with the server stopped:

```bash
cd server
npm run sync:shots
```

Use `node shot-data-archive.js --daily` to update only the current season.

## Competition-transition calibration

The older five completed transition seasons are used only to estimate movement between the paired divisions. Promotion and relegation are separate profiles for every country. Each club-season contributes four relative factors: home attack, home vulnerability, away attack, and away vulnerability.

A profile becomes usable only with at least eight club-season transitions spread across at least three seasons. Every contributing club must have at least eight home and eight away matches in both its source and destination seasons. “13 transitions” therefore means 13 distinct club-season moves, not 13 matches.

Chronological folds compare the learned factors with an unchanged source-division transfer. They test priors worth 5, 10, and 20 equivalent matches. The level effect is retained only when it improves out-of-sample negative log-likelihood by at least 0.5% while keeping MAE within 2% of the unchanged transfer. If it does not, all four level factors become `1`, but the club's real source-season rating can still be transferred.

The transition is applied only when the club is present in the paired source division in the preceding season and has at least eight matches at each venue there. A club promoted from an uncovered third tier into a covered second division receives no synthetic estimate; predictions remain blocked until it has eight relevant home or away matches in the destination league.

## Prediction isolation

Opening `Previsioni` sends the already-known match snapshot to the local server. The forecast then uses only SQLite rows whose timestamp is before kickoff. The page never requests SofaScore statistics, metadata, or images: it reuses the opened match labels and renders team initials locally. SofaScore remains the source for the surrounding navigation and `Formazioni`, but selecting `Previsioni` adds no SofaScore traffic.

Football-Data reports a possible inconsistency in Italian shot counts since 2018/19 related to blocked-shot inclusion. The UI exposes this caveat for Serie A forecasts; the destination-league model still limits itself to two adjacent seasons so definitions from older eras cannot enter the fit. Older rows are used only for transition cohorts.
