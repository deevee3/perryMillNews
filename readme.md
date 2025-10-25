# Web Scrapers

This is the code from my web scraping guide on youtube. It includes two scrapers. One with Node.js and Puppeteer and one with Python and Beautiful Soup.

We scrape the website https://books.toscrape.com/ but you can change the code to scrape something else.

## Node.js & Puppeteer Usage

Install dependencies

```bash
cd web-scraper-node
npm install
```

### Run the headless scraper from the CLI

```bash
node scrape
```

### Run the web UI server

```bash
npm run dev
```

This starts an Express server on [http://localhost:4100](http://localhost:4100) by default (override with `PORT`/`HOST`). The UI (served from `/public`) lets you change the URL template, starting page, and page count before launching a scrape. Results render in the browser once the job finishes.

## Python & BS4 Usage (Perry Mill News UI)

Install dependencies

```bash
cd web-scraper-python
pip install -r requirements.txt
```

Create a `.env` file to enable the built-in AI narrative (optional but recommended):

```env
OPENAI_API_KEY=sk-...
```

Run the Flask server (legacy local dev)

```bash
python app.py
```

Open [http://127.0.0.1:5100](http://127.0.0.1:5100) to use Perry Mill locally.

## Cloudflare Worker Deployment (Perry Mill)

### Structure

- `web-scraper-python/static/` — static UI bundle (served by Cloudflare Pages)
- `cloudflare-worker/` — Cloudflare Worker that mirrors the Flask API (`/api/config`, `/api/feed`, `/api/analyze`)

### Prerequisites

- Cloudflare account with Workers + Pages access
- `npm` (Node 18+) installed locally
- Wrangler CLI (`npm install -g wrangler`) or use `npx`
- OpenAI API key (only required if AI summaries are enabled)

### Configure the Worker

```bash
cd cloudflare-worker
npm install
```

Copy `.dev.vars.example` to `.dev.vars` (create the file) and set:

```
OPENAI_API_KEY=sk-...
```

For production, store the secret with Wrangler:

```bash
npx wrangler secret put OPENAI_API_KEY
```

### Local Development

```bash
cd cloudflare-worker
npx wrangler dev
```

This serves the Worker locally. In another terminal, serve the static files (for example):

```bash
cd web-scraper-python/static
python -m http.server 5173
```

Before opening the UI, edit `static/config.js` and set `apiBaseUrl` to the Wrangler dev URL (e.g., `"http://127.0.0.1:8787"`).

### Deploy the Worker

```bash
cd cloudflare-worker
npx wrangler deploy
```

Wrangler outputs the public Worker URL (e.g., `https://perrymill-worker.your-id.workers.dev`).

### Deploy the Static UI (Cloudflare Pages)

1. Create a Pages project in the Cloudflare dashboard.
2. Point it at `web-scraper-python/static` (Git or direct upload).
3. Add a build command if needed (`npm run build` not required here; use “Direct Upload”).
4. After the site is live, edit `static/config.js` in the deployed build (or configure at build time) so `apiBaseUrl` equals your Worker URL.

### Pattern & Technology Inventory

- **Frontend:** Vanilla HTML/CSS/JS, modular Reader + modal components, localStorage persistence for libraries.
- **Worker API:** JavaScript (ES modules), `fast-xml-parser` for RSS, fetch-based integration with OpenAI chat completions.
- **Styling:** Modern CSS (flex, grid, clamp, accent typography).
- **State management:** Local state in `static/app.js`, progressive enhancement for overlays.

### Post-deploy Checklist

1. Set `OPENAI_API_KEY` secret in production Worker.
2. Update `config.js` in the static site with the Worker URL.
3. Verify `/api/feed` and `/api/analyze` calls succeed from the hosted UI.
4. Confirm saved/recommended lists persist via browser localStorage.
5. Disable or remove the legacy Flask server if no longer required.
