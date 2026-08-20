import { createCopilotApplicationAdapter } from '@/lib/copilot/application/application-adapter'
import { messageForCopilotApplicationError } from '@/lib/copilot/application/error'
import {
  COPILOT_APPLICATION_DELEGATION_TTL_MS,
  type CopilotExecutionContext,
  InteractiveCopilotExecutionRequiredError,
  requireInteractiveCopilotExecutionContext,
} from '@/lib/copilot/auth/application-delegation'
import type { OperationUseCase } from '@/lib/core/application'
import { platformContextDelegationPolicy } from '@/lib/platform-context/application/authorization'
import {
  type PlatformContextOperation,
  platformContextOperations,
} from '@/lib/platform-context/application/operations'

const executePlatformContextUseCase = createCopilotApplicationAdapter({
  domain: 'platform context',
  delegation: {
    audience: platformContextDelegationPolicy.audience,
    ttlMs: COPILOT_APPLICATION_DELEGATION_TTL_MS,
    createDelegationId: (context) => `copilot-tool:${context.toolCallId}`,
  },
  operations: platformContextOperations,
})

/** Enters a live platform-context operation only from a trusted interactive Copilot lifecycle. */
export function executeCopilotPlatformContextUseCase<O extends PlatformContextOperation, I, R>(
  context: CopilotExecutionContext | undefined,
  useCase: OperationUseCase<O, I, R>,
  input: I
): Promise<R> {
  const trustedContext = requireInteractiveCopilotExecutionContext(context)
  return executePlatformContextUseCase(trustedContext, useCase, input)
}

/** Projects only actionable authorization failures into live platform-context tool output. */
export function messageForCopilotPlatformContextError(error: unknown): string {
  if (error instanceof InteractiveCopilotExecutionRequiredError) return error.message
  return messageForCopilotApplicationError(error)
}
