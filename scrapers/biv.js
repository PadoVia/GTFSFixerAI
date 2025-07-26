import db from "../utils/db.js";

const name = 'biv';

const scrapeLinks = async (browser) => {
  const page = await browser.newPage();

  await page.goto('https://www.fsbusitalia.it/it/veneto/news-veneto.html', {waitUntil: 'load'});

  let allItems = [];
  let hasNextPage = true;

  while (hasNextPage) {
    // Estrai testo e link dai titoli
    const items = await page.evaluate(() => {
      const blocks = Array.from(document.querySelectorAll('.tabular-data-view--snapshot'));

      return blocks.map(block => {
        const data = block.querySelector('.tabular-data-view--snapshot--date')?.textContent?.trim() ?? '';
        const titolo = block.querySelector('.tabular-data-view--snapshot--title')?.textContent?.trim() ?? '';
        const href = block.querySelector('.tabular-data-view--snapshot--title')?.href ?? '';

        return { data, titolo, href };
      });
    });

    for (const item of items) {
      db.insertOrIgnore.run({
        operator: name,
        title: item.titolo,
        href: item.href,
        date: item.data //todo: uniformare gestione delle date con traduzione mesi
      });
    }

    allItems.push(...items);

    console.log(`✅ BIV: Collected ${allItems.length} elements`);

    // Controlla se c'è il pulsante "Next" visibile
    hasNextPage = await page.evaluate(() => {
      const btn = document.querySelector('.pagination--next-btn');
      if (!btn) return false;
      const style = window.getComputedStyle(btn);
      return style.visibility !== 'hidden';
    });

    if (hasNextPage) {
      const firstHrefBefore = items[0]?.href || '';

      await page.click('.pagination--next-btn');

      // Aspetta che il primo href cambi, segno che la pagina è aggiornata
      const changed = await page.waitForFunction(
          oldHref => {
            const firstEl = document.querySelector('a.tabular-data-view--snapshot--title');
            return firstEl && firstEl.href !== oldHref;
          },
          {timeout: 2000},
          firstHrefBefore
      ).catch(() => false);

      if (!changed) {
        console.log('✅ Content did not change after click, stopping pagination.');
        break;
      }
    }
  }
}

const scrapeContent = async (browser, href, title) => {
  const page = await browser.newPage();

  await page.goto(href, { waitUntil: 'load' });

    // Estraggo il contenuto del div.article--text
    const articleContent = await page.evaluate(() => {
      const divs = Array.from(document.querySelectorAll('div.article--text'));
      return divs.map(div => div.innerText.trim()).join('\n\n');
    });

    console.log(`✅ BIV: Collected content for ${title}: ${articleContent.length} characters`);

    db.updateContent.run({
      operator: name,
      title: title,
      content: articleContent
    });

    page.close()
}

export default {
  name,
  scrapeLinks,
  scrapeContent
}
