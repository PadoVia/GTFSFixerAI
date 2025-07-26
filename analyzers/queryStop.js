import dotenv from 'dotenv';

import { Settings, VectorStoreIndex, storageContextFromDefaults, RouterQueryEngine } from 'llamaindex';
import { PlacesClient } from '@googlemaps/places';
import { QdrantVectorStore } from '@llamaindex/qdrant';
import { Document } from '@llamaindex/core/schema';
import fs from 'fs';
import path from 'path';
import setup from '../utils/setup.js';
import Fuse from 'fuse.js';

dotenv.config({ path: ['../.env'] });
setup();

let gtfsStopsVectorStore, gtfsStopsStorageContext, reader, storageDir, data;

async function setContext(operator) {
    gtfsStopsVectorStore = new QdrantVectorStore({
        url: process.env.QDRANT_URL,
        embeddingModel: Settings.embedModel,
        collectionName: `gtfs-stops-${operator}`,
    });

    gtfsStopsStorageContext = storageContextFromDefaults({ vectorStore: gtfsStopsVectorStore });

    reader = (await VectorStoreIndex.fromVectorStore(gtfsStopsVectorStore)).queryTool({
        metadata: {
            name: 'gtfs_stops_reader',
            description: 'Questo strumento fornisce le fermate disponibili nel GTFS.',
        },
    });

    storageDir = path.join('./storage/gtfs', operator);

    const filePath = path.join(storageDir, 'stops.json');

    data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

// Ciò che ci darà l'LLM è solo un descrittore delle fermate. Dobbiamo andare a cercare nei dati GTFS per trovare esattamente la fermata corrispondente.
export async function queryStops(stopDescriptions, operator) {
    await setContext(operator);

    const resultingStops = [];

    for (const stopDescription of stopDescriptions) {
        // Primo tentativo, cerchiamo di trovare una corrispondenza con fuzzy search
        const fuzzyResult = await fuzzySearchStop(stopDescription);
        if (fuzzyResult) {
            resultingStops.push(fuzzyResult);
            continue;
        }

        // Secondo tentativo, usiamo l'agente AI per cercare la linea
        const llmResult = await llmSearchStop(stopDescription);
        if (llmResult) {
            resultingStops.push(llmResult);
            continue;
        }

        // Terzo tentativo, usiamo il servizio di Google Maps per cercare la fermata
        const mapsResult = await mapsSearchStop(stopDescription, operator);
        resultingStops.push(mapsResult);
    }

    return resultingStops
}

async function fuzzySearchStop(stopDescription) {
    const fuse = new Fuse(data, {
        keys: ['stop_desc'],
        threshold: 0.0,
        minMatchCharLength: 3,
    });

    const bestMatches = fuse.search(stopDescription);

    if (process.env.logging) console.log('🔍 Fuzzy search top result:', bestMatches[0]);

    if (bestMatches.length) return {
        stop_id: bestMatches[0].item.stop_id,
        stop_code: bestMatches[0].item.stop_code,
        stop_desc: bestMatches[0].item.stop_desc,
        lat: bestMatches[0].item.stop_lat,
        long: bestMatches[0].item.stop_lon,
    }

    return null; // Non abbiamo trovato una fermata corrispondente
}

async function llmSearchStop(stopDescription) {
    const index = await VectorStoreIndex.fromVectorStore(gtfsStopsVectorStore)

    const vectorQueryEngine = await index.asQueryEngine()

    const queryEngine = RouterQueryEngine.fromDefaults({
        queryEngineTools: [
            {
                queryEngine: vectorQueryEngine,
                description: 'Utile per trovare fermate nel GTFS a partire dalla descrizione.',
            },
        ],
    });

    const result = await queryEngine.query({
        query: `
             Ti fornirò una descrizione di una fermata nel GTFS. Devi restituirmi l'ID associato a quella fermata. Restituisci solo il numero ID, nient'altro. Il risultato deve essere solo un numero.
             
             Se non trovi una fermata che corrisponde ragionevolmente alla descrizione, restituisci la stringa null. Meglio restituire null che una risposta strana.
             
             Descrizione fermata: ${stopDescription}
            `
            })

    if (process.env.logging) console.log('🔍 Vector comparison search results:', result.response);

    if (result.response === 'null') return null;

    // Ora dobbiamo cercare le altre informazioni della fermata nei dati GTFS
    const stop = data.find(s => s.stop_id === result.response.trim());

    return {
        stop_id: stop.stop_id,
        stop_code: stop.stop_code,
        stop_desc: stop.stop_desc,
        lat: stop.stop_lat,
        long: stop.stop_lon,
    }
}

const placesClient = new PlacesClient({
    apiKey: process.env.GOOGLE_MAPS_TOKEN,
});

async function mapsSearchStop(stopDescription, operator) {
    const request = {
        textQuery: stopDescription,
        locationBias: {
            circle: {
                center: {
                    latitude: process.env[`${operator.toUpperCase()}_CENTER_LATITUDE`] || 45.4092,
                    longitude: process.env[`${operator.toUpperCase()}_CENTER_LONGITUDE`] || 11.8778,
                },
                radius: 500.0,
            },
        },
        pageSize: 1,
    };

    try {
        // Add metadata with field mask
        const options = {
            otherArgs: {
                headers: {
                    'X-Goog-FieldMask': 'places.location'
                }
            }
        };

        const response = (await placesClient.searchText(request, options))[0];

        if (process.env.logging) console.log('🔍 Maps search results:', response);

        if (
            response.places &&
            response.places.length > 0 &&
            response.places[0].location
        ) {
            const { latitude, longitude } = response.places[0].location;

            return {
                stop_id: null, // Non abbiamo un ID di fermata
                stop_code: null, // Non abbiamo un codice di fermata
                stop_desc: stopDescription, // Usare il nome del luogo come descrizione della fermata
                lat: latitude,
                long: longitude,
            }
        } else {
            return {};
        }
    } catch (error) {
        console.error('❌ Error fetching place data:', error);
        return {};
    }
}

export async function updateStopEmbeddings(operator) {
    await setContext(operator)

    // Create a document for each stop
    const documents = data.map(({ stop_id, stop_desc }) => {
        const stopText = `Fermata: (ID: ${stop_id} Nome: ${stop_desc})`;
        return new Document({ text: stopText });
    });

    console.log(`✅ Formatted ${documents.length} stops in separate documents`);

    // Index each document separately
    await VectorStoreIndex.fromDocuments(documents, {
        storageContext: await gtfsStopsStorageContext
    });
}
