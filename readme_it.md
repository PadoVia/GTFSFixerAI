# AI Detour Analyzer for updating GTFS data

> 🇬🇧 [English version](readme.md)

**GTFSFixerAI** è uno strumento basato su intelligenza artificiale per l'estrazione automatica delle deviazioni del servizio di trasporto pubblico locale (TPL) da fonti testuali non strutturate. Il sistema supporta l’aggiornamento semiautomatico dei feed GTFS a partire da comunicazioni pubblicate sui siti ufficiali degli operatori.

Correntemente contiene il supporto per i seguenti operatori:
- BusItalia Veneto, Padova (biv)
- Mobilità di Marca, Treviso (mom)

---

## 🚀 Feature

Questa prima fase del progetto si occupa di:

- Scraping delle notizie da fonti ufficiali (ad es. siti MOM e BIVE)
- Parsing automatico del testo tramite un modulo AI (LLM)
  - Estrazione delle **fermate sospese**
  - Estrazione delle **fermate sostitutive** 
  - Estrazione degli **intervalli di tempo** interessati
  - Estrazione delle **linee interessate** 
- Verifica e geolocalizzazione delle fermate tramite **Google Places API**
- Generazione di un output in **JSON standardizzato**, utile per il patching manuale o automatico dei feed GTFS, salvato in un database SQLite assieme ad uno storico di articoli.

## ⚠️Dipendenze e configurazione

**Requisito 1**: Istallare il database **Qdrant**. Si consiglia di eseguirlo come segue:

```bash  
docker pull qdrant/qdrant  
docker run -p 6333:6333 -v $(pwd)/storage/qdrant:/qdrant/storage qdrant/qdrant  
```  

**Requisito 2** Riempire `storage/gtfs/` con il GTFS in formato **JSON**: Ogni operatore deve avere una sua cartella, nel nostro caso `storage/gtfs/mom/` e `storage/gtfs/biv/`. Gli unici file necessari sono `stops.json` e `routes.json`.

**Requisito 3**: Creare un file `.env` nella cartella principale del progetto. Un esempio di file `.env` è disponibile in `utils/exampleEnv`.

### Configurazione `.env`

- `LOGGING_LEVEL` Il logging level è configurabile con due modalità, prod (`0`) e debug (`1`).
- `OPENAI_MODEL` Il modello OpenAI da utilizzare per l'analisi. Si consiglia di utilizzare `gpt-3.5-turbo`.
- `ARTICLE_ANALYSIS_LIMIT` Il numero massimo di articoli da analizzare per volta. Spiegato meglio nella sezione "Esecuzione".
- `[operator]_CENTER_LATITUDE` e `[operator]_CENTER_LONGITUDE` Le coordinate del centro dell'area di interesse per ogni operatore, utilizzate per il bias dato all'API di Google Places. Da configurare per ogni operatore utilizzato.

## ➡ Esecuzione

I vari comandi eseguibili si trovano in `services/`. Prima di fare analisi è necessario popolare gli embedding vettoriali in Qdrant sulla base del GTFS. Per fare ciò è necessario eseguire questi comandi:

```bash
node services/updateLineEmbeddings.js
node services/updateStopEmbeddings.js
```

Il secondo comando potrebbe richiedere un po' di tempo, a seconda delle dimensioni del GTFS. Se è meno di 20 minuti non preoccuparti.

È consigliato rigenerare gli embedding ogni volta che il GTFS viene aggiornato.

Dopo aver popolato gli embedding, si procede con lo scraping delle notizie. Per farlo, eseguire:

```bash
node services/runScraper.js
```

È consigliato collegarlo a un cron job per eseguire lo scraping periodicamente, ad esempio ogni 6 ore.

Il comando per l'analisi è separato, ed è possibile eseguirlo con:

```bash
node services/runAnalysis.js
```

È ragionevole eseguirlo subito dopo lo scraping, ma non necessario. Analizza solo gli articoli che non sono già stati analizzati, quindi può anche essere eseguito ripetutamente.

Si può fissare un limite alla quantità di articoli da analizzare per volta con l'opzione `ARTICLE_ANALYSIS_LIMIT` in `.env` per ridurre costi. Il limite si applica a ogni operatore, quindi definisce un numero di articoli per operatore. Con un limite di 10 e 2 operatori, verranno analizzati al massimo 20 articoli.

