/**
 * Local LLM client — talks to localhost:1234/api/v1/chat.
 *
 * Request format:
 *   { model, system_prompt, input }
 *
 * Response format (actual server):
 *   { model_instance_id, output: [{ type, content }], stats: { input_tokens, total_output_tokens } }
 */

const DEFAULT_URL = "http://localhost:1234/api/v1/chat";
const DEFAULT_MODEL = "google/gemma-4-e4b";

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** Actual server response shape. */
interface RawResponse {
  model_instance_id: string;
  output: Array<{ type: string; content: string }>;
  stats?: {
    input_tokens: number;
    total_output_tokens: number;
  };
}

export interface LlmClientOptions {
  url?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface CallResult {
  content: string;
  inputTokens?: number;
  outputTokens?: number;
  model: string;
}

export class LlmClient {
  readonly url: string;
  readonly model: string;
  private temperature: number;
  private maxTokens: number;

  private systemPrompt: string;
  private history: LlmMessage[] = [];

  totalInputTokens = 0;
  totalOutputTokens = 0;

  constructor(systemPrompt: string, options: LlmClientOptions = {}) {
    this.url = options.url ?? DEFAULT_URL;
    this.model = options.model ?? DEFAULT_MODEL;
    this.temperature = options.temperature ?? 0;
    this.maxTokens = options.maxTokens ?? 0;
    this.systemPrompt = systemPrompt;
  }

  async call(userPrompt: string): Promise<CallResult> {
    const conversationContext = this.history.map((m) => `${m.role}: ${m.content}`).join("\n");

    const fullInput = conversationContext
      ? `${conversationContext}\nuser: ${userPrompt}`
      : userPrompt;

    const body: Record<string, unknown> = {
      model: this.model,
      system_prompt: this.systemPrompt,
      input: fullInput,
      temperature: this.temperature,
    };
    // Only include max_tokens if explicitly set (server may reject it)
    if (this.maxTokens > 0) {
      body.max_tokens = this.maxTokens;
    }

    const res = await fetch(this.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => "Unknown error");
      throw new Error(`LLM API error ${res.status}: ${errorText.slice(0, 500)}`);
    }

    const data = (await res.json()) as RawResponse;

    // Extract content from output array (find first message-type entry)
    const assistantContent = data.output?.find((o) => o.type === "message")?.content ?? "";

    this.history.push(
      { role: "user", content: userPrompt },
      { role: "assistant", content: assistantContent },
    );

    if (data.stats) {
      this.totalInputTokens += data.stats.input_tokens;
      this.totalOutputTokens += data.stats.total_output_tokens;
    }

    return {
      content: assistantContent,
      inputTokens: data.stats?.input_tokens,
      outputTokens: data.stats?.total_output_tokens,
      model: data.model_instance_id || this.model,
    };
  }

  resetHistory(): void {
    this.history = [];
  }

  costSummary(): string {
    return [
      `Input:  ${this.totalInputTokens.toLocaleString()} tokens`,
      `Output: ${this.totalOutputTokens.toLocaleString()} tokens`,
      `Model:  ${this.model}`,
      `URL:    ${this.url}`,
    ].join("\n");
  }
}

export function createSimIntegratorClient(options: LlmClientOptions = {}): LlmClient {
  return new LlmClient(SIM_SPEC_SYSTEM_PROMPT, options);
}

export const SIM_SPEC_SYSTEM_PROMPT = `You are an expert at generating production-grade Sim.ai integrations.

SIM.AI 6-LAYER ARCHITECTURE:
1. Block (UI with operation dropdown, subBlocks, auth mode)
2. Tool (one per API endpoint, HTTP config, typed outputs)
3. Trigger (webhooks or polling, event parsers, formatInput)
4. Auth (OAuth/ApiKey/BotToken with correct visibility)
5. BlockMeta (tags, templates, skills for catalog)
6. Docs (auto-generated)

GOLDEN RULES (NEVER BREAK):
- Never guess output fields if schema unknown
- Never guess webhook payloads if unknown
- Never create separate block per operation (always grouped)
- Never group multiple operations into one tool
- Never expose secrets to LLM (visibility: hidden for auth tokens)

MUST-DO RULES:
- One tool per API endpoint (snake_case IDs: service_action)
- One grouped block with operation dropdown
- Param visibility: hidden (secrets), user-only (keys), user-or-llm (params)
- All outputs typed (never bare JSON)
- formatInput outputs = trigger outputs EXACTLY
- Register alphabetically in registries
- BlockMeta tags from whitelisted enum only

PARAM VISIBILITY:
- hidden: OAuth accessToken, internal system params
- user-only: API keys, bot tokens, account-specific IDs, webhook secrets
- user-or-llm: query parameters, filter fields, content fields, operation params
- llm-only: computed values (rare)

TOOL OUTPUT TYPES: string, number, boolean, json, file, file[], array, object

OUTPUT FORMAT: Always return ONLY valid JSON when asked. No markdown wrapping.

INTEGRATION TYPES (use exact values): AI, Analytics, Commerce, Communication, Databases, DevOps, Documents, Email, HR, Marketing, Observability, Productivity, Sales, Search, Security, Support, Payments

TAGS WHITELIST: AI, Analytics, Automation, Bot, Communication, CRM, Data, Databases, DevOps, Documents, Email, HR, Marketing, Observability, Productivity, Sales, Search, Security, Support, Payments, E-commerce, Integration`;
