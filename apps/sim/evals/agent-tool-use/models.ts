import { createOpenAICompatLiveCompletion } from '@/evals/agent-tool-use/live'
import type { OpenAICompatCreateCompletion } from '@/providers/openai-compat/streaming-tool-loop'

/**
 * Provider registry for the model-comparison live suite.
 *
 * A model spec is `provider:model` (or a bare model id, which defaults to
 * DeepSeek). Each provider reads its key from the matching environment
 * variable, so adding a provider is one entry plus its key.
 */
export interface LiveProviderSpec {
  id: string
  label: string
  baseURL?: string
  keyEnv: string
  baseURLEnv?: string
}

const PROVIDERS: Record<string, LiveProviderSpec> = {
  deepseek: {
    id: 'deepseek',
    label: 'DeepSeek',
    baseURL: 'https://api.deepseek.com',
    baseURLEnv: 'DEEPSEEK_BASE_URL',
    keyEnv: 'DEEPSEEK_API_KEY',
  },
  openai: { id: 'openai', label: 'OpenAI', keyEnv: 'OPENAI_API_KEY' },
  groq: {
    id: 'groq',
    label: 'Groq',
    baseURL: 'https://api.groq.com/openai/v1',
    keyEnv: 'GROQ_API_KEY',
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    baseURL: 'https://openrouter.ai/api/v1',
    keyEnv: 'OPENROUTER_API_KEY',
  },
}

export interface LiveModelSpec {
  provider: LiveProviderSpec
  model: string
}

/** Resolves `provider:model`, or a bare model id against DeepSeek. */
export function resolveLiveModelSpec(spec: string): LiveModelSpec {
  const separator = spec.indexOf(':')
  if (separator === -1) {
    return { provider: PROVIDERS.deepseek, model: spec.trim() }
  }
  const providerId = spec.slice(0, separator).trim().toLowerCase()
  const provider = PROVIDERS[providerId]
  if (!provider) {
    throw new Error(`Unknown eval provider "${providerId}" in spec "${spec}"`)
  }
  return { provider, model: spec.slice(separator + 1).trim() }
}

export function parseLiveModels(value: string | undefined): LiveModelSpec[] {
  return (value ?? 'deepseek:deepseek-chat')
    .split(',')
    .map((spec) => spec.trim())
    .filter(Boolean)
    .map(resolveLiveModelSpec)
}

/** Builds a real completion for one resolved `provider:model` spec. */
export function createLiveModelCompletion(spec: LiveModelSpec): OpenAICompatCreateCompletion {
  const apiKey = process.env[spec.provider.keyEnv]
  if (!apiKey) {
    throw new Error(`${spec.provider.keyEnv} is required for ${spec.provider.label}/${spec.model}`)
  }
  const baseURL = spec.provider.baseURLEnv
    ? (process.env[spec.provider.baseURLEnv] ?? spec.provider.baseURL)
    : spec.provider.baseURL

  return createOpenAICompatLiveCompletion({
    apiKey,
    model: spec.model,
    ...(baseURL ? { baseURL } : {}),
    ...(process.env.EVAL_TIMEOUT_MS ? { timeoutMs: Number(process.env.EVAL_TIMEOUT_MS) } : {}),
  })
}
