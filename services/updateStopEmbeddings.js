import { updateStopEmbeddings } from '../lib/queryStop.js';

updateStopEmbeddings().then(() => {
    console.log('✅ Embeddings of GTFS stops updated.');
});
