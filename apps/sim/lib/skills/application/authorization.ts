import type { WorkspaceDelegationPolicy } from '@/lib/core/application'

export const SKILL_DELEGATION_AUDIENCE = 'sim:skills'

export const skillDelegationPolicy = {
  audience: SKILL_DELEGATION_AUDIENCE,
  isWithinScope: () => true,
} as const satisfies WorkspaceDelegationPolicy<{
  workspaceId: string
  workspaceOrganizationId: string | null
  allowPersonalApiKeys: boolean
}>
