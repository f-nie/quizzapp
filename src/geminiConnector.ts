import { GoogleGenerativeAI } from "@google/generative-ai";
import { constants } from "./constants";
import { DbConnector } from "./dbConnector";
import { errWithTime } from "./util";

export type AIQuestion = {
    question: string;
    answer: number;
}

export class GeminiConnector {

    private apiKey: string = "";
    private prompt: string = "";

    public constructor(dbConnector: DbConnector) {
        this.apiKey = process.env.GOOGLE_API_KEY || "";
        if (!this.apiKey) {
            errWithTime("Missing GOOGLE_API_KEY in the environment variables");
        }
        dbConnector.getConfig().then(config => {
            this.prompt = config.find(c => c.key === constants.config.geminiPromptConfigKey)?.value || "";
            if (!this.prompt) {
                errWithTime("Missing AI prompt in the configuration");
            }
        });
    }

    public async generateQuestion(): Promise<AIQuestion> {
        if (!this.IsUp()) {
            return { question: "Gemini AI is not available", answer: 0 };
        }

        const genAI = new GoogleGenerativeAI(this.apiKey);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        const result = await model.generateContent(this.prompt);

        return this.parseResponse(result.response.text());
    }

    public IsUp(): boolean {
        return this.apiKey !== "" && this.prompt !== "";
    }

    private parseResponse(response: string): AIQuestion {
        const trimmedResposne = this.removeFirstAndLastLine(response);

        let json;
        try {
            json = JSON.parse(trimmedResposne);
            return {
                question: json.question,
                answer: json.answer
            };
        } catch (error) {
            errWithTime("Failed to parse JSON response: " + error);
            return { question: "Failed to parse Gemini response", answer: 0 };
        }
    }

    private removeFirstAndLastLine(input: string): string {
        const lines = input.split('\n');
        if (lines.length <= 2) {
            return '';
        }
        return lines.slice(1, -2).join('\n');
    }
}