import {
  type BoundWorkflowExecutionPrincipal,
  bindPrincipalExecutionMetadata,
  enterPrincipalWorkflowExecution,
  type WorkflowExecutionAuthority,
  type WorkflowExecutionPrincipal,
  withPrincipalExecutionActor,
} from '@sim/auth/principal'

export interface CreateTestRuntimePrincipalOptions {
  principal?: WorkflowExecutionPrincipal
  executionId?: string
  rootWorkflowId?: string
  currentWorkflow?: WorkflowExecutionAuthority
  compatibilityActorUserId?: string
}

/** Builds test execution identity exclusively through the canonical auth-owned binders. */
export function createTestRuntimePrincipal(
  options: CreateTestRuntimePrincipalOptions = {}
): BoundWorkflowExecutionPrincipal {
  const principal =
    options.principal ?? ({ kind: 'session', userId: 'user-1', sessionId: 'session-1' } as const)
  const rootWorkflowId = options.rootWorkflowId ?? 'workflow-1'
  const currentWorkflow =
    options.currentWorkflow ?? ({ workflowId: rootWorkflowId, mode: 'draft' } as const)
  const root = bindPrincipalExecutionMetadata(principal, {
    executionId: options.executionId ?? 'execution-1',
    rootWorkflowId,
    currentWorkflow:
      currentWorkflow.workflowId === rootWorkflowId
        ? currentWorkflow
        : { workflowId: rootWorkflowId, mode: 'draft' },
  })
  const bound =
    currentWorkflow.workflowId === rootWorkflowId
      ? root
      : enterPrincipalWorkflowExecution(root, currentWorkflow)

  return options.compatibilityActorUserId !== undefined
    ? withPrincipalExecutionActor(bound, options.compatibilityActorUserId)
    : bound
}
