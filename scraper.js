import puppeteer from 'puppeteer';
import db from './db.js';
import biv from './scrapers/biv.js';
import mom from './scrapers/mom.js';
import pLimit from 'p-limit';

(async () => {
  const scrapers = new Map([
    [biv.name, biv],
    [mom.name, mom]
  ]);

  const browser = await puppeteer.launch({ headless: false });

  for (const scraper of scrapers.values()) {
    console.log(`Eseguo scraper: ${scraper.name}`);
    await scraper.scrapeLinks(browser);
  }


  const rowsToProcess = db.getUnprocessed.all();
  const limit = pLimit(5); // massimo 5 scraping in parallelo

  await Promise.all(
    rowsToProcess.map(row => {
      const scraper = scrapers.get(row.operator);

      if (!scraper || typeof scraper.scrapeContent !== 'function') {
        console.warn(`⚠️ Nessuno scraper valido per ${row.operator}`);
        return;
      }

      return limit(() =>
        scraper.scrapeContent(browser, row.href, row.title).catch(err =>
          console.error(`Errore con ${row.title}:`, err)
        )
      );
    })
  );

  await browser.close();
})();
