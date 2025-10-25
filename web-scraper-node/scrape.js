import fs from 'fs';
import puppeteer from 'puppeteer';
import { fileURLToPath } from 'url';

const DEFAULT_URL_TEMPLATE = 'https://books.toscrape.com/catalogue/page-{{page}}.html';

export const scrapeBooks = async ({
  urlTemplate = DEFAULT_URL_TEMPLATE,
  startPage = 1,
  totalPages = 10,
  onPageScraped,
} = {}) => {
  const resolvedTotalPages = Number.isFinite(totalPages) && totalPages > 0 ? Math.floor(totalPages) : 1;
  const start = Number.isFinite(startPage) ? Math.max(1, Math.floor(startPage)) : 1;
  const templateHasPlaceholder = urlTemplate.includes('{{page}}');
  const iterations = templateHasPlaceholder ? resolvedTotalPages : 1;

  const browser = await puppeteer.launch();
  const allBooks = [];

  try {
    const page = await browser.newPage();

    for (let offset = 0; offset < iterations; offset += 1) {
      const pageNumber = start + offset;
      const targetUrl = templateHasPlaceholder
        ? urlTemplate.replace('{{page}}', pageNumber)
        : urlTemplate;

      await page.goto(targetUrl, { waitUntil: 'networkidle2' });

      const books = await page.evaluate(() => {
        const bookElements = document.querySelectorAll('.product_pod');

        return Array.from(bookElements).map((book) => {
          const titleElement = book.querySelector('h3 a');
          const priceElement = book.querySelector('.price_color');
          const stockElement = book.querySelector('.instock.availability');
          const ratingElement = book.querySelector('.star-rating');

          const title = titleElement?.getAttribute('title')?.trim() ?? '';
          const price = priceElement?.textContent?.trim() ?? '';
          const stock = stockElement ? 'In Stock' : 'Out Of Stock';
          const rating = ratingElement?.className?.split(' ')?.[1] ?? '';
          const href = titleElement?.getAttribute('href') ?? '';
          const link = href ? new URL(href, document.baseURI).href : '';

          return {
            title,
            price,
            stock,
            rating,
            link,
          };
        });
      });

      allBooks.push(...books);

      if (typeof onPageScraped === 'function') {
        onPageScraped({ pageNumber, books });
      }
    }

    return {
      items: allBooks,
      pagesScraped: iterations,
    };
  } finally {
    await browser.close();
  }
};

const __filename = fileURLToPath(import.meta.url);

if (process.argv[1] === __filename) {
  const outputFile = 'books.json';

  (async () => {
    const result = await scrapeBooks({
      urlTemplate: DEFAULT_URL_TEMPLATE,
      startPage: 1,
      totalPages: 10,
      onPageScraped: ({ pageNumber, books }) => {
        console.log(`Books on page ${pageNumber}:`, books);
      },
    });

    fs.writeFileSync(outputFile, JSON.stringify(result.items, null, 2));
    console.log(`Data saved to ${outputFile}`);
  })().catch((error) => {
    console.error('Scrape failed:', error);
    process.exitCode = 1;
  });
}
