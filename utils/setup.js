import 'dotenv/config';

import { Settings } from 'llamaindex';
import { OpenAI, OpenAIEmbedding } from '@llamaindex/openai';

export default function setup() {
    // Setup LLM
    if (!process.env.OPENAI_API_KEY) {
        console.error('⚠ OPENAI_API_KEY isn\'t defined in .env.');
        process.exit(1);
    }

    Settings.llm = new OpenAI({
        model: process.env.OPENAI_MODEL,
        apiKey: process.env.OPENAI_API_KEY,
    });

    Settings.embedModel = new OpenAIEmbedding();
}
