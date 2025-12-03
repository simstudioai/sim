import { env } from '@/lib/core/config/env'

/**
 * Rotates through available API keys for a provider
 * @param provider - The provider to get a key for (e.g., 'openai')
 * @returns The selected API key
 * @throws Error if no API keys are configured for rotation
 */
export function getRotatingApiKey(provider: string): string {
  if (provider !== 'openai' && provider !== 'anthropic' && provider !== 'gemini') {
    throw new Error(`No rotation implemented for provider: ${provider}`)
  }

  const keys = []

  if (provider === 'openai') {
    if (env.OPENAI_API_KEY_1) keys.push(env.OPENAI_API_KEY_1)
    if (env.OPENAI_API_KEY_2) keys.push(env.OPENAI_API_KEY_2)
    if (env.OPENAI_API_KEY_3) keys.push(env.OPENAI_API_KEY_3)
  } else if (provider === 'anthropic') {
    if (env.ANTHROPIC_API_KEY_1) keys.push(env.ANTHROPIC_API_KEY_1)
    if (env.ANTHROPIC_API_KEY_2) keys.push(env.ANTHROPIC_API_KEY_2)
    if (env.ANTHROPIC_API_KEY_3) keys.push(env.ANTHROPIC_API_KEY_3)
  } else if (provider === 'gemini') {
    if (env.GEMINI_API_KEY_1) keys.push(env.GEMINI_API_KEY_1)
    if (env.GEMINI_API_KEY_2) keys.push(env.GEMINI_API_KEY_2)
    if (env.GEMINI_API_KEY_3) keys.push(env.GEMINI_API_KEY_3)
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
