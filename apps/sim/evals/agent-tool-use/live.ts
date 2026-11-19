import OpenAI from 'openai'
import type { OpenAICompatCreateCompletion } from '@/providers/openai-compat/streaming-tool-loop'

/**
 * Real-model transport for the eval harness. Any OpenAI-compatible provider
 * (OpenAI, DeepSeek, Groq, OpenRouter, …) works by passing its `baseURL`.
 *
 * The scripted suite stays the CI gate; this exists so the same scenarios can
 * be replayed against a live model on demand.
 */
export interface OpenAICompatLiveModelOptions {
  apiKey: string
  model: string
  baseURL?: string
  /** Per-request timeout in ms. Live model calls routinely exceed the default. */
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 120_000

export function createOpenAICompatLiveCompletion(
  options: OpenAICompatLiveModelOptions
): OpenAICompatCreateCompletion {
  const client = new OpenAI({
    apiKey: options.apiKey,
    ...(options.baseURL ? { baseURL: options.baseURL } : {}),
    timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxRetries: 2,
  })

  return async (params, requestOptions) =>
    client.chat.completions.create(
      {
        ...params,
        model: options.model,
        stream: true,
        // OpenAI-compatible providers require an opt-in to emit usage on streams.
        stream_options: { include_usage: true },
      },
      requestOptions
    )
}

/**
 * DeepSeek's OpenAI-compatible endpoint. Reads `DEEPSEEK_API_KEY` and the
 * optional `DEEPSEEK_BASE_URL` / `EVAL_MODEL` overrides.
 */
export function createDeepSeekLiveCompletion(
  model = process.env.EVAL_MODEL ?? 'deepseek-chat'
): OpenAICompatCreateCompletion {
  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) {
    throw new Error('DEEPSEEK_API_KEY is required for the live agent eval')
  }
  return createOpenAICompatLiveCompletion({
    apiKey,
    baseURL: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com',
    model,
    ...(process.env.EVAL_TIMEOUT_MS ? { timeoutMs: Number(process.env.EVAL_TIMEOUT_MS) } : {}),
  })
}
