import type { WorkspaceDelegationPolicy } from '@/lib/core/application'

export const CUSTOM_TOOL_DELEGATION_AUDIENCE = 'sim:custom-tools'

export const customToolDelegationPolicy = {
  audience: CUSTOM_TOOL_DELEGATION_AUDIENCE,
  isWithinScope: () => true,
} as const satisfies WorkspaceDelegationPolicy<{
  workspaceId: string
  workspaceOrganizationId: string | null
  allowPersonalApiKeys: boolean
}>