## 📤 Output 

Il programma genera un risultato in un database SQLite posizionato in `storage/sqlite/articles.db`. Lo schema è lo seguente:

```sql
    operator TEXT,
    title TEXT,
    href TEXT,
    content TEXT,
    ai_result TEXT,
    date DATE,
    PRIMARY KEY (operator, title, date)
```

`ai_result` è un JSON che contiene le informazioni estratte dall'articolo. Il suo formato è disponibile in `utils/exampleAiResult.json`.

> Attenzione: `ai_result` è nullable e non è riempito se il comando di analisi non viene eseguito.

## ⚙ Come funziona l'analisi AI

**Chiamata 1 a LLM**: Estrazione del titolo, domanda del se è utile l'articolo per dare dati su una deviazione. 

Se la risposta è negativa, il programma restituisce un JSON vuoto simile al seguente:

```json
{
  "title": "Titolo dell'articolo",
  "source_url": "[URL dell'articolo]",
  "timestamp": "2025-07-15T20:03:53.635Z",
  "affected_lines": [],
  "suspended_stops": [],
  "replacement_stops": [],
  "time_intervals": null
}
```

Se la risposta è positiva, procediamo chiedendo più informazioni.

**Chiamata 2 a LLM**: Estrazione delle informazioni principali della deviazione. Questa chiamata produce un risultato di questo tipo:

```json
{
    "affected_lines": ["E073 PADOVA – NOVENTA P. - STRA"],
    "suspended_stops": ["Via Caduti sul Lavoro", "Centro Fitness", "Villaggio Sant’Antonio", "Bar Industria"],
    "replacement_stops": ["Fermata provvisoria in via nona/undicesima strada", "Via Valmarana", "Noventa scuole"],
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

Questa risposta di per sè però non è particolarmente utile, in quanto non contiene riferimenti precisi.

Di conseguenza il JSON "crudo" deve essere arricchito.

Per `time_intervals` esiste la funzione `processDateRanges()` che utilizza la libreria `chrono-node` per convertire una stringa in un time stamp preciso.

Per `affected_lines` si utilizza la funzione `queryLine()`. Questa funzione ha due modi di collegare la descrizione della linea con la linea effettiva nel GTFS:

1. Ricerca per paragono diretto di stringhe, fatta con `fuze.js`.
2. Ricerca tramite un LLM, collegato con RAG a un database vettoriale contenuto in Qdrant chiamato `gtfs-lines-[operatore]`.

Il secondo modo è chiamato solo se il primo fallisce di trovare un risultato.

Per `suspended_stops` e `replacement_stops` si utilizza la funzione `queryStop()`. In questo caso, la ricerca avviene in tre modi:

1. Ricerca per paragono diretto di stringhe, fatta con `fuze.js`.
2. Ricerca tramite paragono direttore di embedding vettoriali, fatta con `vectorQueryEngine` di `LlamaIndex`. Gli embedding vettoriali sono salvati in `gtfs-stops-[operatore]`.
3. Ricerca attraverso il Place API di Google Maps, che può identificare solo coordinate geografiche ma chiaramente non fermate. Questo è per quando si invetano una fermata che non esiste nel GTFS.

Il risultato di tutte queste ricerche viene combinato e restituito come un JSON arricchito, vedere output di esempio.

## 📃 Struttura del progetto

- `analyzers/` Contiene i moduli per l'analisi AI
- `scrapers/` Contiene i moduli per lo scraping delle notizie
- `services/` Contiene i comandi eseguibili
- `utils/` Contiene le funzioni di utilità
- `storage/` Contiene i dati salvati, quindi il GTFS, Qdrant, e SQLite.

## Come aggiungere un nuovo operatore

1. Aggiungi un file di scraping in `scrapers/`.
2. Aggiungi il tuo scraper al comando `services/runScraper.js`.
3. Aggiungi le coordinate del centro dell'area di interesse nel file `.env`.
4. Aggiungi il GTFS dell'operatore in `storage/gtfs/[operatore]/`.

> Dopo aver aggiunto il GTFS non dimenticarti di rigenerare gli embedding con i servizi `updateLineEmbeddings.js` e `updateStopEmbeddings.js`.
