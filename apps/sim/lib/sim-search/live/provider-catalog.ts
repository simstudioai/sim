interface LiveSearchProviderDefinition {
  origin: string | null
  credentialProviderIds: readonly string[]
  modes: readonly ('member' | 'service_account')[]
  savedMemberCredential?: boolean
}

/** Browser-safe capabilities; branding and setup fields live in source-catalog. */
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
  google_meet: {
    origin: 'https://meet.googleapis.com',
    credentialProviderIds: ['google-meet'],
    modes: ['member'],
  },
  zoom: {
    origin: 'https://mcp.zoom.us',
    credentialProviderIds: ['mcp:zoom'],
    modes: ['member'],
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
  jama: {
    origin: null,
    credentialProviderIds: ['jama-service-account'],
    modes: ['member'],
    savedMemberCredential: true,
  },
  flow: {
    origin: 'https://backend.branch.flowengineering.com',
    credentialProviderIds: ['flow-service-account'],
    modes: ['member'],
    savedMemberCredential: true,
  },
  gitlab: {
    origin: 'https://gitlab.com',
    credentialProviderIds: ['gitlab'],
    modes: ['service_account'],
  },
  linear: {
    origin: 'https://api.linear.app',
    credentialProviderIds: ['linear'],
    modes: ['member'],
  },
  lucid: {
    origin: 'https://mcp.lucid.app',
    credentialProviderIds: ['mcp:lucid'],
    modes: ['member'],
  },
  hex: {
    origin: 'https://app.hex.tech',
    credentialProviderIds: ['mcp:hex'],
    modes: ['member'],
  },
  hubspot: {
    origin: 'https://mcp.hubspot.com',
    credentialProviderIds: ['mcp:hubspot'],
    modes: ['member'],
  },
  fireflies: {
    origin: 'https://api.fireflies.ai',
    credentialProviderIds: ['mcp:fireflies'],
    modes: ['member'],
  },
  granola: {
    origin: 'https://mcp.granola.ai',
    credentialProviderIds: ['mcp:granola'],
    modes: ['member'],
  },
  notion: {
    origin: 'https://mcp.notion.com',
    credentialProviderIds: ['mcp:notion'],
    modes: ['member'],
  },
  coda: {
    origin: 'https://coda.io',
    credentialProviderIds: ['coda-service-account'],
    savedMemberCredential: true,
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

/** Saved credentials whose owner must prove the current provider identity before every Search use. */
export const SAVED_MEMBER_SEARCH_PROVIDER_IDS = LIVE_SEARCH_PROVIDER_IDS.flatMap((provider) => {
  const definition = LIVE_SEARCH_PROVIDER_CATALOG[provider]
  return 'savedMemberCredential' in definition && definition.savedMemberCredential
    ? [...definition.credentialProviderIds]
    : []
})
