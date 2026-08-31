const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const {
  ShotModelError,
  createShotPredictionService,
  registerShotPredictionRoutes,
} = require('./shot-predictions');
const {
  createShotDataArchive,
  registerShotDataArchiveRoutes,
} = require('./shot-data-archive');
const { createUpstreamGate } = require('./upstream-gate');
const {
  createPersistentAssetCache,
  getAssetCachePolicy,
} = require('./persistent-asset-cache');

const app = express();
app.use(cors());
app.use(express.json({ limit: '32kb' }));

const SOFASCORE_WEB_ORIGIN = 'https://www.sofascore.com';
const SOFASCORE_API_ORIGIN = process.env.SOFASCORE_API_ORIGIN || 'https://api.sofascore.com';
const SOFASCORE_X_REQUESTED_WITH_FALLBACK = process.env.SOFASCORE_X_REQUESTED_WITH || '';
const SOFASCORE_IMAGE_ORIGIN = 'https://img.sofascore.com';
const CACHE_TTL = 5 * 60 * 1000;
const IMAGE_CACHE_TTL = 30 * 60 * 1000;
const BROWSER_FETCH_TIMEOUT_MS = Number(process.env.SOFASCORE_BROWSER_FETCH_TIMEOUT_MS || 20000);
const GLOBAL_UPSTREAM_MIN_INTERVAL_MS = Number(process.env.SOFASCORE_GLOBAL_MIN_INTERVAL_MS || 750);
const GLOBAL_UPSTREAM_COOLDOWN_MS = Number(process.env.SOFASCORE_GLOBAL_COOLDOWN_MS || 15 * 60 * 1000);
const MODEL_UPSTREAM_MIN_INTERVAL_MS = Number(process.env.SOFASCORE_MODEL_MIN_INTERVAL_MS || 5000);
const MODEL_UPSTREAM_COOLDOWN_MS = Number(process.env.SOFASCORE_MODEL_COOLDOWN_MS || 24 * 60 * 60 * 1000);
const BROWSER_PAGE_URL = process.env.SOFASCORE_BROWSER_PAGE_URL || `${SOFASCORE_WEB_ORIGIN}/football`;
const BROWSER_CDP_URL = process.env.SOFASCORE_BROWSER_CDP_URL || '';
const BROWSER_EXECUTABLE_PATH = process.env.SOFASCORE_BROWSER_EXECUTABLE_PATH || '';
const BROWSER_USER_DATA_DIR = process.env.SOFASCORE_BROWSER_USER_DATA_DIR
  || path.join(__dirname, '.sofascore-browser-profile');
const BROWSER_HEADLESS = process.env.SOFASCORE_BROWSER_HEADLESS === 'true';
const DIRECT_FALLBACK_ENABLED = process.env.SOFASCORE_DIRECT_FALLBACK !== 'false';
const ASSET_CACHE_DIR = process.env.ASSET_CACHE_DIR || path.join(__dirname, '.asset-cache');

const serverCache = new Map();
const imageCache = new Map();
const inFlightJsonRequests = new Map();
const inFlightImageRequests = new Map();
const persistentAssetCache = createPersistentAssetCache({ directory: ASSET_CACHE_DIR });
const jsonUpstreamGate = createUpstreamGate({
  maximumConcurrent: 1,
  minimumIntervalMs: GLOBAL_UPSTREAM_MIN_INTERVAL_MS,
  cooldownMs: GLOBAL_UPSTREAM_COOLDOWN_MS,
});
const essentialImageUpstreamGate = createUpstreamGate({
  maximumConcurrent: 3,
  minimumIntervalMs: 250,
  cooldownMs: GLOBAL_UPSTREAM_COOLDOWN_MS,
});
const backgroundImageUpstreamGate = createUpstreamGate({
  maximumConcurrent: 2,
  minimumIntervalMs: 500,
  cooldownMs: GLOBAL_UPSTREAM_COOLDOWN_MS,
});

function getImageUpstreamGate(imagePath) {
  return imagePath.startsWith('category/')
    ? backgroundImageUpstreamGate
    : essentialImageUpstreamGate;
}

