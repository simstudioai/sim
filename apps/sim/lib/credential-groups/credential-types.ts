import {
  MANAGED_MCP_CONNECTOR_IDS,
  MANAGED_MCP_CONNECTORS,
} from '@/lib/credential-groups/managed-mcp-connectors'
import {
  CREDENTIAL_GROUP_PROVIDER_IDS,
  getCredentialGroupProviderFromProviderId,
  getCredentialGroupProviderService,
} from '@/lib/credential-groups/providers'

export type OrganizationCredentialType =
  | `oauth:${(typeof CREDENTIAL_GROUP_PROVIDER_IDS)[number]}`
  | `mcp:${(typeof MANAGED_MCP_CONNECTOR_IDS)[number]}`
  | 'personal_token:gitlab'
  | 'api_key'

export const ORGANIZATION_CREDENTIAL_TYPES: readonly OrganizationCredentialType[] = [
  ...CREDENTIAL_GROUP_PROVIDER_IDS.map((provider) => `oauth:${provider}` as const),
  ...MANAGED_MCP_CONNECTOR_IDS.map((provider) => `mcp:${provider}` as const),
  'personal_token:gitlab',
  'api_key',
]

export function isOrganizationCredentialType(value: string): value is OrganizationCredentialType {
  return ORGANIZATION_CREDENTIAL_TYPES.some((type) => type === value)
}

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
    { id: 'api_key' as const, label: 'API keys' },
  ].sort((left, right) => left.label.localeCompare(right.label))
}
