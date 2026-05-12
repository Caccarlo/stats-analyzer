const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const app = express();
app.use(cors());

const SOFASCORE_WEB_ORIGIN = 'https://www.sofascore.com';
const SOFASCORE_IMAGE_ORIGIN = 'https://img.sofascore.com';
const CACHE_TTL = 5 * 60 * 1000;
const IMAGE_CACHE_TTL = 30 * 60 * 1000;
const BROWSER_FETCH_TIMEOUT_MS = Number(process.env.SOFASCORE_BROWSER_FETCH_TIMEOUT_MS || 20000);
const BROWSER_PAGE_URL = process.env.SOFASCORE_BROWSER_PAGE_URL || `${SOFASCORE_WEB_ORIGIN}/`;
const BROWSER_CDP_URL = process.env.SOFASCORE_BROWSER_CDP_URL || '';
const BROWSER_EXECUTABLE_PATH = process.env.SOFASCORE_BROWSER_EXECUTABLE_PATH || '';
const BROWSER_USER_DATA_DIR = process.env.SOFASCORE_BROWSER_USER_DATA_DIR
  || path.join(__dirname, '.sofascore-browser-profile');
const BROWSER_HEADLESS = process.env.SOFASCORE_BROWSER_HEADLESS !== 'false';
const DIRECT_FALLBACK_ENABLED = process.env.SOFASCORE_DIRECT_FALLBACK !== 'false';

const serverCache = new Map();
const imageCache = new Map();
const inFlightJsonRequests = new Map();
const inFlightImageRequests = new Map();

let browserRuntime = null;
let browserRuntimePromise = null;

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

  page.on('crash', () => {
    console.error('SofaScore relay page crashed');
  });

  await page.goto(BROWSER_PAGE_URL, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });

  return page;
}

async function fetchViaBrowserJson(cacheKey) {
  const runtime = await getBrowserRuntime();
  let page;

  try {
    page = await createFetchPage(runtime);

    const result = await page.evaluate(
      async ({ requestPath, timeoutMs }) => {
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);

        try {
          const response = await fetch(`/api/v1/${requestPath}`, {
            headers: { Accept: 'application/json' },
            credentials: 'include',
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
      { requestPath: cacheKey, timeoutMs: BROWSER_FETCH_TIMEOUT_MS },
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
  } finally {
    if (page && !page.isClosed()) {
      await page.close().catch(() => {});
    }
  }
}

async function fetchViaBrowserImage(imagePath) {
  const runtime = await getBrowserRuntime();
  let page;

  try {
    page = await createFetchPage(runtime);
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
      throw new Error(`Browser image fetch failed for ${imagePath}: ${statusCode}`);
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
  const url = `${SOFASCORE_WEB_ORIGIN}/api/v1/${cacheKey}`;
  const response = await fetch(url, { headers: SOFASCORE_HEADERS });
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

async function fetchJsonFromSofaScore(cacheKey) {
  if (isBrowserConfigured()) {
    return fetchViaBrowserJson(cacheKey);
  }

  if (DIRECT_FALLBACK_ENABLED) {
    return fetchDirectJson(cacheKey);
  }

  throw new Error('No SofaScore JSON fetch strategy configured');
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

      throw directError || browserError;
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

app.get('/api/sofascore-browser/status', async (_req, res) => {
  if (!isBrowserConfigured()) {
    return res.json({
      configured: false,
      connected: false,
      mode: null,
      pageUrl: null,
    });
  }

  try {
    const runtime = await getBrowserRuntime();
    return res.json({
      configured: true,
      connected: true,
      mode: runtime.mode,
      pageUrl: BROWSER_PAGE_URL,
    });
  } catch (error) {
    return res.status(503).json({
      configured: true,
      connected: false,
      error: error.message,
    });
  }
});

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
    res.status(502).json({ error: 'Errore nel recupero dati da SofaScore' });
  }
});

app.get('/api/img/*', async (req, res) => {
  const imagePath = req.params[0];

  const cached = getCached(imageCache, imagePath, IMAGE_CACHE_TTL);
  if (cached) {
    res.set('Content-Type', cached.contentType);
    res.set('Cache-Control', 'public, max-age=86400');
    return res.send(cached.buffer);
  }

  try {
    const result = await withInFlight(inFlightImageRequests, imagePath, () => fetchImageFromSofaScore(imagePath));

    if (result.statusCode !== 200) {
      console.error(`SofaScore image proxy returned ${result.statusCode} for ${imagePath}`);
      return res.status(result.statusCode).send('Image proxy error');
    }

    setCached(imageCache, imagePath, {
      buffer: result.buffer,
      contentType: result.contentType,
      statusCode: result.statusCode,
    }, 200);

    res.set('Content-Type', result.contentType);
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(result.buffer);
  } catch (error) {
    console.error(`SofaScore image proxy error for ${imagePath}:`, error.message);
    res.status(502).send('Image proxy error');
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
