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
  "timestamp": "2025-07-09T14:30:00Z",
  "source_url": "https://mobilitadimarca.it/news/415/modifiche-ai-servizi",
  "affected_lines": ["6", "TV1"],
  "suspended_stops": [
    {
      "name": "via Roma 12",
      "lat": 45.6654,
      "lon": 12.2458
    }
  ],
  "replacement_stops": [
    {
      "name": "via Dante 3",
      "lat": 45.6681,
      "lon": 12.2489
    }
  ]
}
```
