import { updateStopEmbeddings } from '../analyzers/queryStop.js';
import fs from 'fs';
const operators = fs.readdirSync('../storage/gtfs', { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);
console.log('🚏 Available operators:', operators)

for (const operator of operators) {
    await updateStopEmbeddings(operator).then(() => {
        console.log(`✅ Embeddings of GTFS stops updated for operator ${operator}`);
    });
}
