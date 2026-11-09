import type { OrganizationCredentialType } from '@/lib/credential-groups/credential-types'
import {
  MANAGED_MCP_CONNECTOR_IDS,
  MANAGED_MCP_CONNECTORS,
} from '@/lib/credential-groups/managed-mcp-connectors'
import { CREDENTIAL_GROUP_PROVIDER_IDS } from '@/lib/credential-groups/provider-ids'
import {
  getCredentialGroupProviderFromProviderId,
  getCredentialGroupProviderService,
} from '@/lib/credential-groups/providers'

/**
 * Organization credential types resolved against provider service configs, which carry every
 * provider's icon; server callers read these, while contracts read the plain type list.
 */
export function organizationOAuthCredentialType(providerId: string): OrganizationCredentialType {
  return `oauth:${getCredentialGroupProviderFromProviderId(providerId)}`
}

export function getOrganizationCredentialTypeCatalog() {
  return [
    ...CREDENTIAL_GROUP_PROVIDER_IDS.map((provider) => ({
      id: `oauth:${provider}` as const,
      label: getCredentialGroupProviderService(provider).name,
    })),
    ...MANAGED_MCP_CONNECTOR_IDS.map((provider) => ({
      id: `mcp:${provider}` as const,
      label: MANAGED_MCP_CONNECTORS[provider].name,
    })),
    { id: 'personal_token:gitlab' as const, label: 'GitLab' },
  ].sort((left, right) => left.label.localeCompare(right.label))
}
