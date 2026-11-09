import { MANAGED_MCP_CONNECTOR_IDS } from '@/lib/credential-groups/managed-mcp-connectors'
import { CREDENTIAL_GROUP_PROVIDER_IDS } from '@/lib/credential-groups/provider-ids'

export type OrganizationCredentialType =
  | `oauth:${(typeof CREDENTIAL_GROUP_PROVIDER_IDS)[number]}`
  | `mcp:${(typeof MANAGED_MCP_CONNECTOR_IDS)[number]}`
  | 'personal_token:gitlab'

export const ORGANIZATION_CREDENTIAL_TYPES: readonly OrganizationCredentialType[] = [
  ...CREDENTIAL_GROUP_PROVIDER_IDS.map((provider) => `oauth:${provider}` as const),
  ...MANAGED_MCP_CONNECTOR_IDS.map((provider) => `mcp:${provider}` as const),
  'personal_token:gitlab',
]

export function isOrganizationCredentialType(value: string): value is OrganizationCredentialType {
  return ORGANIZATION_CREDENTIAL_TYPES.some((type) => type === value)
}