function setImageResponseHeaders(res, imagePath, statusCode) {
  const policy = getAssetCachePolicy(imagePath, statusCode);
  res.set(
    'Cache-Control',
    `public, max-age=${policy.browserMaxAgeSeconds}, stale-while-revalidate=86400`,
  );
}

let browserRuntime = null;
let browserRuntimePromise = null;
let browserJsonPage = null;
let browserJsonPagePromise = null;
let sofaScoreRequestedWith = SOFASCORE_X_REQUESTED_WITH_FALLBACK;
let sofaScoreRequestTokenCaptured = false;
let browserPageStatus = null;
const recentBrowserApiResponses = [];

function getBrowserExecutableCandidates() {
  if (BROWSER_EXECUTABLE_PATH) {
    return [BROWSER_EXECUTABLE_PATH];
  }

  const candidates = process.platform === 'win32'
    ? [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      ]
    : process.platform === 'darwin'
      ? [
          '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
          '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        ]
      : [
          '/usr/bin/google-chrome',
          '/usr/bin/google-chrome-stable',
          '/usr/bin/chromium',
          '/usr/bin/chromium-browser',
          '/snap/bin/chromium',
          '/usr/bin/microsoft-edge',
        ];

  return candidates.filter((candidate) => candidate && fs.existsSync(candidate));
}

const BROWSER_EXECUTABLE_CANDIDATES = getBrowserExecutableCandidates();
const PRIMARY_BROWSER_EXECUTABLE_PATH = BROWSER_EXECUTABLE_CANDIDATES[0] || '';

const SOFASCORE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'it-IT,it;q=0.9,en;q=0.8',
  'Referer': `${SOFASCORE_WEB_ORIGIN}/`,
  'Origin': SOFASCORE_WEB_ORIGIN,
  'Cache-Control': 'no-cache',
};

const SOFASCORE_IMAGE_HEADERS = {
  'User-Agent': SOFASCORE_HEADERS['User-Agent'],
  'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
  'Accept-Language': SOFASCORE_HEADERS['Accept-Language'],
  'Referer': `${SOFASCORE_WEB_ORIGIN}/`,
  'Cache-Control': 'no-cache',
};

function looksLikeImageContentType(contentType = '') {
  return contentType.startsWith('image/') || contentType.includes('svg');
}

function getCached(cacheMap, key, ttl) {
  const entry = cacheMap.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > ttl) {
    cacheMap.delete(key);
    return null;
  }
  return entry;
}

function setCached(cacheMap, key, value, maxSize) {
  cacheMap.set(key, { ...value, timestamp: Date.now() });
  if (cacheMap.size > maxSize) {
    const oldest = cacheMap.keys().next().value;
    cacheMap.delete(oldest);
  }
}

function withInFlight(map, key, factory) {
  const existing = map.get(key);
  if (existing) return existing;

  const request = (async () => factory())().finally(() => {
    map.delete(key);
  });

  map.set(key, request);
  return request;
}

function isBrowserConfigured() {
  return Boolean(BROWSER_CDP_URL || PRIMARY_BROWSER_EXECUTABLE_PATH);
}

function getBrowserLaunchArgs() {
  return [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-background-networking',
    '--window-size=1440,900',
  ];
}

async function disposeBrowserRuntime() {
  const relayPage = browserJsonPage;
  browserJsonPage = null;
  browserJsonPagePromise = null;
  if (relayPage && !relayPage.isClosed()) {
    await relayPage.close().catch(() => {});
  }
  if (!browserRuntime) return;

  const runtime = browserRuntime;
  browserRuntime = null;

  try {
    if (runtime.mode === 'launch') {
      await runtime.context.close();
      return;
    }

    if (runtime.browser) {
      await runtime.browser.close();
    }
  } catch (error) {
    console.warn('Failed to close SofaScore browser runtime:', error.message);
  }
}

