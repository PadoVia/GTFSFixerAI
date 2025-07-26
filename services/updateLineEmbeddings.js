import { updateLineEmbeddings} from '../lib/queryLine.js';

updateLineEmbeddings().then(() => {
    console.log('✅ Embeddings of GTFS lines updated.');
});
