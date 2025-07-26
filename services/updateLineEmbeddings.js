import { updateLineEmbeddings} from '../analyzers/queryLine.js';
import fs from 'fs';
const operators = fs.readdirSync('../storage/gtfs', { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);
console.log('🚏 Available operators:', operators)

for (const operator of operators) {
    await updateLineEmbeddings(operator).then(() => {
        console.log(`✅ Embeddings of GTFS lines updated for operator ${operator}`);
    });
}
