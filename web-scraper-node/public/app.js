const form = document.getElementById('scrape-form');
const resultsBody = document.getElementById('results-body');
const summary = document.getElementById('summary');
const statusEl = document.getElementById('status');
const submitBtn = document.getElementById('submit');

const formatCurrency = (value) => value ?? '';

const createLinkCell = (url, text) => {
  if (!url) {
    return document.createTextNode('');
  }

  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.target = '_blank';
  anchor.rel = 'noopener noreferrer';
  anchor.textContent = text || 'View';
  return anchor;
};

const renderResults = ({ items = [], pagesScraped = 0 }) => {
  resultsBody.innerHTML = '';

  items.forEach((item) => {
    const row = document.createElement('tr');

    const titleCell = document.createElement('td');
    titleCell.textContent = item.title ?? '';

    const priceCell = document.createElement('td');
    priceCell.textContent = formatCurrency(item.price);

    const stockCell = document.createElement('td');
    stockCell.textContent = item.stock ?? '';

    const ratingCell = document.createElement('td');
    ratingCell.textContent = item.rating ?? '';

    const linkCell = document.createElement('td');
    if (item.link) {
      linkCell.appendChild(createLinkCell(item.link, 'Open'));
    }

    row.append(titleCell, priceCell, stockCell, ratingCell, linkCell);
    resultsBody.appendChild(row);
  });

  summary.textContent = `${items.length} books scraped across ${pagesScraped} page${pagesScraped === 1 ? '' : 's'}.`;
};

const setStatus = (message, isError = false) => {
  statusEl.textContent = message;
  statusEl.classList.toggle('error', isError);
};

const toggleBusy = (isBusy) => {
  submitBtn.disabled = isBusy;
  submitBtn.textContent = isBusy ? 'Running…' : 'Run scrape';
};

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  const formData = new FormData(form);
  const payload = Object.fromEntries(formData.entries());

  toggleBusy(true);
  setStatus('Running scrape…');

  try {
    const response = await fetch('/api/scrape', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Request failed (${response.status})`);
    }

    const result = await response.json();
    renderResults(result);
    setStatus('Scrape completed successfully.');
  } catch (error) {
    console.error('Scrape error:', error);
    setStatus(error.message ?? 'Scrape failed', true);
  } finally {
    toggleBusy(false);
  }
});
