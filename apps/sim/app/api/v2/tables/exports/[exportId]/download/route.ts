import { v2TableExportDownloadContract } from '@/lib/api/contracts/v2/tables'
import { requireTableExport, tableExportResult } from '@/lib/table/orchestration/export-resource'
import { generatePresignedDownloadUrl } from '@/lib/uploads/core/storage-service'
import { withPublicApiRouteHandler } from '@/app/api/public-api-route-handler'
import { checkAccess } from '@/app/api/table/utils'
import { resolveWorkspaceScope } from '@/app/api/v1/middleware'
import {
  v2CaughtOrchestrationError,
  v2Data,
  v2Error,
  v2WorkspaceAccessError,
} from '@/app/api/v2/lib/response'

const DOWNLOAD_TTL_SECONDS = 60 * 60

export const GET = withPublicApiRouteHandler({
  contract: v2TableExportDownloadContract,
  rateLimitEndpoint: 'table-export',
  handler: async ({ input, auth: { userId, rateLimit } }) => {
    try {
      const { workspaceId } = input.query
      const scopeError = await resolveWorkspaceScope(rateLimit, workspaceId)
      if (scopeError) return v2WorkspaceAccessError(scopeError)
      const record = await requireTableExport(input.params.exportId, workspaceId)
      const access = await checkAccess(record.tableId, rateLimit.principalUserId ?? userId, 'read')
      if (!access.ok || access.table.workspaceId !== workspaceId) {
        return v2Error('NOT_FOUND', 'Table export not found')
      }
      const result = tableExportResult(record)
      const url = await generatePresignedDownloadUrl(
        result.resultKey,
        'workspace',
        DOWNLOAD_TTL_SECONDS
      )
      return v2Data(
        {
          url,
          fileName: result.resultKey.split('/').pop() ?? `export.${result.format}`,
          expiresAt: new Date(Date.now() + DOWNLOAD_TTL_SECONDS * 1000).toISOString(),
        },
        { rateLimit }
      )
    } catch (error) {
      const classified = v2CaughtOrchestrationError(error)
      if (classified) return classified
      throw error
    }
  },
})
