import { OpenAPIConnector } from './openAPIConnector';

async function testOpenAI() {
    const connector = new OpenAPIConnector();
    await connector.askOpenAI();
}

testOpenAI();
