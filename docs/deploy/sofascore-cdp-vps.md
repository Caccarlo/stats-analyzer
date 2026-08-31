# SofaScore CDP Fallback Deploy On VPS

This is the fallback relay setup for Stats Analyzer.

The primary JSON path is client-direct browser fetch from `client/src/api/sofascore.ts`, because SofaScore can treat VPS/datacenter IPs differently from real user browsers. Keep this CDP setup as an operational fallback only after verifying that the target VPS/IP can fetch SofaScore JSON without `403`/`challenge` responses.

## Architecture

- Chrome/Chromium runs as its own long-lived process on the VPS.
- Chrome exposes DevTools Protocol on `127.0.0.1:9222`.
- The Express proxy connects to that browser with `SOFASCORE_BROWSER_CDP_URL`.
- The app keeps `SOFASCORE_DIRECT_FALLBACK=false` so a broken browser relay fails loudly instead of silently falling back to blocked direct fetches.
- The frontend tries direct SofaScore JSON first unless `VITE_SOFASCORE_DIRECT=false` is set at build time.
- Client-direct and server-relay requests are paced separately. Either side opens a queue-clearing cooldown circuit after a `403` or `429` instead of continuing to retry a blocked network.

## Why this setup

- It keeps the browser process separate from the Node app.
- Browser crashes and app crashes can be restarted independently.
- The same warmed browser session survives app restarts.
- It provides a controlled fallback path when direct browser access fails for a user.
- It is not a guarantee against SofaScore JSON challenges if the VPS/datacenter IP reputation is poor.

## Files in this folder

- `stats-analyzer.env.example`
- `stats-analyzer-browser.service.example`
- `stats-analyzer-app.service.example`

## Suggested target paths on the VPS

- repo: `/opt/stats-analyzer`
- env file: `/opt/stats-analyzer/.env.stats-analyzer`
- Chrome profile: `/opt/stats-analyzer/chrome-profile`
- browser service: `/etc/systemd/system/stats-analyzer-browser.service`
- app service: `/etc/systemd/system/stats-analyzer-app.service`

## Environment file

Create `/opt/stats-analyzer/.env.stats-analyzer` from the example in this folder.

Recommended values:

```bash
SOFASCORE_BROWSER_CDP_URL=http://127.0.0.1:9222
SOFASCORE_BROWSER_HEADLESS=true
SOFASCORE_DIRECT_FALLBACK=false
SOFASCORE_BROWSER_FETCH_TIMEOUT_MS=20000
SOFASCORE_GLOBAL_MIN_INTERVAL_MS=750
SOFASCORE_GLOBAL_COOLDOWN_MS=900000
```

Do not set `SOFASCORE_BROWSER_EXECUTABLE_PATH` in the final VPS CDP setup.

## Chrome service

1. Copy `stats-analyzer-browser.service.example` to `/etc/systemd/system/stats-analyzer-browser.service`
2. Adjust `User`, `Group`, and Chrome binary path if needed.
3. Create the profile directory:

```bash
sudo mkdir -p /opt/stats-analyzer/chrome-profile
sudo chown -R stats:stats /opt/stats-analyzer/chrome-profile
```

## App service

1. Copy `stats-analyzer-app.service.example` to `/etc/systemd/system/stats-analyzer-app.service`
2. Adjust `User`, `Group`, `WorkingDirectory`, and `npm` path if needed.
3. Ensure the app service user can create and write the persistent model, image, and SQLite caches:

```bash
sudo mkdir -p /opt/stats-analyzer/server/.shot-model-cache
sudo mkdir -p /opt/stats-analyzer/server/.shot-data
sudo mkdir -p /opt/stats-analyzer/server/.asset-cache
sudo chown -R stats:stats /opt/stats-analyzer/server/.shot-model-cache /opt/stats-analyzer/server/.shot-data /opt/stats-analyzer/server/.asset-cache
```

`.shot-model-cache` contains versioned forecasts, details, and match snapshots. `.shot-data/shots.sqlite` contains the two-season Football-Data archive. `.asset-cache` contains flags and SofaScore logos with asset-specific expiry times. Keep all three across ordinary app restarts and deployments; model-version changes invalidate forecasts without requiring raw SQLite or image data to be deleted.

All server-side SofaScore JSON traffic passes through the global gate. The defaults start calls at least 750 ms apart and suspend queued work for 15 minutes after a `403` or `429`:

```bash
SOFASCORE_GLOBAL_MIN_INTERVAL_MS=750
SOFASCORE_GLOBAL_COOLDOWN_MS=900000
```

Legacy no-archive model collection is paced once more before it reaches that global gate. Ordinary archive-backed forecasts do not fetch SofaScore match statistics. Override either layer only after the upstream environment has been verified:

```bash
SOFASCORE_MODEL_MIN_INTERVAL_MS=5000
SOFASCORE_MODEL_COOLDOWN_MS=86400000
```

The fallback collector is single-flight. Its longer interval and 24-hour terminal cooldown are intentionally more conservative than the ordinary application gate; do not lower them until the upstream network has passed the isolated status probe.

## Enable and start

```bash
sudo systemctl daemon-reload
sudo systemctl enable stats-analyzer-browser.service
sudo systemctl enable stats-analyzer-app.service
sudo systemctl start stats-analyzer-browser.service
sudo systemctl start stats-analyzer-app.service
```

## Verify

Check Chrome CDP:

```bash
curl http://127.0.0.1:9222/json/version
```

Check the app relay:

```bash
curl http://127.0.0.1:3001/api/sofascore-browser/status
curl "http://127.0.0.1:3001/api/sofascore-browser/status?probe=1"
```

The first command is local-only and does not contact SofaScore. The second command performs one isolated upstream categories navigation and warms the football page. A categories `200` alone is not sufficient: SofaScore can allow that lightweight endpoint while rejecting the page and tournament/event routes. Before opening the frontend, require both `probe.reachable: true` and `pageStatus: 200`. If `pageStatus` is `403`, switch network/session instead of probing more endpoints.

Expected relay status shape:

```json
{
  "configured": true,
  "connected": true,
  "mode": "cdp",
  "pageUrl": "https://www.sofascore.com/football",
  "pageStatus": 200,
  "requestTokenCaptured": false,
  "upstreamCircuit": {
    "open": false,
    "upstreamStatus": null,
    "blockedUntil": null,
    "active": 0,
    "pending": 0,
    "maximumConcurrent": 1,
    "minimumIntervalMs": 750
  },
  "probe": null
}
```

With `?probe=1`, `probe.reachable=true` and `probe.statusCode=200` mean the tested network path is usable. A `403` or `429` opens the circuit immediately; queued server work is rejected locally during cooldown and the response exposes `blockedUntil`.

## Logs

```bash
sudo journalctl -u stats-analyzer-browser.service -f
sudo journalctl -u stats-analyzer-app.service -f
```

## Rollback

If CDP is temporarily unavailable, do not turn `SOFASCORE_DIRECT_FALLBACK` back on in production unless you explicitly want to re-enable the old blocked direct-fetch path for debugging.