async function initBrowserRuntime() {
  if (!isBrowserConfigured()) {
    throw new Error(
      'Browser relay not configured. Set SOFASCORE_BROWSER_CDP_URL or SOFASCORE_BROWSER_EXECUTABLE_PATH.',
    );
  }

  await disposeBrowserRuntime();

  let mode;
  let browser = null;
  let context;

  if (BROWSER_CDP_URL) {
    mode = 'cdp';
    browser = await chromium.connectOverCDP(BROWSER_CDP_URL);
    browser.on('disconnected', () => {
      browserRuntime = null;
      browserJsonPage = null;
      browserJsonPagePromise = null;
    });
    context = browser.contexts()[0];
    if (!context) {
      throw new Error('Connected to Chrome via CDP, but no browser context is available');
    }
  } else {
    mode = 'launch';
    let lastError = null;

    for (const executablePath of BROWSER_EXECUTABLE_CANDIDATES) {
      try {
        context = await chromium.launchPersistentContext(BROWSER_USER_DATA_DIR, {
          executablePath,
          headless: BROWSER_HEADLESS,
          viewport: { width: 1440, height: 900 },
          args: getBrowserLaunchArgs(),
        });
        break;
      } catch (error) {
        lastError = error;
      }
    }

    if (!context) {
      throw lastError || new Error('No usable local Chrome/Chromium executable was found');
    }
  }

  context.on('close', () => {
    browserRuntime = null;
    browserJsonPage = null;
    browserJsonPagePromise = null;
  });

  browserRuntime = { mode, browser, context };
  return browserRuntime;
}

async function getBrowserRuntime() {
  if (browserRuntime) {
    try {
      const page = await browserRuntime.context.newPage();
      await page.close();
      return browserRuntime;
    } catch {
      browserRuntime = null;
    }
  }

  if (!browserRuntimePromise) {
    browserRuntimePromise = initBrowserRuntime().finally(() => {
      browserRuntimePromise = null;
    });
  }

  return browserRuntimePromise;
}

async function createFetchPage(runtime) {
  const page = await runtime.context.newPage();

  page.on('request', (request) => {
    const captured = request.headers()['x-requested-with'];
    if (captured && captured !== sofaScoreRequestedWith) {
      sofaScoreRequestedWith = captured;
      sofaScoreRequestTokenCaptured = true;
      console.log('SofaScore relay captured a fresh request token');
    }
  });
  page.on('response', (response) => {
    const responseUrl = response.url();
    if (!responseUrl.includes('/api/v1/')) return;
    recentBrowserApiResponses.push({
      path: responseUrl.split('/api/v1/')[1]?.split('?')[0] || '',
      status: response.status(),
    });
    if (recentBrowserApiResponses.length > 8) recentBrowserApiResponses.shift();
  });

  page.on('crash', () => {
    console.error('SofaScore relay page crashed');
  });

  const navigationResponse = await page.goto(BROWSER_PAGE_URL, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  browserPageStatus = navigationResponse?.status() ?? null;

  await page.waitForTimeout(1000).catch(() => {});

  return page;
}

async function getBrowserJsonPage(runtime) {
  if (browserJsonPage && !browserJsonPage.isClosed()) return browserJsonPage;
  if (!browserJsonPagePromise) {
    browserJsonPagePromise = createFetchPage(runtime)
      .then((page) => {
        browserJsonPage = page;
        page.on('close', () => {
          if (browserJsonPage === page) browserJsonPage = null;
        });
        page.on('crash', () => {
          if (browserJsonPage === page) browserJsonPage = null;
        });
        return page;
      })
      .finally(() => {
        browserJsonPagePromise = null;
      });
  }
  return browserJsonPagePromise;
}

async function fetchViaBrowserJson(cacheKey) {
  const runtime = await getBrowserRuntime();

  try {
    const page = await getBrowserJsonPage(runtime);

    const result = await page.evaluate(
      async ({ apiOrigin, requestPath, timeoutMs, requestedWith }) => {
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);

        try {
          const response = await fetch(`${apiOrigin}/api/v1/${requestPath}`, {
            headers: {
              Accept: 'application/json',
              ...(requestedWith ? { 'x-requested-with': requestedWith } : {}),
            },
            credentials: 'omit',
            signal: controller.signal,
          });
          const text = await response.text();

          return {
            ok: true,
            status: response.status,
            contentType: response.headers.get('content-type') || '',
            text,
          };
        } catch (error) {
          return {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          };
        } finally {
          window.clearTimeout(timeoutId);
        }
      },
      {
        apiOrigin: SOFASCORE_API_ORIGIN,
        requestPath: cacheKey,
        timeoutMs: BROWSER_FETCH_TIMEOUT_MS,
        requestedWith: sofaScoreRequestedWith,
      },
    );

    if (!result.ok) {
      throw new Error(`Browser JSON fetch failed for ${cacheKey}: ${result.error}`);
    }

    if (!result.contentType.includes('application/json')) {
      throw new Error(`Browser JSON fetch returned non-JSON content for ${cacheKey}: ${result.contentType}`);
    }

    return {
      statusCode: result.status,
      contentType: result.contentType,
      data: JSON.parse(result.text),
      source: 'browser',
    };
  } catch (error) {
    if (String(error.message || error).includes('Target page, context or browser has been closed')) {
      await disposeBrowserRuntime();
    }
    throw error;
  }
}

