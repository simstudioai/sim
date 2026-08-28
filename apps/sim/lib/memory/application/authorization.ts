import type { WorkspaceDelegationPolicy } from '@/lib/core/application'
import type { ActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'

export const MEMORY_DELEGATION_AUDIENCE = 'sim:memory'

export const memoryDelegationPolicy: WorkspaceDelegationPolicy<ActiveWorkspaceApplicationContext> =
  {
    audience: MEMORY_DELEGATION_AUDIENCE,
    isWithinScope: () => true,
  }
