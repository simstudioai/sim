import type { Principal } from '@sim/auth/principal'

/** Leaves scoped-principal workspace mismatches to canonical authorization so they remain 403s. */
export function assertedWorkflowWorkspaceId(
  principal: Principal,
  assertedWorkspaceId?: string
): string | undefined {
  if (principal.kind === 'workspace_api_key' || principal.kind === 'delegated') {
    return undefined
  }
  return assertedWorkspaceId
}