async function fetchViaBrowserImage(imagePath) {
  const runtime = await getBrowserRuntime();
  let page;

  try {
    page = await runtime.context.newPage();
    const response = await page.goto(`${SOFASCORE_IMAGE_ORIGIN}/api/v1/${imagePath}`, {
      waitUntil: 'load',
      timeout: BROWSER_FETCH_TIMEOUT_MS,
    });

    if (!response) {
      throw new Error(`Browser image navigation returned no response for ${imagePath}`);
    }

    const statusCode = response.status();
    const contentType = response.headers()['content-type'] || 'image/png';

    if (statusCode !== 200) {
      const error = new Error(`Browser image fetch failed for ${imagePath}: ${statusCode}`);
      error.upstreamStatus = statusCode;
      throw error;
    }

    return {
      statusCode,
      contentType,
      buffer: await response.body(),
      source: 'browser',
    };
  } catch (error) {
    if (String(error.message || error).includes('Target page, context or browser has been closed')) {
      await disposeBrowserRuntime();
    }
    throw error;
  } finally {
    if (page && !page.isClosed()) {
      await page.close().catch(() => {});
    }
  }
}

async function fetchDirectJson(cacheKey) {
  const url = `${SOFASCORE_API_ORIGIN}/api/v1/${cacheKey}`;
  const response = await fetch(url, {
    headers: {
      ...SOFASCORE_HEADERS,
      ...(sofaScoreRequestedWith ? { 'x-requested-with': sofaScoreRequestedWith } : {}),
    },
  });
  const contentType = response.headers.get('content-type') || '';

  if (!contentType.includes('application/json')) {
    const text = await response.text();
    throw new Error(`Direct JSON fetch returned non-JSON content (${response.status}) for ${cacheKey}: ${text.slice(0, 120)}`);
  }

  return {
    statusCode: response.status,
    contentType,
    data: await response.json(),
    source: 'direct',
  };
}

async function fetchDirectImage(imagePath) {
  const url = `${SOFASCORE_IMAGE_ORIGIN}/api/v1/${imagePath}`;
  const response = await fetch(url, { headers: SOFASCORE_IMAGE_HEADERS });

  return {
    statusCode: response.status,
    contentType: response.headers.get('content-type') || 'image/png',
    buffer: Buffer.from(await response.arrayBuffer()),
    source: 'direct',
  };
}

async function fetchJsonWithoutGate(cacheKey) {
  if (isBrowserConfigured()) {
    return fetchViaBrowserJson(cacheKey);
  }

  if (DIRECT_FALLBACK_ENABLED) {
    return fetchDirectJson(cacheKey);
  }

  throw new Error('No SofaScore JSON fetch strategy configured');
}

async function fetchJsonFromSofaScore(cacheKey) {
  return jsonUpstreamGate.schedule(() => fetchJsonWithoutGate(cacheKey));
}

