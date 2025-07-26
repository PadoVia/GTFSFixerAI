import db from "../utils/db.js";

const name = 'mom';

const scrapeLinks = async (browser) => {
  const page = await browser.newPage();

  await page.goto('https://mobilitadimarca.it/info-mobilita', {waitUntil: 'load'});

  const results = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('.col-sm-12'));

    const archivioH2 = all.find(div =>
        div.querySelector('h2')?.textContent?.toUpperCase().includes('ARCHIVIO')
    );

    const before = [];
    const after = [];

    let found = false;

    for (const el of all) {
      if (el === archivioH2) {
        found = true;
        continue;
      }
      if (!found) before.push(el);
      else after.push(el);
    }

    function extractNews(elements) {
      return elements.map(el => {
        const datanews = el.querySelector('.datanews')?.textContent?.trim() ?? '';
        const titolo = el.querySelector('h4')?.textContent?.replace(/\s+/g, ' ').replace(/Maggiori dettagli/gi, '').trim()
        const testo = Array.from(el.querySelectorAll('p, h6, span, li'))
            .map(p => p.textContent?.trim() ?? '')
            .filter(Boolean)
            .join('\n');
        return { datanews, titolo, testo };
      }).filter(n => n.datanews && n.titolo);
    }

    return {
      recenti: extractNews(before),
      archivio: extractNews(after)
    };
  });

  console.log(`✅ MOM: Collected ${Object.values(results).reduce((acc, arr) => acc + arr.length, 0)} elements`);

  for (const tipo in results) {
    for (const item of results[tipo]) {
      db.insertOrIgnore.run({
        operator: name,
        title: item.titolo,
        href: item.href ?? 'https://mobilitadimarca.it/info-mobilita',
        date: item.datanews ?? '', //todo: uniformare gestione delle date con traduzione mesi
      });

      db.updateContent.run({
        content: item.testo ?? '',
        title: item.titolo,
        operator: name,
      });
    }
  }

  console.log('✅ MOM: Completed');

}

const scrapeContent = async (browser, href) => {
  // MOM usa una sola pagina: i contenuti vengono presi direttamente dalla prima funzione
}

export default {
  name,
  scrapeLinks,
  scrapeContent
}
