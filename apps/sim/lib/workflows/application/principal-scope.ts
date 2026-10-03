import type { Principal } from '@sim/auth/principal'
import {
  type ActiveWorkflowApplicationContext,
  resolveActiveWorkflowApplicationContext,
} from '@/lib/workflows/application/context'

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

/**
 * Resolves the active workflow a use-case input names, asserting the caller's
 * workspace only where {@link assertedWorkflowWorkspaceId} keeps it. Pass it as
 * `resolveContext: resolvePrincipalWorkflowContext<Input>`.
 */
export function resolvePrincipalWorkflowContext<
  I extends { workflowId: string; assertedWorkspaceId?: string },
>({
  principal,
  input,
}: {
  principal: Principal
  input: I
}): Promise<ActiveWorkflowApplicationContext> {
  return resolveActiveWorkflowApplicationContext({
    workflowId: input.workflowId,
    assertedWorkspaceId: assertedWorkflowWorkspaceId(principal, input.assertedWorkspaceId),
  })
}
