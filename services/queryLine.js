import dotenv from 'dotenv';

import { Settings, VectorStoreIndex, storageContextFromDefaults  } from 'llamaindex';
import { QdrantVectorStore } from '@llamaindex/qdrant';
import { agent } from "@llamaindex/workflow";
import { Document } from '@llamaindex/core/schema';
import fs from 'fs';
import path from 'path';
import setup from '../utils/setup.js';
import Fuse from 'fuse.js';

dotenv.config({ path: ['../.env'] });
setup();

const gtfsLinesVectorStore = new QdrantVectorStore({
    url: process.env.QDRANT_URL,
    embeddingModel: Settings.embedModel,
    collectionName: 'gtfs-lines',
});

const gtfsLinesStorageContext = storageContextFromDefaults({ vectorStore: gtfsLinesVectorStore });

const reader = (await VectorStoreIndex.fromVectorStore(gtfsLinesVectorStore)).queryTool({
    metadata: {
        name: 'gtfs_lines_reader',
        description: 'Questo strumento fornisce le linee disponibili nel GTFS.',
    },
});

const storageDir = path.join('../storage/gtfs');
const filePath = path.join(storageDir, 'routes.json');

const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

// Ciò che ci darà l'LLM è solo un descrittore delle linee. Dobbiamo andare a cercare nei dati GTFS per trovare esattamente la linea corrispondente.
export async function queryLine(lineDescriptions) {
    const gtfsLinesAgent = agent({
        tools: [
            await reader,
        ],
        systemPrompt: `
        Sei un agente AI per leggere le linee disponibili nel GTFS.
        `,
    });

    const fuse = new Fuse(data, {
        keys: ['route_short_name', 'route_long_name'],
        threshold: 0.0,
        minMatchCharLength: 3,
    });

    const resultingLines = [];

    for (const lineDescription of lineDescriptions) {
        // Primo tentativo, cerchiamo di trovare una corrispondenza con fuzzy search
        const bestMatches = fuse.search(lineDescription);

        if (bestMatches.length) return {
            route_short_name: bestMatches[0].item.route_short_name,
            route_id: bestMatches[0].item.route_id,
            route_long_name: bestMatches[0].item.route_long_name
        }

        // Secondo tentativo, usiamo l'agente AI per cercare la linea
        const queryResponse = await gtfsLinesAgent.run(`
            Ti verrà dato un testo che descrive una linea del GTFS.
            Il tuo lavoro è capire se questa linea è presente nel GTFS e, in caso affermativo, restituire tutte le informazioni relative a quella linea.

            Restituisci solo una string json formattata in questo modo:
            {
                "route_short_name": "Nome della linea",
                "route_id": "ID della linea",
                "route_long_name": "Descrizione della linea"
            }

            Non restituire altro testo, solo la stringa json.
            
            Descrizione della linea: "${lineDescription}"
            
            Se ti viene data una linea che è solo un numero, è probabile che sia una linea urbana.
            
            Le linee urbane di solito hanno un route_short_name del tipo U06, U07, U24, ecc.
            
            Quindi linea 10 è U10, linea 3 è U03, linea 5 è U05, ecc.
        `);

        resultingLines.push(JSON.parse(queryResponse.data.result));
    }

    return resultingLines
}

async function updateLineEmbeddings() {
    // Filtriamo per avere solo le informazioni necessarie
    const filteredData = data.map(({ route_short_name, route_id, route_long_name }) =>
        `Route: route_short_name: ${route_short_name} | route_id: ${route_id} | route_long_name: ${route_long_name} | End route, \n\n`
    );

    const allLines = new Document({
        text: filteredData.join('\n')
    });

    console.log(`✅ Formattato ${filteredData.length} linee in un documento`);

    await VectorStoreIndex.fromDocuments([allLines], { storageContext: await gtfsLinesStorageContext });
}

updateLineEmbeddings().then(() => {
   console.log('✅ Embeddings of GTFS lines updated.');
});
