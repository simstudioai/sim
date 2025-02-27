import { anthropicProvider } from './anthropic'
import { cerebrasProvider } from './cerebras'
import { deepseekProvider } from './deepseek'
import { googleProvider } from './google'
import { openaiProvider } from './openai'
import { ProviderConfig } from './types'
import { xAIProvider } from './xai'

export type ProviderId = 'openai' | 'anthropic' | 'google' | 'deepseek' | 'xai' | 'cerebras'

export const providers: Record<ProviderId, ProviderConfig> = {
  openai: openaiProvider,
  anthropic: anthropicProvider,
  google: googleProvider,
  deepseek: deepseekProvider,
  xai: xAIProvider,
  cerebras: cerebrasProvider,
}

export function getProvider(id: string): ProviderConfig | undefined {
  // Handle both formats: 'openai' and 'openai/chat'
  const providerId = id.split('/')[0] as ProviderId
  return providers[providerId]
}

export function getProviderChatId(providerId: ProviderId): string {
  return `${providerId}/chat`
}
