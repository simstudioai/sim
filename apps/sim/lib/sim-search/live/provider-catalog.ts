interface LiveSearchProviderDefinition {
  origin: string
  credentialProviderIds: readonly string[]
  modes: readonly ('member' | 'service_account')[]
}

/** Browser-safe capabilities; branding and setup fields remain in ConnectorMeta. */
export const LIVE_SEARCH_PROVIDER_CATALOG = {
  google_drive: {
    origin: 'https://www.googleapis.com',
    credentialProviderIds: ['google-drive', 'google-docs', 'google-sheets', 'google-slides'],
    modes: ['member', 'service_account'],
  },
  gmail: {
    origin: 'https://gmail.googleapis.com',
    credentialProviderIds: ['google-email', 'gmail'],
    modes: ['member', 'service_account'],
  },
  google_calendar: {
    origin: 'https://www.googleapis.com',
    credentialProviderIds: ['google-calendar'],
    modes: ['member', 'service_account'],
  },
  slack: {
    origin: 'https://slack.com',
    credentialProviderIds: ['slack'],
    modes: ['member'],
  },
  jira: {
    origin: 'https://api.atlassian.com',
    credentialProviderIds: ['jira'],
    modes: ['member'],
  },
  confluence: {
    origin: 'https://api.atlassian.com',
    credentialProviderIds: ['confluence'],
    modes: ['member', 'service_account'],
  },
  github: {
    origin: 'https://api.github.com',
    credentialProviderIds: ['github-repositories'],
    modes: ['member', 'service_account'],
  },
  gitlab: {
    origin: 'https://gitlab.com',
    credentialProviderIds: ['gitlab'],
    modes: ['service_account'],
  },
  coda: {
    origin: 'https://coda.io',
    credentialProviderIds: ['coda-service-account'],
    modes: ['member', 'service_account'],
  },
} as const satisfies Record<string, LiveSearchProviderDefinition>

export type LiveSearchProviderId = keyof typeof LIVE_SEARCH_PROVIDER_CATALOG

export const LIVE_SEARCH_PROVIDER_IDS = Object.keys(
  LIVE_SEARCH_PROVIDER_CATALOG
) as LiveSearchProviderId[]

export function liveSearchProviderForCredential(
  credentialProviderId: string
): LiveSearchProviderId | undefined {
  return LIVE_SEARCH_PROVIDER_IDS.find((provider) =>
    (LIVE_SEARCH_PROVIDER_CATALOG[provider].credentialProviderIds as readonly string[]).includes(
      credentialProviderId
    )
  )
}

export function supportsLiveSearchMode(
  provider: LiveSearchProviderId,
  mode: 'member' | 'service_account'
): boolean {
  return (LIVE_SEARCH_PROVIDER_CATALOG[provider].modes as readonly string[]).includes(mode)
}
