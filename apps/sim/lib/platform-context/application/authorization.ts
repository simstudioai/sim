import type { DelegatedPrincipal } from '@sim/auth/principal'
import type { ActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'

export const PLATFORM_CONTEXT_DELEGATION_AUDIENCE = 'sim:platform-context'

export const platformContextDelegationPolicy = {
  audience: PLATFORM_CONTEXT_DELEGATION_AUDIENCE,
  isWithinScope: (
    principal: DelegatedPrincipal,
    context: ActiveWorkspaceApplicationContext
  ): boolean => principal.workspaceId === context.workspaceId,
} as const
