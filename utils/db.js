import Database from 'better-sqlite3';
const db = new Database('storage/sqlite/articles.db');

db.prepare(`
  CREATE TABLE IF NOT EXISTS articles (
    operator TEXT,
    title TEXT,
    href TEXT,
    content TEXT,
    ai_result TEXT,
    date DATE,
    PRIMARY KEY (operator, title, date)
  )
`).run();

const insertOrIgnore = db.prepare(`
  INSERT OR IGNORE INTO articles (operator, title, href, date, content) VALUES (@operator, @title, @href, @date, NULL)
`);

const updateContent = db.prepare(`
  UPDATE articles SET content = @content WHERE title = @title AND operator = @operator AND date = @date
`);

const getUnprocessed = db.prepare(`
  SELECT * FROM articles WHERE content IS NULL OR content = ''
`);

export const getLastArticles = (limit) => {
  const getBiv = db.prepare(`
    SELECT operator, title, date, content, href, ai_result FROM articles 
    WHERE operator = 'biv' 
    ORDER BY date DESC 
    LIMIT ?`).all(limit);

  const getMom = db.prepare(`
    SELECT operator, title, date, content, href, ai_result FROM articles 
    WHERE operator = 'mom' 
    ORDER BY date DESC 
    LIMIT ?`).all(limit);

  return [...getBiv, ...getMom];
};

export const updateAiResult = db.prepare(`
  UPDATE articles 
  SET ai_result = @ai_result 
  WHERE operator = @operator AND title = @title AND date = @date
`);

export default {
  insertOrIgnore,
  updateContent,
  getUnprocessed,
  getLastArticles,
  updateAiResult,
  close: () => db.close()
};
