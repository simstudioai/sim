import { createCopilotApplicationAdapter } from '@/lib/copilot/application/application-adapter'
import { COPILOT_APPLICATION_DELEGATION_TTL_MS } from '@/lib/copilot/auth/application-delegation'
import type { CopilotTableDelegationContext } from '@/lib/copilot/auth/table-delegation'
import type { OperationUseCase } from '@/lib/core/application'
import { tableDelegationPolicy } from '@/lib/table/application/authorization'
import { defineAuthorizedTableUseCase } from '@/lib/table/application/authorized-table-use-case'
import {
  resolveActiveTableContext,
  resolveTableWorkspaceContext,
} from '@/lib/table/application/context'
import { type TableOperation, tableOperations } from '@/lib/table/application/operations'

interface ExecuteCopilotTableUseCaseOptions {
  tableId?: string
}

export interface AdmitCopilotTableOperationInput {
  workspaceId: string
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

/** Enters a registered table application use case under trusted Copilot delegation. */
export function executeCopilotTableUseCase<O extends TableOperation, I, R>(
  context: CopilotTableDelegationContext | undefined,
  useCase: OperationUseCase<O, I, R>,
  input: I,
  options: ExecuteCopilotTableUseCaseOptions = {}
): Promise<R> {
  return executeTableUseCase(context, useCase, input, options)
}

/**
 * Authorizes a Copilot operation that still retains a compatibility-specific
 * presenter or execution strategy before that trusted adapter invokes it.
 */
export function admitCopilotTableOperation<O extends TableOperation>(
  context: CopilotTableDelegationContext | undefined,
  operation: O,
  input: AdmitCopilotTableOperationInput
): Promise<void> {
  const useCase = defineAuthorizedTableUseCase({
    operation,
    resolveContext: ({ input: admitted }: { input: AdmitCopilotTableOperationInput }) =>
      admitted.tableId
        ? resolveActiveTableContext({
            tableId: admitted.tableId,
            assertedWorkspaceId: admitted.workspaceId,
          })
        : resolveTableWorkspaceContext(admitted.workspaceId),
    async execute() {},
  })
  return executeCopilotTableUseCase(context, useCase, input, { tableId: input.tableId })
}
