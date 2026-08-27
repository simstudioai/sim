import type { CredentialGroupProviderAdapter } from '@/lib/credential-groups/provider-adapter'
import {
  type CredentialGroupProvider,
  getCredentialGroupProviderFromProviderId,
} from '@/lib/credential-groups/providers'
import { slackCredentialGroupProviderAdapter } from '@/lib/credential-groups/slack-provider'
import { createStandardOAuthCredentialGroupProviderAdapter } from '@/lib/credential-groups/standard-oauth-provider'

const CREDENTIAL_GROUP_PROVIDER_ADAPTERS: Record<
  CredentialGroupProvider,
  CredentialGroupProviderAdapter
> = {
  gmail: createStandardOAuthCredentialGroupProviderAdapter('gmail'),
  'google-calendar': createStandardOAuthCredentialGroupProviderAdapter('google-calendar'),
  confluence: createStandardOAuthCredentialGroupProviderAdapter('confluence'),
  jira: createStandardOAuthCredentialGroupProviderAdapter('jira'),
  slack: slackCredentialGroupProviderAdapter,
}

export function getCredentialGroupProviderAdapter(
  provider: CredentialGroupProvider
): CredentialGroupProviderAdapter {
  return CREDENTIAL_GROUP_PROVIDER_ADAPTERS[provider]
}

export function getCredentialGroupProviderAdapterByProviderId(
  providerId: string
): CredentialGroupProviderAdapter {
  return getCredentialGroupProviderAdapter(getCredentialGroupProviderFromProviderId(providerId))
}
