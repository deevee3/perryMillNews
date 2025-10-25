import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

import { scrapeBooks } from '../scrape.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const parsedPort = Number.parseInt(process.env.PORT ?? '', 10);
const PORT = Number.isFinite(parsedPort) ? parsedPort : 4100;

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

app.post('/api/scrape', async (req, res) => {
  const {
    urlTemplate,
    startPage,
    totalPages,
  } = req.body ?? {};

  const sanitizedTemplate = typeof urlTemplate === 'string' && urlTemplate.trim().length > 0
    ? urlTemplate.trim()
    : undefined;
  const parsedStart = Number.parseInt(startPage, 10);
  const parsedTotal = Number.parseInt(totalPages, 10);

  const normalizedStart = Number.isFinite(parsedStart) && parsedStart > 0 ? parsedStart : undefined;
  const normalizedTotal = Number.isFinite(parsedTotal) && parsedTotal > 0 ? Math.min(parsedTotal, 50) : undefined;

  try {
    const result = await scrapeBooks({
      urlTemplate: sanitizedTemplate,
      startPage: normalizedStart,
      totalPages: normalizedTotal,
    });

    res.json(result);
  } catch (error) {
    console.error('Scrape request failed:', error);
    res.status(500).json({
      error: 'Scrape failed',
      details: error?.message ?? 'Unknown error',
    });
  }
});

app.listen(PORT, () => {
  const host = process.env.HOST ?? 'localhost';
  console.log(`Server listening on http://${host}:${PORT}`);
});
