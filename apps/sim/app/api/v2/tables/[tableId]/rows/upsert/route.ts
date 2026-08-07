import { v2UpsertTableRowContract } from '@/lib/api/contracts/v2/tables'
import { isZodError } from '@/lib/api/server'
import type { RowData, TableSchema } from '@/lib/table'
import { buildIdByName, rowDataNameToId, upsertRow } from '@/lib/table'
import { namedRowMapper } from '@/lib/table/cell-format'
import { withPublicApiRouteHandler } from '@/app/api/public-api-route-handler'
import { checkAccess } from '@/app/api/table/utils'
import { resolveWorkspaceScope } from '@/app/api/v1/middleware'
import {
  v2CaughtOrchestrationError,
  v2Data,
  v2Error,
  v2ValidationError,
  v2WorkspaceAccessError,
} from '@/app/api/v2/lib/response'
import { toApiRow, v2TableAccessError } from '@/app/api/v2/tables/utils'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** POST /api/v2/tables/[tableId]/rows/upsert — Insert or update a row based on unique columns. */
export const POST = withPublicApiRouteHandler({
  contract: v2UpsertTableRowContract,
  rateLimitEndpoint: 'table-rows',
  handler: async ({ input, auth: { requestId, userId, rateLimit } }) => {
    try {
      const { tableId } = input.params
      const validated = input.body

      const scopeError = await resolveWorkspaceScope(rateLimit, validated.workspaceId)
      if (scopeError) return v2WorkspaceAccessError(scopeError)

      const result = await checkAccess(tableId, userId, 'write')
      if (!result.ok) return v2TableAccessError(result)

      const { table } = result
      if (table.workspaceId !== validated.workspaceId) {
        return v2Error('NOT_FOUND', 'Table not found')
      }

      const idByName = buildIdByName(table.schema as TableSchema)
      const toNamedRow = namedRowMapper((table.schema as TableSchema).columns)
      const upsertResult = await upsertRow(
        {
          tableId,
          workspaceId: validated.workspaceId,
          data: rowDataNameToId(validated.data as RowData, idByName),
          userId,
          conflictTarget: validated.conflictTarget,
        },
        table,
        requestId
      )

      return v2Data(
        { row: toApiRow(upsertResult.row, toNamedRow), operation: upsertResult.operation },
        { rateLimit }
      )
    } catch (error) {
      if (isZodError(error)) return v2ValidationError(error)

      const classified = v2CaughtOrchestrationError(error)
      if (classified) return classified

      throw error
    }
  },
})
