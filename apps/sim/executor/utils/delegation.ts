import type { GenerateInternalDelegationTokenInput } from '@/lib/auth/internal'

/**
 * Binds the running execution to a delegation only when it targets the workflow that
 * is actually running.
 *
 * A child workflow is a separate resource and binds on its own id, so forwarding the
 * parent's `executionId` would assert a run that does not cover the target and the
 * delegation would fail to bind. Callers spread the result into their delegation input.
 *
 * Kept free of runtime imports so client-reachable modules can read it without pulling
 * in the executor graph.
 */
export function executionScopeForTarget(
  context: { workflowId?: string; executionId?: string },
  targetWorkflowId: string
): Pick<GenerateInternalDelegationTokenInput, 'executionId'> {
  return context.workflowId === targetWorkflowId && context.executionId
    ? { executionId: context.executionId }
    : {}
}
