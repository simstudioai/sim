import type { OperationUseCase } from '@/lib/core/application'
import { createCopilotApplicationAdapter } from '@/lib/mothership/application/application-adapter'
import { COPILOT_APPLICATION_DELEGATION_TTL_MS } from '@/lib/mothership/auth/application-delegation'
import type { CopilotTableDelegationContext } from '@/lib/mothership/auth/table-delegation'
import { tableDelegationPolicy } from '@/lib/table/application/authorization'
import { type TableOperation, tableOperations } from '@/lib/table/application/operations'

interface ExecuteCopilotTableUseCaseOptions {
  tableId?: string
}

const executeTableUseCase = createCopilotApplicationAdapter<
  TableOperation,
  ExecuteCopilotTableUseCaseOptions
>({
  domain: 'table',
  delegation: {
    audience: tableDelegationPolicy.audience,
    ttlMs: COPILOT_APPLICATION_DELEGATION_TTL_MS,
    createDelegationId: (context) => `copilot-tool:${context.toolCallId}`,
  },
  operations: tableOperations,
  projectResourceScope: ({ tableId }) => (tableId ? { tableId } : {}),
})

/** Normalizes trusted Copilot authentication before entering a Table application use case. */
export function executeCopilotTableUseCase<O extends TableOperation, I, R>(
  context: CopilotTableDelegationContext | undefined,
  useCase: OperationUseCase<O, I, R>,
  input: I,
  options: ExecuteCopilotTableUseCaseOptions = {}
): Promise<R> {
  return executeTableUseCase(context, useCase, input, options)
}