async function probeSofaScoreOnce() {
  return jsonUpstreamGate.schedule(async () => {
    const result = await fetchJsonWithoutGate('sport/football/categories');
    return {
      statusCode: result.statusCode,
      contentType: result.contentType,
      source: `${result.source}-probe`,
    };
  });
}

async function fetchImageFromSofaScore(imagePath) {
  let directResult = null;
  let directError = null;

  try {
    directResult = await fetchDirectImage(imagePath);

    if (directResult.statusCode === 200) {
      if (looksLikeImageContentType(directResult.contentType)) {
        return directResult;
      }

      directError = new Error(
        `Direct image fetch returned non-image content for ${imagePath}: ${directResult.contentType}`,
      );
    } else {
      directError = new Error(`Direct image fetch returned ${directResult.statusCode} for ${imagePath}`);
      if (directResult.statusCode === 404) return directResult;
    }
  } catch (error) {
    directError = error;
  }

  if (isBrowserConfigured()) {
    try {
      return await fetchViaBrowserImage(imagePath);
    } catch (browserError) {
      if (directResult && directResult.statusCode !== 200) {
        return directResult;
      }

      throw browserError.upstreamStatus ? browserError : (directError || browserError);
    }
  }

  if (directResult && directResult.statusCode !== 200) {
    return directResult;
  }

  if (directError) {
    throw directError;
  }

  if (DIRECT_FALLBACK_ENABLED) {
    return fetchDirectImage(imagePath);
  }

  throw new Error('No SofaScore image fetch strategy configured');
}

app.get('/api/sofascore-browser/status', async (req, res) => {
  let connected = false;
  let mode = null;
  let connectionError = null;
  try {
    if (isBrowserConfigured()) {
      const runtime = await getBrowserRuntime();
      connected = true;
      mode = runtime.mode;
    }
  } catch (error) {
    connectionError = error.message;
  }

  let probe = null;
  if (req.query.probe === '1') {
    try {
      const result = await withInFlight(
        inFlightJsonRequests,
        'health-probe:categories',
        probeSofaScoreOnce,
      );
      probe = {
        reachable: result.statusCode === 200 && result.contentType.includes('application/json'),
        statusCode: result.statusCode,
        source: result.source,
      };
    } catch (error) {
      probe = {
        reachable: false,
        statusCode: error.upstreamStatus || error.statusCode || null,
        code: error.code || 'probe_failed',
        message: error.message,
      };
    }
  }

  return res.json({
    configured: isBrowserConfigured(),
    connected,
    mode,
    pageUrl: isBrowserConfigured() ? BROWSER_PAGE_URL : null,
    pageStatus: browserPageStatus,
    requestTokenCaptured: sofaScoreRequestTokenCaptured,
    recentApiResponses: recentBrowserApiResponses,
    error: connectionError,
    upstreamCircuit: jsonUpstreamGate.status(),
    imageCircuit: essentialImageUpstreamGate.status(),
    imageCircuits: {
      essential: essentialImageUpstreamGate.status(),
      background: backgroundImageUpstreamGate.status(),
    },
    modelCircuit: await shotPredictionService.getCircuitStatus(),
    probe,
  });
});

const shotDataArchive = createShotDataArchive({
  databasePath: process.env.SHOT_DATA_DB_PATH || path.join(__dirname, '.shot-data', 'shots.sqlite'),
  downloadIntervalMs: Number(process.env.SHOT_DATA_DOWNLOAD_INTERVAL_MS || 5000),
  updateIntervalMs: Number(process.env.SHOT_DATA_UPDATE_INTERVAL_MS || 24 * 60 * 60 * 1000),
});
shotDataArchive.start().catch((error) => {
  console.error(`Archivio tiri non aggiornato: ${error.message}`);
});

const fetchPredictionTarget = async (endpoint) => {
  const result = await withInFlight(
    inFlightJsonRequests,
    `shot-target:${endpoint}`,
    () => fetchJsonFromSofaScore(endpoint),
  );
  if (result.statusCode !== 200) {
    const error = new ShotModelError(`SofaScore ha risposto ${result.statusCode} per ${endpoint}.`);
    error.upstreamStatus = result.statusCode;
    throw error;
  }
  return result.data;
};

