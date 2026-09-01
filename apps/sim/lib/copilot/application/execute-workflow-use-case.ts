import { createCopilotApplicationAdapter } from '@/lib/copilot/application/application-adapter'
import { messageForCopilotApplicationError } from '@/lib/copilot/application/error'
import {
  COPILOT_APPLICATION_DELEGATION_TTL_MS,
  type CopilotExecutionContext,
  createCopilotApplicationPrincipal,
  requireTrustedCopilotExecutionContext,
} from '@/lib/copilot/auth/application-delegation'
import type { OperationUseCase } from '@/lib/core/application'
import { workflowDelegationPolicy } from '@/lib/workflows/application/authorization'
import { type WorkflowOperation, workflowOperations } from '@/lib/workflows/application/operations'
import {
  type ResolveWorkflowOutputsInput,
  type ResolveWorkflowOutputsResult,
  resolveWorkflowOutputs,
} from '@/lib/workflows/application/resolve-workflow-outputs'

export type CopilotWorkflowDelegationContext = CopilotExecutionContext

const workflowDelegation = {
  audience: workflowDelegationPolicy.audience,
  ttlMs: COPILOT_APPLICATION_DELEGATION_TTL_MS,
  createDelegationId: (context: Parameters<typeof createCopilotApplicationPrincipal>[0]) =>
    `copilot-tool:${context.toolCallId}`,
} as const

const executeWorkflowUseCase = createCopilotApplicationAdapter<WorkflowOperation>({
  domain: 'workflow',
  delegation: workflowDelegation,
  operations: workflowOperations,
})

/** Enters a registered workflow use case with identity derived only from trusted tool context. */
export function executeCopilotWorkflowUseCase<O extends WorkflowOperation, I, R>(
  context: CopilotWorkflowDelegationContext | undefined,
  useCase: OperationUseCase<O, I, R>,
  input: I
): Promise<R> {
  return executeWorkflowUseCase(context, useCase, input)
}

/** Resolves workflow output metadata through one fixed authorized Workflow command. */
export function executeCopilotResolveWorkflowOutputs(
  context: CopilotWorkflowDelegationContext | undefined,
  input: ResolveWorkflowOutputsInput
): Promise<ResolveWorkflowOutputsResult> {
  return resolveWorkflowOutputs.execute({
    principal: createCopilotApplicationPrincipal(
      requireTrustedCopilotExecutionContext(context),
      workflowDelegation
    ),
    input,
  })
}

/** Projects actionable application errors without exposing infrastructure details to the model. */
export function messageForCopilotWorkflowError(
  error: unknown,
  fallback = 'Workflow operation failed'
): string {
  return messageForCopilotApplicationError(error, fallback)
}
