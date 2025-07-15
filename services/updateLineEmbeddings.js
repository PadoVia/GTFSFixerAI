import { updateLineEmbeddings} from './queryLine.js';

updateLineEmbeddings().then(() => {
    console.log('✅ Embeddings of GTFS lines updated.');
});
