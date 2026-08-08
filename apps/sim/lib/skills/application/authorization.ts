import type { DelegatedPrincipal } from '@sim/auth/principal'
import type { WorkspaceDelegationPolicy } from '@/lib/core/application'

export const SKILL_DELEGATION_AUDIENCE = 'sim:skills'

export const skillDelegationPolicy = {
  audience: SKILL_DELEGATION_AUDIENCE,
  isWithinScope: (principal: DelegatedPrincipal) => principal.serviceId === 'copilot',
} as const satisfies WorkspaceDelegationPolicy<{
  workspaceId: string
  workspaceOrganizationId: string | null
  allowPersonalApiKeys: boolean
}>
