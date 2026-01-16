export type PollingProvider = 'google-email' | 'outlook'

export const POLLING_PROVIDERS: Record<PollingProvider, { displayName: string }> = {
  'google-email': { displayName: 'Gmail' },
  outlook: { displayName: 'Outlook' },
}

export function getProviderDisplayName(providerId: string): string {
  if (providerId === 'google-email') return 'Gmail'
  if (providerId === 'outlook') return 'Outlook'
  return providerId
}

export function isPollingProvider(provider: string): provider is PollingProvider {
  return provider === 'google-email' || provider === 'outlook'
}

/**
 * Maps an OAuth provider ID to its corresponding polling provider ID.
 * Since credential sets now store the OAuth provider ID directly, this is primarily
 * used in the credential selector to match OAuth providers to credential sets.
 */
export function getPollingProviderFromOAuth(oauthProviderId: string): PollingProvider | null {
  if (oauthProviderId === 'google-email') return 'google-email'
  if (oauthProviderId === 'outlook') return 'outlook'
  return null
}
