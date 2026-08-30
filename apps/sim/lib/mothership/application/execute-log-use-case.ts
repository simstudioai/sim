import type { OperationUseCase } from '@/lib/core/application'
import { logDelegationPolicy } from '@/lib/logs/application/authorization'
import { logOperations } from '@/lib/logs/application/operations'
import { createCopilotApplicationAdapter } from '@/lib/mothership/application/application-adapter'
import {
  COPILOT_APPLICATION_DELEGATION_TTL_MS,
  type CopilotExecutionContext,
} from '@/lib/mothership/auth/application-delegation'

const copilotLogOperations = {
  list: logOperations.list,
  readDetail: logOperations.readDetail,
} as const

type CopilotLogOperation = (typeof copilotLogOperations)[keyof typeof copilotLogOperations]

const executeLogUseCase = createCopilotApplicationAdapter<CopilotLogOperation>({
  domain: 'logs',
  delegation: {
    audience: logDelegationPolicy.audience,
    ttlMs: COPILOT_APPLICATION_DELEGATION_TTL_MS,
    createDelegationId: (context) => `copilot-tool:${context.toolCallId}`,
  },
  operations: copilotLogOperations,
})

/** Enters a registered Logs use case with trusted Copilot identity. */
export function executeCopilotLogUseCase<O extends CopilotLogOperation, I, R>(
  context: CopilotExecutionContext | undefined,
  useCase: OperationUseCase<O, I, R>,
  input: I
): Promise<R> {
  return executeLogUseCase(context, useCase, input)
}
