import {
  type CopilotTableDelegationContext,
  resolveCopilotTablePrincipal,
} from '@/lib/copilot/auth/table-delegation'
import type { OperationUseCase } from '@/lib/core/application'
import { defineAuthorizedTableUseCase } from '@/lib/table/application/authorized-table-use-case'
import {
  resolveActiveTableContext,
  resolveTableWorkspaceContext,
} from '@/lib/table/application/context'
import { type TableOperation, tableOperations } from '@/lib/table/application/operations'

const registeredTableOperationIds = new Set<string>(
  Object.values(tableOperations).map((operation) => operation.id)
)

interface ExecuteCopilotTableUseCaseOptions {
  tableId?: string
}

export interface AdmitCopilotTableOperationInput {
  workspaceId: string
  tableId?: string
}

/** Enters a registered table application use case under trusted Copilot delegation. */
export function executeCopilotTableUseCase<O extends TableOperation, I, R>(
  context: CopilotTableDelegationContext | undefined,
  useCase: OperationUseCase<O, I, R>,
  input: I,
  options: ExecuteCopilotTableUseCaseOptions = {}
): Promise<R> {
  if (!registeredTableOperationIds.has(useCase.operation.id)) {
    throw new Error(`Unregistered Copilot table operation: ${useCase.operation.id}`)
  }
  return useCase.execute({
    principal: resolveCopilotTablePrincipal(context, options.tableId),
    input,
  })
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
