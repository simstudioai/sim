import type { OAuthServiceConfig } from '@/lib/oauth'
import { getServiceConfigByServiceId } from '@/lib/oauth'

export const CREDENTIAL_GROUP_STANDARD_OAUTH_PROVIDER_IDS = ['gmail', 'google-calendar'] as const

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
