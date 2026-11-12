import { GoogleGenAI } from "@google/genai";
import { DbConnector } from "./dbConnector";
import { errWithTime } from "./util";

export type AIQuestion = {
    question: string;
    answer: number;
};

type AIQuestionResult = AIQuestion | { error: Error };

type PromptParts = { systemInstruction: string; contents: string };

export class GeminiConnector {

    private dbConnector: DbConnector;
    private apiKey: string;

    constructor(dbConnector: DbConnector) {
        this.dbConnector = dbConnector;
        this.apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
        if (!this.apiKey) {
            errWithTime("Missing GEMINI_API_KEY in environment variables");
        }
    }

    public isAvailable(): boolean {
        return this.apiKey !== "";
    }

    // Ordered by availability robustness: lite models handle high load better
    private static readonly MODELS = ["gemini-3.5-flash-lite", "gemini-3.8-flash"];

    public async generateQuestion(): Promise<AIQuestionResult> {
        if (!this.isAvailable()) {
            return { error: new Error("AI is not available: missing GEMINI_API_KEY") };
        }

        const prompt = await this.buildPrompt();
        const ai = new GoogleGenAI({ apiKey: this.apiKey });

        for (const model of GeminiConnector.MODELS) {
            const result = await this.tryGenerate(ai, model, prompt);
            if (!("error" in result)) {
                this.dbConnector.insertAiSuggestion(result.question);
                return result;
            }
            const isOverloaded = result.error.message.includes("UNAVAILABLE") ||
                result.error.message.includes("503");
            if (!isOverloaded) {
                return result;
            }
            errWithTime(`Model ${model} overloaded, trying next...`);
        }

        return { error: new Error("All models are currently overloaded. Please try again later.") };
    }

    private async tryGenerate(ai: GoogleGenAI, model: string, prompt: PromptParts): Promise<AIQuestionResult> {
        const retryDelaysMs = [1000, 3000];

        for (let attempt = 0; attempt <= retryDelaysMs.length; attempt++) {
            try {
                const response = await ai.models.generateContent({
                    model,
                    contents: prompt.contents,
                    config: {
                        systemInstruction: prompt.systemInstruction,
                        temperature: 1.4,
                        responseMimeType: "application/json",
                        seed: Math.floor(Math.random() * 1_000_000),
                    },
                });
                return this.parseResponse(response.text ?? "");
            } catch (error) {
                const isOverloaded = (error as Error).message.includes("UNAVAILABLE") ||
                    (error as Error).message.includes("503");

                if (isOverloaded && attempt < retryDelaysMs.length) {
                    errWithTime(`${model} overloaded, retrying in ${retryDelaysMs[attempt] / 1000}s...`);
                    await new Promise(resolve => setTimeout(resolve, retryDelaysMs[attempt]));
                } else {
                    return { error: error as Error };
                }
            }
        }

        return { error: new Error(`${model} failed after retries`) };
    }

    // Random nudges vary the *type* of question each call, breaking the model's default patterns
    // private static readonly NUDGES = [
    //     "The answer should be a surprisingly large number that most people would drastically underestimate.",
    //     "The answer should be a surprisingly small number that most people would drastically overestimate.",
    //     "The question should involve a world record or an extreme value (fastest, heaviest, longest, hottest…).",
    //     "The question should involve an everyday object or situation with an unexpected numerical property.",
    //     "The question should involve a ratio or comparison between two things (e.g. 'X times the weight of Y').",
    //     "The question should involve something that takes an unexpectedly long time (duration, age, geological scale).",
    //     "The question should involve something that happens at an unexpectedly high speed or frequency.",
    //     "The question should involve human production or consumption at a global scale (per second, per year).",
    //     "The question should involve an animal — but avoid mammals. Think insects, fish, birds, or microorganisms.",
    //     "The question should involve infrastructure, construction, or engineering at large scale.",
    //     "The question should involve money, prices, or economic quantities at an unexpected scale.",
    //     "The question should involve the human body — a measurement most people never think about.",
    //     "The question should involve astronomy or planetary science with an awe-inspiring scale.",
    //     "The question should involve food, cooking, or agriculture with a surprising numerical answer.",
    //     "The question should involve sound, light, or other physical phenomena.",
    //     "The question should have a reference to SAP (the company), or to one of our office locations: Dresden, Berlin, Walldorf, or Wuppertal.",
    //     "The question should involve a technology invention, standard, or product release date — something the player would almost certainly guess off by decades.",
    //     "The question should involve a surprising statistic from professional sports — a count, speed, duration, or record most fans would never guess.",
    //     "The question should involve a movie, TV series, song, or video game — a statistic that even dedicated fans would not know.",
    //     "The question should involve a routine human activity and its surprising cumulative scale (e.g. how many minutes per day, or how many times per year).",
    //     "The question should involve a geographical measurement — the length of a border, coastline, or river, or the height of a mountain, with a surprisingly large or small value.",
    //     "The question should involve a surprising historical date or calendar oddity — something that challenges the player's intuition about when or how something began.",
    //     "The question should involve human spaceflight or space exploration — missions, milestones, or the count of people who have ever been in space.",
    //     "The question should involve a surprising count of something mundane at a national scale — how many X currently exist in Germany.",
    //     "The question should involve an environmental or energy statistic at a scale that is hard to grasp — renewable energy output, species counts, or resource consumption.",
    //     "The question should have a mathematical or logical property as its answer — something counterintuitive or playfully tricky.",
    // ];

