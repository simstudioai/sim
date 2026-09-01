import type { CredentialGroupProviderAdapter } from '@/lib/credential-groups/provider-adapter'
import {
  type CredentialGroupOAuthProvider,
  type CredentialGroupProvider,
  getCredentialGroupProviderFromProviderId,
  isCredentialGroupApiKeyProvider,
} from '@/lib/credential-groups/providers'
import { slackCredentialGroupProviderAdapter } from '@/lib/credential-groups/slack-provider'
import { createStandardOAuthCredentialGroupProviderAdapter } from '@/lib/credential-groups/standard-oauth-provider'

/**
 * Keyed by the OAuth-only union. API-key providers enroll through a verifier
 * (`api-key-providers/registry.ts`) and have no authorization URL, token exchange, or
 * refresh to implement, so they are deliberately absent rather than stubbed.
 */
const CREDENTIAL_GROUP_PROVIDER_ADAPTERS: Record<
  CredentialGroupOAuthProvider,
  CredentialGroupProviderAdapter
> = {
  gmail: createStandardOAuthCredentialGroupProviderAdapter('gmail'),
  'google-calendar': createStandardOAuthCredentialGroupProviderAdapter('google-calendar'),
  confluence: createStandardOAuthCredentialGroupProviderAdapter('confluence'),
  jira: createStandardOAuthCredentialGroupProviderAdapter('jira'),
  airtable: createStandardOAuthCredentialGroupProviderAdapter('airtable'),
  asana: createStandardOAuthCredentialGroupProviderAdapter('asana'),
  attio: createStandardOAuthCredentialGroupProviderAdapter('attio'),
  box: createStandardOAuthCredentialGroupProviderAdapter('box'),
  calcom: createStandardOAuthCredentialGroupProviderAdapter('calcom'),
  clickup: createStandardOAuthCredentialGroupProviderAdapter('clickup'),
  docusign: createStandardOAuthCredentialGroupProviderAdapter('docusign'),
  hubspot: createStandardOAuthCredentialGroupProviderAdapter('hubspot'),
  linear: createStandardOAuthCredentialGroupProviderAdapter('linear'),
  monday: createStandardOAuthCredentialGroupProviderAdapter('monday'),
  notion: createStandardOAuthCredentialGroupProviderAdapter('notion'),
  dropbox: createStandardOAuthCredentialGroupProviderAdapter('dropbox'),
  linkedin: createStandardOAuthCredentialGroupProviderAdapter('linkedin'),
  pipedrive: createStandardOAuthCredentialGroupProviderAdapter('pipedrive'),
  salesforce: createStandardOAuthCredentialGroupProviderAdapter('salesforce'),
  wordpress: createStandardOAuthCredentialGroupProviderAdapter('wordpress'),
  zoom: createStandardOAuthCredentialGroupProviderAdapter('zoom'),
  slack: slackCredentialGroupProviderAdapter,
}

export function getCredentialGroupProviderAdapter(
  provider: CredentialGroupProvider
): CredentialGroupProviderAdapter {
  if (isCredentialGroupApiKeyProvider(provider)) {
    throw new Error(`Credential Group provider ${provider} enrolls with an API key, not OAuth`)
  }
  return CREDENTIAL_GROUP_PROVIDER_ADAPTERS[provider]
}

export function getCredentialGroupProviderAdapterByProviderId(
  providerId: string
): CredentialGroupProviderAdapter {
  return getCredentialGroupProviderAdapter(getCredentialGroupProviderFromProviderId(providerId))
}
