import {
  v2DeleteTableContract,
  v2GetTableContract,
  v2UpdateTableContract,
} from '@/lib/api/contracts/v2/tables'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { asOrchestrationError } from '@/lib/core/orchestration/types'
import { captureServerEvent } from '@/lib/posthog/server'
import { v2TableErrorPolicies } from '@/lib/table/api'
import { TableOperationError } from '@/lib/table/application/errors'
import { tableOperations } from '@/lib/table/application/operations'
import {
  deleteTableUseCase,
  readTableUseCase,
  type UpdateTableResult,
  updateTableUseCase,
} from '@/lib/table/application/tables'
import { TableLockedError } from '@/lib/table/mutation-locks'
import { toApiTable } from '@/app/api/v2/tables/utils'

export const dynamic = 'force-dynamic'
export const revalidate = 0

function rethrowUpdateFailure(result: UpdateTableResult): void {
  if (!result.failure) return
  if (result.applied.length === 0) throw result.failure

  const details = { applied: result.applied }
  if (result.failure instanceof TableOperationError) {
    throw new TableOperationError(
      result.failure.code,
      result.failure.message,
      { ...result.failure.details, ...details },
      result.failure.lock
    )
  }
  if (result.failure instanceof TableLockedError) {
    throw new TableOperationError('locked', result.failure.message, details, result.failure.lock)
  }
  const classified = asOrchestrationError(result.failure)
  if (classified) throw new TableOperationError(classified.code, classified.message, details)
  throw new TableOperationError('internal', 'Internal server error', details)
}

export const GET = defineV2JsonRoute({
  contract: v2GetTableContract,
  operation: tableOperations.read,
  useCase: readTableUseCase,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2TableErrorPolicies.concealTableAuthorization,
  mapInput: ({ params, query }) => ({ tableId: params.tableId, workspaceId: query.workspaceId }),
  present: async ({ table, folderPath }) => ({
    data: await toApiTable(table, folderPath),
  }),
})

export const PATCH = defineV2JsonRoute({
  contract: v2UpdateTableContract,
  operation: tableOperations.update,
  useCase: updateTableUseCase,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2TableErrorPolicies.concealTableAuthorization,
  mapInput: ({ params, body }) => ({ tableId: params.tableId, ...body }),
  present: async (result) => {
    rethrowUpdateFailure(result)
    if (!result.table || result.folderPath === null) {
      throw new Error('Updated table is missing from the authoritative result')
    }
    return { data: await toApiTable(result.table, result.folderPath) }
  },
})

export const DELETE = defineV2JsonRoute({
  contract: v2DeleteTableContract,
  operation: tableOperations.delete,
  useCase: deleteTableUseCase,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2TableErrorPolicies.concealTableAuthorization,
  mapInput: ({ params, query }) => ({ tableId: params.tableId, workspaceId: query.workspaceId }),
  onSuccess: ({ result }) => {
    captureServerEvent(
      result.attributedUserId,
      'table_deleted',
      { table_id: result.id, workspace_id: result.workspaceId },
      { groups: { workspace: result.workspaceId } }
    )
  },
  present: ({ id, deleted }) => ({ data: { id, deleted } }),
})
