import type {
  WorkspaceAuthorizationContext,
  WorkspaceDelegationPolicy,
} from '@/lib/core/application'

/** Workspace-bound Copilot calls keep the same current role, capability and resource checks. */
export const catalogDelegationPolicy = {
  audience: 'sim:catalog',
  isWithinScope: () => true,
} as const satisfies WorkspaceDelegationPolicy<WorkspaceAuthorizationContext>
