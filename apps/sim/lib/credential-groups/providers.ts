import type { OAuthServiceConfig } from '@/lib/oauth'
import { getServiceConfigByServiceId } from '@/lib/oauth'

export const CREDENTIAL_GROUP_STANDARD_OAUTH_PROVIDER_IDS = [
  'gmail',
  'google-calendar',
  'google-drive',
  'confluence',
  'jira',
  'airtable',
  'asana',
  'attio',
  'box',
  'calcom',
  'clickup',
  'docusign',
  'dropbox',
  'hubspot',
  'linear',
  'linkedin',
  'monday',
  'notion',
  'pipedrive',
  'salesforce',
  'wordpress',
  'zoom',
] as const

export type CredentialGroupStandardOAuthProvider =
  (typeof CREDENTIAL_GROUP_STANDARD_OAUTH_PROVIDER_IDS)[number]

export const CREDENTIAL_GROUP_PROVIDER_IDS = [
  ...CREDENTIAL_GROUP_STANDARD_OAUTH_PROVIDER_IDS,
  'slack',
] as const

export type CredentialGroupProvider = (typeof CREDENTIAL_GROUP_PROVIDER_IDS)[number]

export interface CredentialGroupProviderSupport {
  serviceId: string
  description: string
  configuration: 'oauth' | 'slack_custom_bot'
}

const CREDENTIAL_GROUP_PROVIDER_SUPPORT: Record<
  CredentialGroupProvider,
  CredentialGroupProviderSupport
> = {
  gmail: {
    serviceId: 'gmail',
    description: 'Let each person connect one Gmail account',
    configuration: 'oauth',
  },
  'google-calendar': {
    serviceId: 'google-calendar',
    description: 'Let each person connect one Google Calendar account',
    configuration: 'oauth',
  },
  'google-drive': {
    serviceId: 'google-drive',
    description: 'Let each person connect one Google Drive account',
    configuration: 'oauth',
  },
  confluence: {
    serviceId: 'confluence',
    description: 'Let each person connect one Confluence account',
    configuration: 'oauth',
  },
  jira: {
    serviceId: 'jira',
    description: 'Let each person connect one Jira account',
    configuration: 'oauth',
  },
  airtable: {
    serviceId: 'airtable',
    description: 'Let each person connect one Airtable account',
    configuration: 'oauth',
  },
  asana: {
    serviceId: 'asana',
    description: 'Let each person connect one Asana account',
    configuration: 'oauth',
  },
  attio: {
    serviceId: 'attio',
    description: 'Let each person connect one Attio account',
    configuration: 'oauth',
  },
  box: {
    serviceId: 'box',
    description: 'Let each person connect one Box account',
    configuration: 'oauth',
  },
  calcom: {
    serviceId: 'calcom',
    description: 'Let each person connect one Cal.com account',
    configuration: 'oauth',
  },
  clickup: {
    serviceId: 'clickup',
    description: 'Let each person connect one ClickUp account',
    configuration: 'oauth',
  },
  hubspot: {
    serviceId: 'hubspot',
    description: 'Let each person connect one HubSpot account',
    configuration: 'oauth',
  },
  linear: {
    serviceId: 'linear',
    description: 'Let each person connect one Linear account',
    configuration: 'oauth',
  },
  monday: {
    serviceId: 'monday',
    description: 'Let each person connect one monday.com account',
    configuration: 'oauth',
  },
  notion: {
    serviceId: 'notion',
    description: 'Let each person connect one Notion account',
    configuration: 'oauth',
  },
  docusign: {
    serviceId: 'docusign',
    description: 'Let each person connect one DocuSign account',
    configuration: 'oauth',
  },
  dropbox: {
    serviceId: 'dropbox',
    description: 'Let each person connect one Dropbox account',
    configuration: 'oauth',
  },
  linkedin: {
    serviceId: 'linkedin',
    description: 'Let each person connect one LinkedIn account',
    configuration: 'oauth',
  },
  pipedrive: {
    serviceId: 'pipedrive',
    description: 'Let each person connect one Pipedrive account',
    configuration: 'oauth',
  },
  salesforce: {
    serviceId: 'salesforce',
    description: 'Let each person connect one Salesforce account',
    configuration: 'oauth',
  },
  wordpress: {
    serviceId: 'wordpress',
    description: 'Let each person connect one WordPress.com account',
    configuration: 'oauth',
  },
  zoom: {
    serviceId: 'zoom',
    description: 'Let each person connect one Zoom account',
    configuration: 'oauth',
  },
  slack: {
    serviceId: 'slack',
    description: 'Let each person connect through your custom Slack app',
    configuration: 'slack_custom_bot',
  },
}

export function isCredentialGroupProvider(value: string): value is CredentialGroupProvider {
  return CREDENTIAL_GROUP_PROVIDER_IDS.some((provider) => provider === value)
}

export function isCredentialGroupStandardOAuthProvider(
  value: CredentialGroupProvider
): value is CredentialGroupStandardOAuthProvider {
  return CREDENTIAL_GROUP_STANDARD_OAUTH_PROVIDER_IDS.some((provider) => provider === value)
}

export function getCredentialGroupProviderService(
  provider: CredentialGroupProvider
): OAuthServiceConfig {
  const support = CREDENTIAL_GROUP_PROVIDER_SUPPORT[provider]
  const service = getServiceConfigByServiceId(support.serviceId)
  if (!service) {
    throw new Error(
      `Credential Group provider ${provider} references missing OAuth service ${support.serviceId}`
    )
  }
  return service
}

export function getCredentialGroupProviderSupport(
  provider: CredentialGroupProvider
): CredentialGroupProviderSupport {
  return CREDENTIAL_GROUP_PROVIDER_SUPPORT[provider]
}

export function getCredentialGroupProviderId(provider: CredentialGroupProvider): string {
  return getCredentialGroupProviderService(provider).providerId
}

export function getCredentialGroupProviderFromProviderId(
  providerId: string
): CredentialGroupProvider {
  const provider = CREDENTIAL_GROUP_PROVIDER_IDS.find(
    (candidate) => getCredentialGroupProviderId(candidate) === providerId
  )
  if (!provider) throw new Error(`Unsupported managed credential provider: ${providerId}`)
  return provider
}

export function getCredentialGroupStandardOAuthProviderFromProviderId(
  providerId: string
): CredentialGroupStandardOAuthProvider {
  const provider = CREDENTIAL_GROUP_STANDARD_OAUTH_PROVIDER_IDS.find(
    (candidate) => getCredentialGroupProviderId(candidate) === providerId
  )
  if (!provider) throw new Error(`Unsupported managed OAuth provider: ${providerId}`)
  return provider
}
