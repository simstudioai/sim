import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import {
  v2AddTableColumnContract,
  v2DeleteTableColumnContract,
  v2UpdateTableColumnContract,
} from '@/lib/api/contracts/v2/tables'
import { isZodError } from '@/lib/api/server'
import { addTableColumn, deleteColumn } from '@/lib/table'
import { performUpdateTableColumn } from '@/lib/table/orchestration'
import { withPublicApiRouteHandler } from '@/app/api/public-api-route-handler'
import { checkAccess, normalizeColumn } from '@/app/api/table/utils'
import { resolveWorkspaceScope } from '@/app/api/v1/middleware'
import {
  v2CaughtOrchestrationError,
  v2Data,
  v2Error,
  v2ValidationError,
  v2WorkspaceAccessError,
} from '@/app/api/v2/lib/response'
import { v2TableAccessError, v2TableOrchestrationError } from '@/app/api/v2/tables/utils'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** POST /api/v2/tables/[tableId]/columns — Add a column to the table schema. */
export const POST = withPublicApiRouteHandler({
  contract: v2AddTableColumnContract,
  rateLimitEndpoint: 'table-columns',
  handler: async ({ request, input, auth: { requestId, userId, rateLimit } }) => {
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

      const updatedTable = await addTableColumn(tableId, validated.column, requestId)

      recordAudit({
        workspaceId: validated.workspaceId,
        actorId: userId,
        action: AuditAction.TABLE_UPDATED,
        resourceType: AuditResourceType.TABLE,
        resourceId: tableId,
        resourceName: table.name,
        description: `Added column "${validated.column.name}" to table "${table.name}"`,
        metadata: { column: validated.column },
        request,
      })

      return v2Data({ columns: updatedTable.schema.columns.map(normalizeColumn) }, { rateLimit })
    } catch (error) {
      if (isZodError(error)) return v2ValidationError(error)

      const classified = v2CaughtOrchestrationError(error)
      if (classified) return classified

      throw error
    }
  },
})

/** PATCH /api/v2/tables/[tableId]/columns — Update a column (rename, type change, constraints). */
export const PATCH = withPublicApiRouteHandler({
  contract: v2UpdateTableColumnContract,
  rateLimitEndpoint: 'table-columns',
  handler: async ({ request, input, auth: { requestId, userId, rateLimit } }) => {
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

      const outcome = await performUpdateTableColumn({
        table,
        columnName: validated.columnName,
        userId,
        updates: validated.updates,
        requestId,
        request,
      })
      if (!outcome.success || !outcome.table) {
        return v2TableOrchestrationError(outcome, 'Failed to update column')
      }

      return v2Data({ columns: outcome.table.schema.columns.map(normalizeColumn) }, { rateLimit })
    } catch (error) {
      if (isZodError(error)) return v2ValidationError(error)
      throw error
    }
  },
})

/** DELETE /api/v2/tables/[tableId]/columns — Delete a column from the table schema. */
export const DELETE = withPublicApiRouteHandler({
  contract: v2DeleteTableColumnContract,
  rateLimitEndpoint: 'table-columns',
  handler: async ({ request, input, auth: { requestId, userId, rateLimit } }) => {
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

      const updatedTable = await deleteColumn(
        { tableId, columnName: validated.columnName },
        requestId
      )

      recordAudit({
        workspaceId: validated.workspaceId,
        actorId: userId,
        action: AuditAction.TABLE_UPDATED,
        resourceType: AuditResourceType.TABLE,
        resourceId: tableId,
        resourceName: table.name,
        description: `Deleted column "${validated.columnName}" from table "${table.name}"`,
        metadata: { columnName: validated.columnName },
        request,
      })

      return v2Data({ columns: updatedTable.schema.columns.map(normalizeColumn) }, { rateLimit })
    } catch (error) {
      if (isZodError(error)) return v2ValidationError(error)

      const classified = v2CaughtOrchestrationError(error)
      if (classified) return classified

      throw error
    }
  },
})
