import OpenAIApi from "openai";

export class OpenAPIConnector {
    private openai = new OpenAIApi({
        apiKey: "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",
    });

    public async askOpenAI() {
        try {
            const response = await this.openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [{ role: 'user', content: 'Generate a number estimation question and return the solution. Return it as a JSON object with the structure { question: "...", solution: "..." }' }]
            });


            console.log("Antwort von OpenAI:", response);
        } catch (error) {
            console.error(error);
        }
    }
}