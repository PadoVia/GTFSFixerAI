import { updateStopEmbeddings } from './queryStop.js';

updateStopEmbeddings().then(() => {
    console.log('✅ Embeddings of GTFS stops updated.');
});
