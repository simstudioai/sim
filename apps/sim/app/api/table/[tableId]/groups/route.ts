import {
  addWorkflowGroupContract,
  deleteWorkflowGroupContract,
  updateWorkflowGroupContract,
} from '@/lib/api/contracts/tables'
import { defineInternalJsonRoute, internalRateLimits } from '@/lib/api/server/routes'
import { internalTableErrorPolicies, internalTableSessionOrExecutorAuth } from '@/lib/table/api'
import {
  createTableGroupUseCase,
  deleteTableGroupUseCase,
  updateTableGroupUseCase,
} from '@/lib/table/application/groups'
import { tableOperations } from '@/lib/table/application/operations'
import type { TableDefinition } from '@/lib/table/types'
import { normalizeColumn } from '@/lib/table/wire'

const rateLimit = internalRateLimits.none({
  reason: 'Existing authenticated table group mutations have no request-rate policy',
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
  auth: internalTableSessionOrExecutorAuth,
  rateLimit,
  errorPolicy: internalTableErrorPolicies.concealTableGroupAuthorization,
  mapInput: ({ params, body }) => ({
    tableId: params.tableId,
    ...body,
    autoRun: body.autoRun ?? true,
  }),
  present: ({ table }) => presentTable(table),
})

export const PATCH = defineInternalJsonRoute({
  contract: updateWorkflowGroupContract,
  operation: tableOperations.updateGroup,
  useCase: updateTableGroupUseCase,
  auth: internalTableSessionOrExecutorAuth,
  rateLimit,
  errorPolicy: internalTableErrorPolicies.concealTableGroupAuthorization,
  mapInput: ({ params, body }) => ({ tableId: params.tableId, ...body }),
  present: ({ table }) => presentTable(table),
})

export const DELETE = defineInternalJsonRoute({
  contract: deleteWorkflowGroupContract,
  operation: tableOperations.deleteGroup,
  useCase: deleteTableGroupUseCase,
  auth: internalTableSessionOrExecutorAuth,
  rateLimit,
  errorPolicy: internalTableErrorPolicies.concealTableGroupAuthorization,
  mapInput: ({ params, body }) => ({ tableId: params.tableId, ...body }),
  present: ({ table }) => presentTable(table),
})
