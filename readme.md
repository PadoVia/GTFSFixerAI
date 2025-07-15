# GTFSFixerAI

**GTFSFixerAI** è uno strumento basato su intelligenza artificiale per l'estrazione automatica delle deviazioni del servizio di trasporto pubblico locale (TPL) da fonti testuali non strutturate. Il sistema supporta l’aggiornamento semiautomatico dei feed GTFS a partire da comunicazioni pubblicate sui siti ufficiali degli operatori.

---

## 🚀 Obiettivo (Fase 1)

Questa prima fase del progetto si occupa di:

- Scraping delle notizie da fonti ufficiali (ad es. siti MOM e BIVE)
- Parsing automatico del testo tramite un modulo AI (LLM)
  - Estrazione delle **fermate sospese**
  - Estrazione delle **fermate sostitutive**
- Verifica e geolocalizzazione delle fermate tramite **Google Maps API**
- Generazione di un output in **JSON standardizzato**, utile per il patching manuale o automatico dei feed GTFS

---

## 📥 Input

- URL e contenuto delle news pubblicate dagli operatori TPL
- Testo HTML (estratto tramite scraping)
- API Key per Google Maps (fornita dall'utente)

---

## 📤 Output (esempio)

```json
{
  "title": "FOLPO SUMMER FESTIVAL 2025",
  "source_url": "https://www.fsbusitalia.it/it/veneto/news-veneto/2025/7/10/-folpo-summer-festival-2025--a-noventa-padovana--pd--autolinea--.html",
  "timestamp": "2025-07-15T19:40:10.986Z",
  "affected_lines": [
    {
      "route_short_name": "E073",
      "route_id": "196",
      "route_long_name": "STRA-NOVENTA PADOVANA-PADOVA"
    }
  ],
  "suspended_stops": [
    {
      "stop_id": "6798",
      "stop_code": "6737",
      "stop_desc": "V. CADUTI SUL LAVORO",
      "lat": "45.4123077392578",
      "long": "11.9481954574585"
    },
    {
      "stop_id": "6103",
      "stop_code": "6027",
      "stop_desc": "NOVENTA P. CENTRO FITNESS",
      "lat": "45.4117622375488",
      "long": "11.9438724517822"
    },
    {
      "stop_id": null,
      "stop_code": null,
      "stop_desc": "Villaggio Sant’Antonio",
      "lat": 45.4097359,
      "long": 11.9420088
    },
    {
      "stop_id": "9929",
      "stop_code": "9922",
      "stop_desc": "Industria 66",
      "lat": "45.4108009338379",
      "long": "11.9288196563721"
    }
  ],
  "replacement_stops": [
    {
      "stop_id": null,
      "stop_code": null,
      "stop_desc": "Fermata provvisoria in via nona/undicesima strada",
      "lat": 45.41081,
      "long": 11.93114
    },
    {
      "stop_id": null,
      "stop_code": null,
      "stop_desc": "Via Valmarana",
      "lat": 45.4335673,
      "long": 11.8935217
    },
    {
      "stop_id": "9882",
      "stop_code": "9874",
      "stop_desc": "CAMIN SCUOLE R",
      "lat": "45.3978652954102",
      "long": "11.9445171356201"
    }
  ],
  "time_intervals": [
    {
      "start": "2025-07-10T07:30:00.000Z",
      "end": "2025-07-10T21:59:59.000Z"
    },
    {
      "start": "2025-07-11T15:00:00.000Z",
      "end": "2025-07-11T21:59:59.000Z"
    },
    {
      "start": "2025-07-12T15:00:00.000Z",
      "end": "2025-07-12T21:59:59.000Z"
    }
  ]
}
```

# Dipendenze

Questo programma richiede il database vettoriale **Qdrant** per funzionare. Si consiglia di eseguirlo come segue:


```bash  
docker pull qdrant/qdrant  
docker run -p 6333:6333 -v $(pwd)/storage/qdrant:/qdrant/storage qdrant/qdrant  
```  

# Come funziona

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
2. Ricerca tramite un LLM, collegato con RAG a un database vettoriale contenuto in Qdrant chiamato `gtfs-lines`.

Il secondo modo è chiamato solo se il primo fallisce di trovare un risultato.

Per `suspended_stops` e `replacement_stops` si utilizza la funzione `queryStop()`. In questo caso, la ricerca avviene in tre modi:

1. Ricerca per paragono diretto di stringhe, fatta con `fuze.js`.
2. Ricerca tramite paragono direttore di embedding vettoriali, fatta con `vectorQueryEngine` di `LlamaIndex`. Gli embedding vettoriali sono salvati in `gtfs-stops`.
3. Ricerca attraverso il Place API di Google Maps, che può identificare solo coordinate geografiche ma chiaramente non fermate. Questo è per quando si invetano una fermata che non esiste nel GTFS.

Il risultato di tutte queste ricerche viene combinato e restituito come un JSON arricchito, vedere output di esempio.
