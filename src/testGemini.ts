import { GeminiConnector } from './geminiConnector';

async function testGemini() {
    const connector = new GeminiConnector();
    const result = await connector.generateQuestion();
    console.log(result);
}

testGemini();
