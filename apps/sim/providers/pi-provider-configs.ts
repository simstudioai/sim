import type { BYOKProviderId } from '@/tools/types'

export interface PiProviderConfig {
  id: string
  piProviderId: string
  apiKeyEnvVar: string
  workspaceBYOKProviderId?: BYOKProviderId
}

/**
 * Sim providers the Pi Coding Agent can run with one API key. `piProviderId`
 * is explicit because Sim's `kimi` provider maps to Pi's `moonshotai`
 * provider; the remaining provider IDs currently match.
 *
 * Providers that require richer configuration remain intentionally excluded:
 * Vertex OAuth, Bedrock IAM, Azure endpoint configuration, OAuth-only providers,
 * and user-supplied base-URL providers such as Ollama, vLLM, and LiteLLM.
 */
export const PI_PROVIDER_CONFIGS = [
  {
    id: 'anthropic',
    piProviderId: 'anthropic',
    apiKeyEnvVar: 'ANTHROPIC_API_KEY',
    workspaceBYOKProviderId: 'anthropic',
  },
  {
    id: 'openai',
    piProviderId: 'openai',
    apiKeyEnvVar: 'OPENAI_API_KEY',
    workspaceBYOKProviderId: 'openai',
  },
  {
    id: 'google',
    piProviderId: 'google',
    apiKeyEnvVar: 'GEMINI_API_KEY',
    workspaceBYOKProviderId: 'google',
  },
  {
    id: 'xai',
    piProviderId: 'xai',
    apiKeyEnvVar: 'XAI_API_KEY',
    workspaceBYOKProviderId: 'xai',
  },
  { id: 'deepseek', piProviderId: 'deepseek', apiKeyEnvVar: 'DEEPSEEK_API_KEY' },
  {
    id: 'mistral',
    piProviderId: 'mistral',
    apiKeyEnvVar: 'MISTRAL_API_KEY',
    workspaceBYOKProviderId: 'mistral',
  },
  { id: 'groq', piProviderId: 'groq', apiKeyEnvVar: 'GROQ_API_KEY' },
  { id: 'cerebras', piProviderId: 'cerebras', apiKeyEnvVar: 'CEREBRAS_API_KEY' },
  { id: 'openrouter', piProviderId: 'openrouter', apiKeyEnvVar: 'OPENROUTER_API_KEY' },
  {
    id: 'fireworks',
    piProviderId: 'fireworks',
    apiKeyEnvVar: 'FIREWORKS_API_KEY',
    workspaceBYOKProviderId: 'fireworks',
  },
  {
    id: 'together',
    piProviderId: 'together',
    apiKeyEnvVar: 'TOGETHER_API_KEY',
    workspaceBYOKProviderId: 'together',
  },
  { id: 'nvidia', piProviderId: 'nvidia', apiKeyEnvVar: 'NVIDIA_API_KEY' },
  {
    id: 'zai',
    piProviderId: 'zai',
    apiKeyEnvVar: 'ZAI_API_KEY',
    workspaceBYOKProviderId: 'zai',
  },
  {
    id: 'kimi',
    piProviderId: 'moonshotai',
    apiKeyEnvVar: 'MOONSHOT_API_KEY',
    workspaceBYOKProviderId: 'kimi',
  },
] as const satisfies readonly PiProviderConfig[]

export type PiSupportedProvider = (typeof PI_PROVIDER_CONFIGS)[number]['id']
