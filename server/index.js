const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());

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
  const url = `https://www.sofascore.com/api/v1/${path}${queryString ? '?' + queryString : ''}`;

  try {
    const response = await fetch(url, { headers: SOFASCORE_HEADERS });
    const contentType = response.headers.get('content-type') || '';

    if (!contentType.includes('application/json')) {
      const text = await response.text();
      console.error('Non-JSON response from SofaScore:', url, response.status, text.slice(0, 200));
      return res.status(response.status).json({ error: 'Non-JSON response from SofaScore', status: response.status });
    }

    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    console.error('Proxy error:', url, error.message);
    res.status(502).json({ error: 'Errore nel recupero dati da SofaScore' });
  }
});

// Proxy images from SofaScore
app.get('/api/img/*', async (req, res) => {
  const path = req.params[0];
  const url = `https://api.sofascore.app/api/v1/${path}`;

  try {
    const response = await fetch(url, { headers: SOFASCORE_HEADERS });
    const buffer = await response.arrayBuffer();
    const contentType = response.headers.get('content-type') || 'image/png';
    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(Buffer.from(buffer));
  } catch (error) {
    console.error('Image proxy error:', url, error.message);
    res.status(502).send('Image proxy error');
  }
});

const PORT = 3001;
app.listen(PORT, () => console.log(`Proxy server running on http://localhost:${PORT}`));
