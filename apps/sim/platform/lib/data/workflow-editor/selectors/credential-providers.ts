import type { ComponentType } from 'react'
import { OAUTH_PROVIDERS, type OAuthProvider, parseProvider } from '@/lib/oauth'

type ProviderIcon = ComponentType<{ className?: string }>

/** A provider's display name: its configured name, or its id in title case. */
export function getOAuthProviderName(provider: string): string {
  const { baseProvider } = parseProvider(provider as OAuthProvider)
  const config = OAUTH_PROVIDERS[baseProvider]
  if (config) return config.name
  return provider
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

/** A provider's brand mark, or `null` when the provider is not configured. */
export function getOAuthProviderIcon(provider: string): ProviderIcon | null {
  const { baseProvider } = parseProvider(provider as OAuthProvider)
  return (OAUTH_PROVIDERS[baseProvider]?.icon as ProviderIcon | undefined) ?? null
}