    // private static pickNudge(): string {
    //     return GeminiConnector.NUDGES[Math.floor(Math.random() * GeminiConnector.NUDGES.length)];
    // }

    private static readonly THEME_STOP_WORDS = new Set([
        // function words
        "how", "many", "does", "a", "an", "the", "in", "its", "of", "to", "have", "are",
        "there", "on", "per", "for", "over", "with", "every", "each", "during", "without",
        "as", "is", "at", "by", "from", "was", "be", "it", "this", "that", "or", "and",
        "what", "which", "who", "when", "where", "their", "has", "had", "can", "make",
        "only", "any", "one", "two", "three", "last", "first", "about", "than", "more",
        "all", "up", "into", "most", "ever", "some", "such", "also", "just", "even",
        // generic descriptors
        "single", "ordinary", "known", "currently", "recent", "recently", "official",
        "standard", "regular", "typical", "average", "total", "number", "contain", "contains",
        "longest", "largest", "biggest", "smallest", "highest", "lowest", "fastest", "slowest",
        "long", "large", "high", "small", "great", "little", "different", "various",
        // units of measurement
        "kilogram", "kilograms", "gram", "grams",
        "hour", "hours", "minute", "minutes", "second", "seconds",
        "day", "days", "week", "weeks", "year", "years",
        "meter", "meters", "kilometer", "kilometers", "centimeter", "centimeters",
        "liter", "liters", "milliliter", "milliliters",
        "percent", "percentage", "times",
    ]);

    private extractOverrepresentedThemes(suggestions: string[]): string[] {
        const wordCount = new Map<string, number>();
        for (const suggestion of suggestions) {
            const words = suggestion.toLowerCase()
                .replace(/[^a-z\s]/g, " ")
                .split(/\s+/)
                .filter(w => w.length > 3 && !GeminiConnector.THEME_STOP_WORDS.has(w));
            for (const word of new Set(words)) {
                wordCount.set(word, (wordCount.get(word) || 0) + 1);
            }
        }
        return [...wordCount.entries()]
            .filter(([, count]) => count >= 3)
            .sort((a, b) => b[1] - a[1])
            .map(([word]) => word);
    }

    private async buildPrompt(): Promise<PromptParts> {
        const rows = await this.dbConnector.getQuestions() as { question: string; solution: string }[];

        const history = rows
            .slice(0, 50)
            .map(q => `Q: ${q.question} | A: ${q.solution}`)
            .join("\n");

        const recentSuggestions = await this.dbConnector.getRecentAiSuggestions(30);
        const uniqueSuggestions = [...new Set(recentSuggestions)];
        const overrepresentedThemes = this.extractOverrepresentedThemes(uniqueSuggestions);

        const themeWarning = overrepresentedThemes.length > 0
            ? `These topics are overrepresented in recent suggestions — avoid them entirely: ${overrepresentedThemes.join(", ")}.\n`
            : "";

        const blacklistSection = uniqueSuggestions.length > 0
            ? `Do NOT suggest any of these recently suggested questions:\n${uniqueSuggestions.map(q => `- ${q}`).join("\n")}\n${themeWarning}\n`
            : "";

        const systemInstruction = `You are a creative and curious quiz master for a numerical estimation game.
Players hear a question and must guess a number — the closest guess wins.

Your goal is to surprise players with questions they would never have thought of — curious facts, unexpected scales, bizarre records, or counterintuitive truths. The best questions make people go "really?! I would never have guessed that!".
Questions must be factual, specific, and verifiable. The answer is always a number.
Occasionally, you may base a question on a current event, recent news, or a live statistic.
Optional: technical terms may be followed by a German translation in parentheses.

Always respond with a single valid JSON object: {"question": "...", "answer": <number>}`;

        const contents = `Here are existing questions as inspiration for style, difficulty, and themes — draw from this same spirit:

${history}

${blacklistSection}Generate one new estimation question in the same spirit. Make it surprising, curious, or fun.`;

        return { systemInstruction, contents };
    }

    private parseResponse(response: string): AIQuestionResult {
        const cleaned = response.trim()
            .replace(/^```json\s*/, "")
            .replace(/\s*```$/, "");

        try {
            const json = JSON.parse(cleaned);
            if (typeof json.question !== "string" || typeof json.answer !== "number") {
                return { error: new Error("Invalid response format from AI") };
            }
            return { question: json.question, answer: json.answer };
        } catch (error) {
            return { error: new Error("Failed to parse AI response: " + (error as Error).message) };
        }
    }
}

