import Database from 'better-sqlite3';
const db = new Database('articoli.db');

db.prepare(`
  CREATE TABLE IF NOT EXISTS articoli (
    operator TEXT,
    title TEXT,
    href TEXT,
    content TEXT,
    ai_result TEXT,
    data DATE,
    PRIMARY KEY (operator, title)
  )
`).run();

const insertOrIgnore = db.prepare(`
  INSERT OR IGNORE INTO articoli (operator, title, href, data, content) VALUES (@operator, @title, @href, @data, NULL)
`);

const updateContent = db.prepare(`
  UPDATE articoli SET content = @content WHERE title = @title AND operator = @operator
`);

const getUnprocessed = db.prepare(`
  SELECT * FROM articoli WHERE content IS NULL OR content = ''
`);

export default {
  insertOrIgnore,
  updateContent,
  getUnprocessed,
  close: () => db.close()
};