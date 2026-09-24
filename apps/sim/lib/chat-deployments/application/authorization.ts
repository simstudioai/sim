import type {
  WorkspaceAuthorizationContext,
  WorkspaceDelegationPolicy,
} from '@/lib/core/application'

/** Workspace-bound Copilot calls keep the same current role, capability and resource checks. */
export const chatDeploymentDelegationPolicy = {
  audience: 'sim:chat-deployments',
  isWithinScope: () => true,
} as const satisfies WorkspaceDelegationPolicy<WorkspaceAuthorizationContext>
