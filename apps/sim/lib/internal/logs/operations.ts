import type { WorkflowExecutionDelegatedPrincipal } from '@sim/auth/principal'
import type { ContractQuery } from '@/lib/api/contracts'
import type { listLogsContract } from '@/lib/api/contracts/logs'
import { listLogsUseCase } from '@/lib/logs/application/list-logs'
import { readExecutionSnapshotUseCase } from '@/lib/logs/application/read-execution-snapshot'
import { readLogDetailUseCase } from '@/lib/logs/application/read-log-detail'

export interface LogsToolOperationContext {
  principal: WorkflowExecutionDelegatedPrincipal
  signal?: AbortSignal
}

function complete<T>(context: LogsToolOperationContext, value: T): T {
  context.signal?.throwIfAborted()
  return value
}

export async function executeLogsList(
  query: ContractQuery<typeof listLogsContract>,
  context: LogsToolOperationContext
) {
  context.signal?.throwIfAborted()
  const result = await listLogsUseCase.execute({
    principal: context.principal,
    input: { ...query, workspaceId: context.principal.workspaceId, signal: context.signal },
  })
  return complete(context, result)
}

export async function executeLogsGet(id: string, context: LogsToolOperationContext) {
  const result = await readLogDetailUseCase.execute({
    principal: context.principal,
    input: {
      workspaceId: context.principal.workspaceId,
      lookupColumn: 'id',
      lookupValue: id,
      signal: context.signal,
    },
  })
  return complete(context, { data: result.detail })
}

export async function executeLogsGetRunDetails(
  executionId: string,
  context: LogsToolOperationContext
) {
  const result = await readLogDetailUseCase.execute({
    principal: context.principal,
    input: {
      workspaceId: context.principal.workspaceId,
      lookupColumn: 'executionId',
      lookupValue: executionId,
      signal: context.signal,
    },
  })
  return complete(context, { data: result.detail })
}

export async function executeLogsGetExecution(
  executionId: string,
  context: LogsToolOperationContext
) {
  const result = await readExecutionSnapshotUseCase.execute({
    principal: context.principal,
    input: { executionId, signal: context.signal },
  })
  return complete(context, result)
}
