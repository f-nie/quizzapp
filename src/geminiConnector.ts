import { GoogleGenerativeAI } from "@google/generative-ai";
import { constants } from "./constants";
import { DbConnector } from "./dbConnector";
import { errWithTime } from "./util";

export type AIQuestion = {
    question: string;
    answer: number;
}

export type AIQuestionResult = AIQuestion | { error: Error };

export class GeminiConnector {

    private dbConnector: DbConnector;
    private apiKey: string = "";

    public constructor(dbConnector: DbConnector) {
        this.dbConnector = dbConnector;
        this.apiKey = process.env.GOOGLE_API_KEY || "";
        if (!this.apiKey) {
            errWithTime("Missing GOOGLE_API_KEY in the environment variables");
        }
    }

    public async generateQuestion(): Promise<AIQuestionResult> {
        if (!this.IsUp()) {
            return { error: new Error("Gemini AI is not available: ")};
        }

        const prompt = await this.loadPrompt();
        const genAI = new GoogleGenerativeAI(this.apiKey);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        try {
            const result = await model.generateContent(prompt);
            return this.parseResponse(result.response.text());
        } catch (error) {
            errWithTime((error as Error).message);
            return { error: new Error("Failed to generate question: " + (error as Error).message) };
        }
    }

    public async IsUp(): Promise<boolean> {
        return this.apiKey !== "" && await this.loadPrompt() !== "";
    }

    private parseResponse(response: string): AIQuestionResult {
        const trimmedResposne = this.removeFirstAndLastLine(response);

        let json;
        try {
            json = JSON.parse(trimmedResposne);
            return {
                question: json.question,
                answer: json.answer
            };
        } catch (error) {
            throw new Error("Failed to parse JSON response: " + (error as Error).message);
        }
    }

    private removeFirstAndLastLine(input: string): string {
        const lines = input.split('\n');
        if (lines.length <= 2) {
            return '';
        }
        return lines.slice(1, -2).join('\n');
    }

    private async loadPrompt(): Promise<string> {
        const config = await this.dbConnector.getConfig();

        const prompt = config.find(c => c.key === constants.config.geminiPromptConfigKey)?.value || "";
        if (!prompt) {
            errWithTime("Missing AI prompt in the configuration");
        }
        return prompt;
    }
}