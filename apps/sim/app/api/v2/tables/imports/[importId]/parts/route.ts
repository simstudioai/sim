import { v2CreateTableImportPartUrlsContract } from '@/lib/api/contracts/v2/tables'
import { getOwnedTableImportUpload } from '@/lib/table/orchestration/import-resource'
import { createUploadPartUrls } from '@/lib/uploads/upload-session/service'
import { withPublicApiRouteHandler } from '@/app/api/public-api-route-handler'
import { resolveWorkspaceScope } from '@/app/api/v1/middleware'
import {
  v2CaughtOrchestrationError,
  v2Data,
  v2WorkspaceAccessError,
} from '@/app/api/v2/lib/response'

export const POST = withPublicApiRouteHandler({
  contract: v2CreateTableImportPartUrlsContract,
  rateLimitEndpoint: 'table-import',
  handler: async ({ request, input, auth: { userId, rateLimit } }) => {
    try {
      const { workspaceId } = input.query
      const scopeError = await resolveWorkspaceScope(rateLimit, workspaceId)
      if (scopeError) return v2WorkspaceAccessError(scopeError)
      const session = await getOwnedTableImportUpload({
        importId: input.params.importId,
        workspaceId,
        userId: rateLimit.principalUserId ?? userId,
        uploadToken: input.headers['upload-token'],
      })
      const parts = await createUploadPartUrls({
        session,
        partNumbers: input.body.partNumbers,
        localOrigin: request.nextUrl.origin,
      })
      return v2Data({ parts }, { rateLimit })
    } catch (error) {
      const classified = v2CaughtOrchestrationError(error)
      if (classified) return classified
      throw error
    }
  },
})
