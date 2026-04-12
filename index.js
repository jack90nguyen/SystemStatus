require('dotenv').config();
const express = require('express');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/check-status', async (req, res) => {
  const apiUrlsString = process.env.API_URLS || '';
  const apiNamesString = process.env.API_NAMES || '';
  if (!apiUrlsString) {
    return res.status(500).json({ error: 'API_URLS environment variable is not set.' });
  }

  const urls = apiUrlsString.split(',').map(url => url.trim()).filter(url => url);
  const names = apiNamesString.split(',').map(name => name.trim());

  const checkPromises = urls.map(async (url, index) => {
    const apiName = names[index] || `API-${index + 1}`;
    const startTime = performance.now();
    try {
      // Adding a timeout to prevent hanging forever
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 seconds timeout
      
      const response = await fetch(url, { 
        method: 'GET',
        signal: controller.signal 
      });
      
      clearTimeout(timeoutId);
      
      const endTime = performance.now();
      const timeMs = Math.round(endTime - startTime);

      return {
        name: apiName,
        status: response.status === 200 ? 'ok' : 'error',
        time: `${timeMs}ms`
      };
    } catch (error) {
      const endTime = performance.now();
      const timeMs = Math.round(endTime - startTime);
      return {
        name: apiName,
        status: 'error',
        time: `${timeMs}ms`,
        error: error.message // Optional: for debugging
      };
    }
  });

  try {
    const results = await Promise.all(checkPromises);
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: 'Failed to check statuses' });
  }
});

app.listen(port, () => {
  console.log(`SystemStatus API is running on http://localhost:${port}`);
});
