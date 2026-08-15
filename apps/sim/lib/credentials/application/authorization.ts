import type { WorkspaceDelegationPolicy } from '@/lib/core/application'

export const CREDENTIAL_DELEGATION_AUDIENCE = 'sim:credentials'

export const credentialDelegationPolicy = {
  audience: CREDENTIAL_DELEGATION_AUDIENCE,
  isWithinScope: () => true,
} as const satisfies WorkspaceDelegationPolicy<{
  workspaceId: string
  workspaceOrganizationId: string | null
  allowPersonalApiKeys: boolean
}>
