import { OpenAI, OpenAIEmbedding } from "@llamaindex/openai";

process.env.NODE_NO_WARNINGS = '1';

import 'dotenv/config';
import { Settings } from 'llamaindex';
import { agent } from "@llamaindex/workflow";
import * as chrono from 'chrono-node';

const articolo = `
LA NOTTE BIANCA DI BOJON 2025” A BOJON (VE).

Autolinea: E071 PADOVA – VIGONOVO – S. ANGELO DI P. – BOJON – LOVA 

Si informa che, per lo svolgimento della manifestazione denominata “LA NOTTE BIANCA DI BOJON 2025” a Bojon (Ordinanza comune di Campolongo Maggiore VE n.18 del 18-06-2025), nella giornata di sabato 5 luglio 2025 dalle ore 18.30 e fino al termine del servizio, verrà chiusa al traffico via Villa, dalla rotatoria di via Rovine alla rotatoria di via Durighello.  Pertanto, tutte le corse dell’autolinea in oggetto dovranno effettuare la seguente deviazione al normale percorso di linea: 

Da Padova: giunti a Bojon in via Villa, alla rotatoria con via Rovine si svolterà a sinistra per la stessa e alla successiva rotatoria a destra per via Corsivola.

Alla rotatoria dopo il sottopasso si proseguirà dritti per il deposito o a sinistra per continuare la corsa per Lova. 

Fermate sospese:

·         Bojon R

·         Bojon P. Livello R

 

Fermate sostitutive:

·         F.ta ACTV in via Rovine
`;

async function main(articolo, sourceUrl = 'https://www.fsbusitalia.it/it/veneto/news-veneto/2025/7/4/la-notte-bianca-di-bojon-2025--a-bojon--ve--.html') {

    // Setup LLM
    if (!process.env.OPENAI_API_KEY) {
        console.error('⚠ OPENAI_API_KEY isn\'t defined in .env.');
        process.exit(1);
    }

    Settings.llm = new OpenAI({
        model: 'gpt-3.5-turbo',
        apiKey: process.env.OPENAI_API_KEY,
    });

    Settings.embedModel = new OpenAIEmbedding();

    const ragAgent = agent({
        tools: [

        ],
        systemPrompt: `
        Sei un agente AI per leggere articoli di aziende di trasporto e modificare i dati GTFS. 
        
        Sto per fornirti un articolo di un\'azienda di trasporto. Leggilo e rispondi alla domanda che ti farò dopo. 
        
        La domanda verrà inserita tra i simboli ***
        
        Non includere preamboli, informazioni aggiuntive o spiegazioni. La tua risposta deve contenere solo l'informazione richiesta.
        
        Se non hai abbastanza informazioni per rispondere, rispondi con "null".
        
        L'articolo che ti fornirò è il seguente:
        ${articolo}
        `,
    });

    // Controlliamo se l'articolo è effettivamente una deviazione e vale la pena modificare i dati GTFS

    const title = await runQuery(
        `Qual è il titolo dell'articolo? Rispondi con il titolo senza preamboli. Se non c'è un titolo, rispondi con "null".`,
        ragAgent
    );

    const isNecessary = await runQuery(
        `L'articolo riguarda una deviazione? Ha senso modificare le fermate del GTFS per questo articolo? Rispondi con 1 per sì e con 0 per no.`,
        ragAgent
    );

    if (isNecessary.includes('0')) return uselessArticle(title, sourceUrl);

    // Approfondiamo l'articolo per estrarre le informazioni necessarie
    // Piccola nota, non dire all'AI di usare ora in formato ISO, tende a confondersi molto con i fusi orari.

    const queryMap = {
        'affected_lines': `Quali sono le linee interessate dalla deviazione? Rispondi con i descrittori delle linee separati in un formato JSON, quindi ["linea 1", "linea 2"]. Se tutte le linee sono interessate, rispondi con [].`,
        'suspended_stops': `Quali fermate sono sospese a causa della deviazione? Rispondi con i nomi delle fermate sospese separati in un formato JSON, quindi ["fermata 1", "fermata 2"]. Se non ci sono fermate sospese, rispondi con [].`,
        'replacement_stops': `Quali fermate sostitutive sono state create a causa della deviazione? Rispondi con i nomi delle fermate sostitutive separati in un formato JSON, quindi ["fermata 1", "fermata 2"]. Se non ci sono fermate sostitutive, rispondi con [].`,
        'time_intervals': `Devi creare un oggetto JSON con gli intervalli in cui questa deviazione è in effetto. Il formato che devi utilizzare è il seguente:
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
        Per aiutarti e inferire informazioni, ti dico qual è la data di ORA: ${new Date().toLocaleDateString()} e l'ora è ${new Date().toLocaleTimeString('it')}.
        `,
    }

    const completedQueries = {};
    for (const [key, query] of Object.entries(queryMap)) {
        completedQueries[key] = await runQuery(query, ragAgent);
    }

    const result = {
        title: title,
        source_url: sourceUrl,
        timestamp: new Date().toISOString(),
        affected_lines: queryLine(completedQueries['affected_lines']),
        suspended_stops: queryStops(completedQueries['suspended_stops']),
        replacement_stops: queryStops(completedQueries['replacement_stops']),
        time_intervals: processDateRanges(completedQueries['time_intervals']),
    };

    return JSON.stringify(result);
}

console.log(await main(articolo).catch(console.error));

async function runQuery(query, ragAgent) {
    console.log(`⚙ Executing query: '${query}'`);

    const response = await ragAgent.run(query);

    console.log ('✅ Query result: ', response.data.result);

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
    })
}

// Ciò che ci darà l'LLM è solo un descrittore delle linee. Dobbiamo andare a cercare nei dati GTFS per trovare esattamente la linea corrispondente.
function queryLine(lineDescriptions) {
    return JSON.parse(lineDescriptions);
}

// Ciò che ci darà l'LLM è solo un descrittore delle fermate. Dobbiamo andare a cercare nei dati GTFS per trovare esattamente la linea corrispondente.
function queryStops(stopDescriptions) {
    return JSON.parse(stopDescriptions);
}

// Function to process the JSON string
function processDateRanges(jsonString) {
    // Parse the JSON string
    let dateRanges;
    try {
        dateRanges = JSON.parse(jsonString);
    } catch (e) {
        return null;
    }

    // Validate the structure
    if (!Array.isArray(dateRanges)) {
        return null;
    }

    const result = [];

    dateRanges.forEach((range) => {
        let parsedStart = null,
        parsedEnd = null;

        // Parse time strings using chrono
        if (range.start) parsedStart = chrono.parseDate(range.start, new Date());
        if (range.end) parsedEnd = chrono.parseDate(range.end, new Date());

        result.push({
            start: parsedStart,
            end: parsedEnd,
        })
    });

    return result;
}
