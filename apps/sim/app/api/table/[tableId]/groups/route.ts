import {
  addWorkflowGroupContract,
  deleteWorkflowGroupContract,
  updateWorkflowGroupContract,
} from '@/lib/api/contracts/tables'
import {
  defineInternalJsonRoute,
  extendInternalErrorPolicy,
  internalErrorResponse,
  internalPlainOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import {
  createTableGroupUseCase,
  deleteTableGroupUseCase,
  updateTableGroupUseCase,
} from '@/lib/table/application/groups'
import { tableOperations } from '@/lib/table/application/operations'
import { TableLockedError } from '@/lib/table/mutation-locks'
import type { TableDefinition } from '@/lib/table/types'
import { normalizeColumn } from '@/app/api/table/utils'

const errorPolicy = extendInternalErrorPolicy(internalPlainOrchestrationErrorPolicy, (error) =>
  error instanceof TableLockedError
    ? internalErrorResponse(423, { error: error.message, lock: error.lock })
    : null
)

const rateLimit = internalRateLimits.none({
  reason: 'First-party table group mutations are authenticated browser operations',
})

function presentTable(table: TableDefinition) {
  return {
    success: true as const,
    data: {
      columns: table.schema.columns.map(normalizeColumn),
      workflowGroups: table.schema.workflowGroups ?? [],
    },
  }
}

export const POST = defineInternalJsonRoute({
  contract: addWorkflowGroupContract,
  operation: tableOperations.createGroup,
  useCase: createTableGroupUseCase,
  auth: internalSessionAuth,
  rateLimit,
  errorPolicy,
  mapInput: ({ params, body }) => ({ tableId: params.tableId, ...body }),
  present: ({ table }) => presentTable(table),
})

export const PATCH = defineInternalJsonRoute({
  contract: updateWorkflowGroupContract,
  operation: tableOperations.updateGroup,
  useCase: updateTableGroupUseCase,
  auth: internalSessionAuth,
  rateLimit,
  errorPolicy,
  mapInput: ({ params, body }) => ({ tableId: params.tableId, ...body }),
  present: ({ table }) => presentTable(table),
})

export const DELETE = defineInternalJsonRoute({
  contract: deleteWorkflowGroupContract,
  operation: tableOperations.deleteGroup,
  useCase: deleteTableGroupUseCase,
  auth: internalSessionAuth,
  rateLimit,
  errorPolicy,
  mapInput: ({ params, body }) => ({ tableId: params.tableId, ...body }),
  present: ({ table }) => presentTable(table),
})
