import type { Principal } from '@sim/auth/principal'

export function assertedWorkflowWorkspaceId(
  principal: Principal,
  assertedWorkspaceId?: string
): string | undefined {
  return (
    assertedWorkspaceId ??
    (principal.kind === 'workspace_api_key' ? principal.workspaceId : undefined)
  )
}
