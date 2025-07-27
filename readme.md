# Analizzatore AI di deviazioni per GTFS

> 🇮🇹 [Versione in italiano](readme_it.md)

**GTFSFixerAI** is an AI-powered tool for the automatic extraction of public transport service detours from unstructured textual sources. The system supports the semi-automatic updating of GTFS feeds based on communications published on official operator websites.

Currently, it supports the following operators:
- BusItalia Veneto, Padua (biv)
- Mobilità di Marca, Treviso (mom)

---  

## 🚀 Features

This first phase of the project focuses on:

- Scraping news from official sources (e.g., MOM and BIVE websites)
- Automatic text parsing via an AI module (LLM)
    - Extraction of **suspended stops**
    - Extraction of **replacement stops**
    - Extraction of **affected time intervals**
    - Extraction of **affected lines**
- Verification and geolocation of stops using the **Google Places API**
- Generation of a standardized **JSON output**, useful for manual or automatic patching of GTFS feeds, saved in an SQLite database along with a history of articles.

## ⚠️ Dependencies and Configuration

**Requirement 1**: Install the **Qdrant** database. It is recommended to run it as follows:

```bash  
docker pull qdrant/qdrant 
docker run -p 6333:6333 -v $(pwd)/storage/qdrant:/qdrant/storage qdrant/qdrant  
```  

**Requirement 2**: Fill `storage/gtfs/` with the GTFS in **JSON** format: Each operator must have its own folder, in our case `storage/gtfs/mom/` and `storage/gtfs/biv/`. The only required files are `stops.json` and `routes.json`.

**Requirement 3**: Create a `.env` file in the project's root folder. An example `.env` file is available in `utils/exampleEnv`.

### `.env` Configuration

- `LOGGING_LEVEL` The logging level can be configured in two modes: production (`0`) and debug (`1`).
- `OPENAI_MODEL` The OpenAI model to use for analysis. It is recommended to use `gpt-3.5-turbo`.
- `ARTICLE_ANALYSIS_LIMIT` The maximum number of articles to analyze at once. Explained in more detail in the "Execution" section.
- `[operator]_CENTER_LATITUDE` and `[operator]_CENTER_LONGITUDE` The coordinates of the center of the area of interest for each operator, used for bias in the Google Places API. Must be configured for each operator used.

## ➡ Execution

The executable commands are located in `services/`. Before performing analysis, it is necessary to populate the vector embeddings in Qdrant based on the GTFS. To do this, run the following commands:

```bash  
node services/updateLineEmbeddings.js  
node services/updateStopEmbeddings.js  
```  

The second command may take some time, depending on the size of the GTFS. If it takes less than 20 minutes, don’t worry.

It is recommended to regenerate the embeddings every time the GTFS is updated.

After populating the embeddings, proceed with scraping the news. To do so, run:

```bash  
node services/runScraper.js  
```  

It is recommended to set this up as a cron job to run scraping periodically, for example every 6 hours.

The analysis command is separate and can be executed with:

```bash  
node services/runAnalysis.js  
```  

It is reasonable to run it immediately after scraping, but not necessary. It only analyzes articles that have not yet been analyzed, so it can also be run repeatedly.

You can set a limit on the number of articles to analyze at once using the `ARTICLE_ANALYSIS_LIMIT` option in `.env` to reduce costs. The limit applies per operator, so it defines a number of articles per operator. With a limit of 10 and 2 operators, a maximum of 20 articles will be analyzed.

## 📤 Output

The program generates results in an SQLite database located at `storage/sqlite/articles.db`. The schema is as follows:

```sql  
    operator TEXT,  
    title TEXT,  
    href TEXT,  
    content TEXT,  
    ai_result TEXT,  
    date DATE,  
    PRIMARY KEY (operator, title, date)  
```  

`ai_result` is a JSON containing the information extracted from the article. Its format is available in `utils/exampleAiResult.json`.

> Note: `ai_result` is nullable and will not be filled if the analysis command is not executed.

## ⚙ How the AI Analysis Works

**First LLM Call**: Extraction of the title and determination of whether the article is useful for providing data on a detour.

If the answer is negative, the program returns an empty JSON similar to the following:

```json  
{  
  "title": "Article title",  
  "source_url": "[Article URL]",  
  "timestamp": "2025-07-15T20:03:53.635Z",  
  "affected_lines": [],  
  "suspended_stops": [],  
  "replacement_stops": [],  
  "time_intervals": null  
}  
```  

If the answer is positive, we proceed by requesting more information.

**Second LLM Call**: Extraction of key detour details. This call produces a result like this:

```json  
{  
    "affected_lines": ["E073 PADOVA – NOVENTA P. - STRA"],  
    "suspended_stops": ["Via Caduti sul Lavoro", "Centro Fitness", "Villaggio Sant’Antonio", "Bar Industria"],  
    "replacement_stops": ["Temporary stop at via nona/undicesima strada", "Via Valmarana", "Noventa scuole"],  
    "time_intervals": [  
        {  
            "start": "2025-07-10 09:30:00",  
            "end": "2025-07-10 23:59:59"  
        },  
        {  
            "start": "2025-07-11 17:00:00",  
            "end": "2025-07-11 23:59:59"  
        },  
        {  
            "start": "2025-07-12 17:00:00",  
            "end": "2025-07-12 23:59:59"  
        }  
    ]  
}  
```  

However, this raw response is not particularly useful as it lacks precise references.

Therefore, the "raw" JSON must be enriched.

For `time_intervals`, the `processDateRanges()` function uses the `chrono-node` library to convert a string into a precise timestamp.

For `affected_lines`, the `queryLine()` function is used. This function has two ways to match the line description with the actual line in the GTFS:

1. Direct string matching search, done with `fuse.js`.
2. Search via an LLM, linked with RAG to a vector database stored in Qdrant called `gtfs-lines-[operator]`.

The second method is only called if the first fails to find a result.

For `suspended_stops` and `replacement_stops`, the `queryStop()` function is used. In this case, the search happens in three ways:

1. Direct string matching search, done with `fuse.js`.
2. Direct vector embedding matching search, done with `vectorQueryEngine` from `LlamaIndex`. The vector embeddings are stored in `gtfs-stops-[operator]`.
3. Search via the Google Maps Places API, which can only identify geographic coordinates but not stops. This is for cases where a stop is invented that does not exist in the GTFS.

The results of all these searches are combined and returned as an enriched JSON (see example output).

## 📃 Project Structure

- `analyzers/` Contains AI analysis modules
- `scrapers/` Contains news scraping modules
- `services/` Contains executable commands
- `utils/` Contains utility functions
- `storage/` Contains saved data, including GTFS, Qdrant, and SQLite.

## How to Add a New Operator

1. Add a scraping file in `scrapers/`.
2. Add your scraper to the `services/runScraper.js` command.
3. Add the coordinates of the area of interest center in the `.env` file.
4. Add the operator's GTFS in `storage/gtfs/[operator]/`.

> After adding the GTFS, don’t forget to regenerate the embeddings using the `updateLineEmbeddings.js` and `updateStopEmbeddings.js` services.
