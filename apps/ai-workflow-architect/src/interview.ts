import OpenAI from "openai";
import { z } from "zod";
import { config } from "./config.js";

const DecisionSchema = z.object({
  reply: z.string().min(1), complete: z.boolean(),
  requirements: z.object({ name: z.string().optional(), trigger: z.string().optional(), action: z.string().optional(), endpoint: z.string().optional(), method: z.string().optional(), credentialKey: z.string().optional(), description: z.string().optional() }).nullable(),
});
export type ChatMessage = { role: "user" | "assistant"; content: string };
export class InterviewService {
  private readonly client = new OpenAI({ apiKey: config.OPENAI_API_KEY });
  async nextTurn(history: ChatMessage[], message: string) {
    const response = await this.client.chat.completions.create({
      model: config.OPENAI_MODEL, temperature: 0.2, response_format: { type: "json_object" },
      messages: [
        { role: "system", content: `You are an AI workflow architect for a self-hosted n8n service. Interview the user one concise question at a time about trigger, input data, action, connector, approved credential mapping, error handling, and whether private knowledge retrieval is needed. Never ask for secrets and never invent an endpoint or credential. This first version supports only a webhook trigger followed by a custom HTTPS API request. Return JSON with reply (string), complete (boolean), requirements (object or null). Only mark complete when name, webhook trigger, HTTP action, endpoint, and method are known. Do not deploy or activate workflows.` },
        ...history.map((m) => ({ role: m.role, content: m.content })),
        { role: "user", content: message },
      ],
    });
    const content = response.choices[0]?.message.content;
    if (!content) throw new Error("AI returned an empty response");
    return DecisionSchema.parse(JSON.parse(content));
  }
}