const shotPredictionService = createShotPredictionService({
  upstreamMinIntervalMs: MODEL_UPSTREAM_MIN_INTERVAL_MS,
  upstreamCooldownMs: MODEL_UPSTREAM_COOLDOWN_MS,
  fetchSofaScore: fetchPredictionTarget,
  fetchTargetEvent: fetchPredictionTarget,
  shotDataArchive,
});

registerShotPredictionRoutes(app, shotPredictionService);
registerShotDataArchiveRoutes(app, shotDataArchive);

app.get('/api/sofascore/*', async (req, res) => {
  const path = req.params[0];
  const queryString = new URLSearchParams(req.query).toString();
  const cacheKey = `${path}${queryString ? `?${queryString}` : ''}`;

  const cached = getCached(serverCache, cacheKey, CACHE_TTL);
  if (cached) {
    return res.status(cached.statusCode).json(cached.data);
  }

  try {
    const result = await withInFlight(inFlightJsonRequests, cacheKey, () => fetchJsonFromSofaScore(cacheKey));

    if (result.statusCode === 200) {
      setCached(serverCache, cacheKey, {
        data: result.data,
        statusCode: result.statusCode,
        contentType: result.contentType,
      }, 500);
    }

    res.status(result.statusCode).json(result.data);
  } catch (error) {
    console.error(`SofaScore JSON proxy error for ${cacheKey}:`, error.message);
    const statusCode = error.statusCode === 503 ? 503 : 502;
    res.status(statusCode).json({
      error: 'Errore nel recupero dati da SofaScore',
      code: error.code || 'upstream_error',
      message: error.message,
      upstreamStatus: error.upstreamStatus || null,
      blockedUntil: error.blockedUntil || null,
    });
  }
});

app.get('/api/img/*', async (req, res) => {
  const imagePath = req.params[0];

  const cached = getCached(imageCache, imagePath, IMAGE_CACHE_TTL);
  if (cached) {
    res.set('Content-Type', cached.contentType);
    setImageResponseHeaders(res, imagePath, cached.statusCode);
    return res.status(cached.statusCode).send(cached.buffer);
  }

  try {
    const persisted = await persistentAssetCache.get(imagePath);
    if (persisted) {
      setCached(imageCache, imagePath, persisted, 200);
      res.set('Content-Type', persisted.contentType);
      setImageResponseHeaders(res, imagePath, persisted.statusCode);
      return res.status(persisted.statusCode).send(persisted.buffer);
    }

    const result = await withInFlight(
      inFlightImageRequests,
      imagePath,
      () => getImageUpstreamGate(imagePath).schedule(() => fetchImageFromSofaScore(imagePath)),
    );

    if (result.statusCode !== 200 && result.statusCode !== 404) {
      console.error(`SofaScore image proxy returned ${result.statusCode} for ${imagePath}`);
      return res.status(result.statusCode).send('Image proxy error');
    }

    const cacheValue = {
      buffer: result.buffer,
      contentType: result.contentType || 'application/octet-stream',
      statusCode: result.statusCode,
    };
    const policy = getAssetCachePolicy(imagePath, result.statusCode);
    setCached(imageCache, imagePath, cacheValue, 200);
    await persistentAssetCache.set(imagePath, cacheValue, policy.ttlMs);

    res.set('Content-Type', cacheValue.contentType);
    setImageResponseHeaders(res, imagePath, result.statusCode);
    res.status(result.statusCode).send(result.buffer);
  } catch (error) {
    console.error(`SofaScore image proxy error for ${imagePath}:`, error.message);
    res.status(error.statusCode === 503 ? 503 : 502).send('Image proxy error');
  }
});

const PORT = 3001;
app.listen(PORT, () => {
  const browserMode = BROWSER_CDP_URL
    ? 'cdp'
    : PRIMARY_BROWSER_EXECUTABLE_PATH
      ? 'launch'
      : 'direct-fallback-only';

  console.log(`Proxy server running on http://localhost:${PORT}`);
  console.log(`SofaScore proxy mode: ${browserMode}`);
});
