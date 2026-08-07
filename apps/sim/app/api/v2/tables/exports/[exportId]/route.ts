import {
  v2CancelTableExportContract,
  v2GetTableExportContract,
} from '@/lib/api/contracts/v2/tables'
import {
  cancelTableExportResource,
  requireTableExport,
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

async function authorizeExport(exportId: string, workspaceId: string, userId: string) {
  const record = await requireTableExport(exportId, workspaceId)
  const access = await checkAccess(record.tableId, userId, 'read')
  if (!access.ok || access.table.workspaceId !== workspaceId) return null
  return record
}

export const GET = withPublicApiRouteHandler({
  contract: v2GetTableExportContract,
  rateLimitEndpoint: 'table-export',
  handler: async ({ input, auth: { userId, rateLimit } }) => {
    try {
      const { workspaceId } = input.query
      const scopeError = await resolveWorkspaceScope(rateLimit, workspaceId)
      if (scopeError) return v2WorkspaceAccessError(scopeError)
      const record = await authorizeExport(input.params.exportId, workspaceId, userId)
      if (!record) return v2Error('NOT_FOUND', 'Table export not found')
      return v2Data(toV2TableExport(record), { rateLimit })
    } catch (error) {
      const classified = v2CaughtOrchestrationError(error)
      if (classified) return classified
      throw error
    }
  },
})

export const DELETE = withPublicApiRouteHandler({
  contract: v2CancelTableExportContract,
  rateLimitEndpoint: 'table-export',
  handler: async ({ input, auth: { userId, rateLimit } }) => {
    try {
      const { workspaceId } = input.query
      const scopeError = await resolveWorkspaceScope(rateLimit, workspaceId)
      if (scopeError) return v2WorkspaceAccessError(scopeError)
      const record = await authorizeExport(input.params.exportId, workspaceId, userId)
      if (!record) return v2Error('NOT_FOUND', 'Table export not found')
      return v2Data(toV2TableExport(await cancelTableExportResource(record)), { rateLimit })
    } catch (error) {
      const classified = v2CaughtOrchestrationError(error)
      if (classified) return classified
      throw error
    }
  },
})
