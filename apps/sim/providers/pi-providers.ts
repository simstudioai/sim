/**
 * Providers the Pi Coding Agent can run with a single API key. This list is the
 * single source of truth for both the cloud env-var mapping (Pi handler) and the
 * Pi block's model dropdown (UI), so the block only offers Pi-runnable models.
 *
 * Excludes providers Pi's key-based flow can't drive: ones needing richer config
 * (Vertex OAuth, Bedrock IAM, Azure endpoint+key) and base-URL providers
 * (Ollama, vLLM, LiteLLM, Together, Baseten, Ollama Cloud).
 */
export const PI_SUPPORTED_PROVIDER_IDS = [
  'anthropic',
  'openai',
  'google',
  'xai',
  'deepseek',
  'mistral',
  'groq',
  'cerebras',
  'openrouter',
] as const

export type PiSupportedProvider = (typeof PI_SUPPORTED_PROVIDER_IDS)[number]

const PI_SUPPORTED_PROVIDER_SET = new Set<string>(PI_SUPPORTED_PROVIDER_IDS)

/** Whether the Pi Coding Agent can run a given provider via a single API key. */
export function isPiSupportedProvider(providerId: string): providerId is PiSupportedProvider {
  return PI_SUPPORTED_PROVIDER_SET.has(providerId)
}
