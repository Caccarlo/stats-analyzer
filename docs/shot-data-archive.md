# Local shot-data archive

Stats Analyzer keeps top-five-league shot observations in `server/.shot-data/shots.sqlite`. The source is [Football-Data](https://www.football-data.co.uk/downloadm.php); its field notes define `HS`/`AS` as home/away shots and `HST`/`AST` as shots on target.

## Lifecycle

- An empty database triggers a background bootstrap when the server starts.
- Bootstrap requests the current and previous season for Premier League, Serie A, LaLiga, Bundesliga, and Ligue 1.
- Downloads are sequential and spaced by `SHOT_DATA_DOWNLOAD_INTERVAL_MS` (five seconds by default).
- Every available CSV is parsed and validated before the importer opens one SQLite transaction.
- A failed or invalid download leaves the previous database unchanged.
- A current-season file returning `300` or `404` is treated as not published yet, reported as skipped, and retried by the next daily refresh.
- Successful updates prune season start years older than the immediately preceding season.

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

## Prediction isolation

Opening `Previsioni` sends the already-known match snapshot to the local server. The forecast then uses only SQLite rows whose timestamp is before kickoff. The page never requests SofaScore statistics, metadata, or images: it reuses the opened match labels and renders team initials locally. SofaScore remains the source for the surrounding navigation and `Formazioni`, but selecting `Previsioni` adds no SofaScore traffic.

Football-Data reports a possible inconsistency in Italian shot counts since 2018/19 related to blocked-shot inclusion. The UI exposes this caveat for Serie A forecasts; the model also limits itself to two adjacent seasons so definitions from older eras cannot enter the sample.
