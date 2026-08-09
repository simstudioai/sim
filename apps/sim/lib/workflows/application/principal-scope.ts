import type { Principal } from '@sim/auth/principal'

export function assertedWorkflowWorkspaceId(
  principal: Principal,
  assertedWorkspaceId?: string
): string | undefined {
  if (principal.kind === 'workspace_api_key' || principal.kind === 'delegated') {
    return principal.workspaceId
  }
  return assertedWorkspaceId
}
