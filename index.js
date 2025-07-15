import 'dotenv/config';
import setup from './utils/setup.js';
import { agent } from "@llamaindex/workflow";
import { queryLine } from './services/queryLine.js';
import { queryStops } from './services/queryStop.js';
import * as chrono from 'chrono-node';

const articolo = `

“FOLPO SUMMER FESTIVAL 2025” A NOVENTA PADOVANA (PD) Autolinea: E073 PADOVA – NOVENTA P. - STRA

Si informa che, in occasione della manifestazione denominata “Folpo Summer Festival 2025”, il centro di Noventa Padovana sarà interdetto alla circolazione stradale. Pertanto, nei seguenti giorni e orari:

    Giovedì 10 luglio dalle ore 9.30 fino termine servizio
    Venerdì 11 luglio dalle ore 17.00 fino termine servizio
    Sabato 12 luglio dalle ore 17.00 fino termine servizio

le corse delle autolinee in oggetto effettueranno il seguente percorso in deviazione:

da Padova: giunti in via Undicesima strada si svolterà a sinistra in via Nona Strada, si manterrà la destra in via Serenissima, alla rotatoria si proseguirà in via Serenissima seguendo le indicazioni per Noventa Padovana centro e alla rotatoria successiva si svolterà a destra in via Valmarana, continuando fino a Strà (non si entra in centro a Noventa Padovana). 

da Stra:  percorso inverso.

FERMATE SOSPESE:

Ø  Via Caduti sul Lavoro

Ø  Centro Fitness

Ø  Villaggio Sant’Antonio

Ø  Bar Industria

FERMATE SOSTITUTIVE:

Ø  Fermata provvisoria in via nona/undicesima strada

Ø  Via Valmarana

Ø  Noventa scuole
`;

const initialQuery = `
    Qual è il titolo dell'articolo? Rispondi con il titolo senza preamboli. Se non c'è un titolo, rispondi con "null".
    
    L'articolo riguarda una deviazione? Ha senso modificare le fermate del GTFS per questo articolo? Rispondi con 1 per sì e con 0 per no.
    
    Voglio la risposta in questo formato JSON:
    {
        "title": "Il titolo dell'articolo",
        "is_necessary": 1 // 1 se è necessario modificare i dati GTFS, 0 altrimenti
    }`;

const detailQuery = `
    Rispondi con un oggetto JSON che contiene le seguenti informazioni:
    {
        "affected_lines": ["linea 1", "linea 2"], // Quali sono le linee interessate dalla deviazione? Se tutte le linee sono interessate, rispondi con []. 
        "suspended_stops": ["fermata 1", "fermata 2"], // Quali fermate sono sospese a causa della deviazione? Se non ci sono fermate sospese, rispondi con [].
        "replacement_stops": ["fermata 1", "fermata 2"], // Quali fermate sostitutive sono state create? Se non ci sono fermate sostitutive, rispondi con [].
        "time_intervals": [] // Descrizione fornita dopo
    }
    
    Cerca di includere la descrizione della linea o della fermata quando presente, invece di presentare solo l'id o il nome, metti tutto quanto.
    
    Ecco i dettagli su come creare time_intervals, Usa questo formato:
    [
        {
            "start": "2025-07-05 18:30:00",
            "end": "2025-07-05 23:59:59"
        },
        {
            "start": "2025-07-06 18:30:00",
            "end": "2025-07-06 23:59:59"
        }
    ]
    
    Se non è menzionata un dato di inizio o fine, non c'è problema, non mettere start o end, l'importante è non inventare e attenerti solo ai dati dell'articolo.
    
    Se per esempio viene solo detto che la deviazione è in vigore dal 10 agosto alle 18:30, rispondi con
    [
        {
            "start": "2025-08-10 18:30:00"
        }
    ]
    
    Stai attento a situazioni in cui ci sono più giorni indicati. Per esempio dire venerdì e sabato da ore x a y, vuol dire che ci sono due intervalli: uno venerdì da x a y e uno sabato da x a y. Indica entrambi.
    
    Per aiutarti e inferire informazioni, ti dico qual è la data di ORA: ${new Date().toLocaleDateString()} e l'ora è ${new Date().toLocaleTimeString('it')}.
    `;

async function main(articolo, sourceUrl = 'https://www.fsbusitalia.it/it/veneto/news-veneto/2025/7/4/la-notte-bianca-di-bojon-2025--a-bojon--ve--.html') {
    await setup();

    const articleAgent = agent({
        tools: [],
        systemPrompt: `
        Sei un agente AI per leggere articoli di aziende di trasporto e modificare i dati GTFS. 
        
        Sto per fornirti un articolo di un'azienda di trasporto. Leggilo e rispondi alle domande che ti farò dopo. 
                
        Non includere preamboli, informazioni aggiuntive o spiegazioni. La tua risposta deve contenere solo l'informazione richiesta.
        
        Se non hai abbastanza informazioni per rispondere, rispondi con "null".
        
        L'articolo che ti fornirò è il seguente:
        ${articolo}
        `,
    });

    // Facciamo una query iniziale per capire se un articolo effettivamente riguarda una deviazione e se è necessario modificare i dati GTFS.
    const initialQueryData = JSON.parse(await runQuery(initialQuery, articleAgent));

    if (`${initialQueryData.is_necessary}`.includes('0')) return uselessArticle(initialQueryData.title, sourceUrl);

    // Indaghiamo ulteriormente per ottenere i dettagli della deviazione.
    let completedQueries;

    try {
        completedQueries = JSON.parse(await runQuery(detailQuery, articleAgent));
    } catch(e) {
        console.log('❌ Error parsing JSON from LLM response:', e.message);
        return uselessArticle(initialQueryData.title, sourceUrl);
    }

    const result = {
        title: initialQueryData.title,
        source_url: sourceUrl,
        timestamp: new Date().toISOString(),
        affected_lines: await queryLine(completedQueries['affected_lines'] || []),
        suspended_stops: await queryStops(completedQueries['suspended_stops'] || []),
        replacement_stops: await queryStops(completedQueries['replacement_stops'] || []),
        time_intervals: processDateRanges(completedQueries['time_intervals'] || []),
    };

    return JSON.stringify(result);
}

console.log(await main(articolo).catch(console.error));

async function runQuery(query, ragAgent) {
    const response = await ragAgent.run(query);

    console.log('✅ Query result: ', response.data.result);

    return response.data.result;
}

function uselessArticle(title, sourceUrl) {
    return JSON.stringify({
        title: title,
        source_url: sourceUrl,
        timestamp: new Date().toISOString(),
        affected_lines: [],
        suspended_stops: [],
        replacement_stops: [],
        time_intervals: null,
    });
}

// Function to process the JSON string
function processDateRanges(dateRanges) {
    const result = [];

    dateRanges.forEach((range) => {
        let parsedStart = null;
        let parsedEnd = null;

        // Parse time strings using chrono
        if (range.start) parsedStart = chrono.parseDate(range.start, new Date());
        if (range.end) parsedEnd = chrono.parseDate(range.end, new Date());

        result.push({
            start: parsedStart,
            end: parsedEnd,
        });
    });

    return result;
}
