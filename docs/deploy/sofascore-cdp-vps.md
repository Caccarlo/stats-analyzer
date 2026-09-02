# SofaScore CDP Fallback Deploy On VPS

This is the fallback relay setup for Stats Analyzer.

The primary JSON path is client-direct browser fetch from `client/src/api/sofascore.ts`, because SofaScore can treat VPS/datacenter IPs differently from real user browsers. Keep this CDP setup as an operational fallback only after verifying that the target VPS/IP can fetch SofaScore JSON without `403`/`challenge` responses.

## Architecture

- Chrome/Chromium runs as its own long-lived process on the VPS.
- Chrome exposes DevTools Protocol on `127.0.0.1:9222`.
- The Express proxy connects to that browser with `SOFASCORE_BROWSER_CDP_URL`.
- The app keeps `SOFASCORE_DIRECT_FALLBACK=false` so a broken browser relay fails loudly instead of silently falling back to blocked direct fetches.
- The frontend tries direct SofaScore JSON first unless `VITE_SOFASCORE_DIRECT=false` is set at build time.

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
curl http://127.0.0.1:3001/api/sofascore/sport/football/categories
curl http://127.0.0.1:3001/api/sofascore/sport/football/scheduled-events/2026-05-08
```

Expected relay status shape:

```json
{
  "configured": true,
  "connected": true,
  "mode": "cdp",
  "pageUrl": "https://www.sofascore.com/"
}
```

## Logs

```bash
sudo journalctl -u stats-analyzer-browser.service -f
sudo journalctl -u stats-analyzer-app.service -f
```

## Rollback

If CDP is temporarily unavailable, do not turn `SOFASCORE_DIRECT_FALLBACK` back on in production unless you explicitly want to re-enable the old blocked direct-fetch path for debugging.
