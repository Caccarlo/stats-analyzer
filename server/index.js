const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());

// Server-side cache to reduce duplicate requests to Sofascore
const serverCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getCached(key) {
  const entry = serverCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL) {
    serverCache.delete(key);
    return null;
  }
  return entry;
}

function setCache(key, data, statusCode, contentType) {
  serverCache.set(key, { data, statusCode, contentType, timestamp: Date.now() });
  // Limit cache size to prevent memory leaks
  if (serverCache.size > 500) {
    const oldest = serverCache.keys().next().value;
    serverCache.delete(oldest);
  }
}

const SOFASCORE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'it-IT,it;q=0.9,en;q=0.8',
  'Referer': 'https://www.sofascore.com/',
  'Origin': 'https://www.sofascore.com',
  'Cache-Control': 'no-cache'
};

// Proxy API requests to SofaScore
app.get('/api/sofascore/*', async (req, res) => {
  const path = req.params[0];
  const queryString = new URLSearchParams(req.query).toString();
  const cacheKey = `${path}${queryString ? '?' + queryString : ''}`;
  const url = `https://www.sofascore.com/api/v1/${cacheKey}`;

  // Check server cache first
  const cached = getCached(cacheKey);
  if (cached) {
    return res.status(cached.statusCode).json(cached.data);
  }

  try {
    const response = await fetch(url, { headers: SOFASCORE_HEADERS });
    const contentType = response.headers.get('content-type') || '';

    if (!contentType.includes('application/json')) {
      const text = await response.text();
      console.error('Non-JSON response from SofaScore:', url, response.status, text.slice(0, 200));
      return res.status(response.status).json({ error: 'Non-JSON response from SofaScore', status: response.status });
    }

    const data = await response.json();

    // Cache only successful responses
    if (response.status === 200) {
      setCache(cacheKey, data, response.status, contentType);
    }

    res.status(response.status).json(data);
  } catch (error) {
    console.error('Proxy error:', url, error.message);
    res.status(502).json({ error: 'Errore nel recupero dati da SofaScore' });
  }
});

// Proxy images from SofaScore
const imageCache = new Map();
const IMAGE_CACHE_TTL = 30 * 60 * 1000; // 30 minutes (images change rarely)

app.get('/api/img/*', async (req, res) => {
  const path = req.params[0];
  const url = `https://api.sofascore.app/api/v1/${path}`;

  // Check image cache
  const cached = imageCache.get(path);
  if (cached && Date.now() - cached.timestamp < IMAGE_CACHE_TTL) {
    res.set('Content-Type', cached.contentType);
    res.set('Cache-Control', 'public, max-age=86400');
    return res.send(cached.buffer);
  }

  try {
    const response = await fetch(url, { headers: SOFASCORE_HEADERS });
    const buffer = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get('content-type') || 'image/png';

    // Cache the image
    imageCache.set(path, { buffer, contentType, timestamp: Date.now() });
    if (imageCache.size > 200) {
      const oldest = imageCache.keys().next().value;
      imageCache.delete(oldest);
    }

    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(buffer);
  } catch (error) {
    console.error('Image proxy error:', url, error.message);
    res.status(502).send('Image proxy error');
  }
});

const PORT = 3001;
app.listen(PORT, () => console.log(`Proxy server running on http://localhost:${PORT}`));
