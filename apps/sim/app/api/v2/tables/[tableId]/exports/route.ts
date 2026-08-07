import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { v2CreateTableExportContract } from '@/lib/api/contracts/v2/tables'
import {
  createTableExportResource,
  toV2TableExport,
} from '@/lib/table/orchestration/export-resource'
import { withPublicApiRouteHandler } from '@/app/api/public-api-route-handler'
import { checkAccess } from '@/app/api/table/utils'
import { resolveWorkspaceScope } from '@/app/api/v1/middleware'
import {
  v2CaughtOrchestrationError,
  v2Data,
  v2Error,
  v2WorkspaceAccessError,
} from '@/app/api/v2/lib/response'

export const POST = withPublicApiRouteHandler({
  contract: v2CreateTableExportContract,
  rateLimitEndpoint: 'table-export',
  handler: async ({ request, input, auth: { userId, rateLimit } }) => {
    try {
      const { workspaceId, format } = input.body
      const scopeError = await resolveWorkspaceScope(rateLimit, workspaceId)
      if (scopeError) return v2WorkspaceAccessError(scopeError)
      const access = await checkAccess(
        input.params.tableId,
        rateLimit.principalUserId ?? userId,
        'read'
      )
      if (!access.ok || access.table.workspaceId !== workspaceId) {
        return v2Error('NOT_FOUND', 'Table not found')
      }
      const record = await createTableExportResource({ table: access.table, format })
      recordAudit({
        workspaceId,
        actorId: userId,
        action: AuditAction.TABLE_EXPORTED,
        resourceType: AuditResourceType.TABLE,
        resourceId: access.table.id,
        resourceName: access.table.name,
        description: `Exported table "${access.table.name}" as ${format.toUpperCase()}`,
        metadata: { format, rowCount: access.table.rowCount },
        request,
      })
      return v2Data(toV2TableExport(record, true), { rateLimit, status: 201 })
    } catch (error) {
      const classified = v2CaughtOrchestrationError(error)
      if (classified) return classified
      throw error
    }
  },
})
