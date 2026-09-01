import { env } from '@/lib/core/config/env'
import { LLM_KEY_POOLS } from '@/lib/core/config/env-capabilities'

/**
 * Rotates through available API keys for a provider
 * @param provider - The provider to get a key for (e.g., 'openai')
 * @returns The selected API key
 * @throws Error if no API keys are configured for rotation
 */
export function getRotatingApiKey(provider: string): string {
  if (!(provider in LLM_KEY_POOLS)) {
    throw new Error(`No rotation implemented for provider: ${provider}`)
  }

  const definition = LLM_KEY_POOLS[provider as keyof typeof LLM_KEY_POOLS]
  const keys = definition.keys.map((key) => env[key]).filter((key): key is string => Boolean(key))
  if (keys.length === 0 && 'fallbackKey' in definition) {
    const fallback = env[definition.fallbackKey]
    if (fallback) keys.push(fallback)
  }

  if (keys.length === 0) {
    throw new Error(
      `No API keys configured for rotation. Please configure ${provider.toUpperCase()}_API_KEY_1, ${provider.toUpperCase()}_API_KEY_2, or ${provider.toUpperCase()}_API_KEY_3.`
    )
  }

  // Simple round-robin rotation based on current minute
  // This distributes load across keys and is stateless
  const currentMinute = new Date().getMinutes()
  const keyIndex = currentMinute % keys.length

  return keys[keyIndex]
}
