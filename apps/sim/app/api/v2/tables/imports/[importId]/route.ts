import {
  v2CancelTableImportContract,
  v2GetTableImportContract,
} from '@/lib/api/contracts/v2/tables'
import {
  abortTableImportUpload,
  cancelTableImportResource,
  getOwnedTableImport,
  toV2TableImport,
} from '@/lib/table/orchestration/import-resource'
import { withPublicApiRouteHandler } from '@/app/api/public-api-route-handler'
import { resolveWorkspaceScope } from '@/app/api/v1/middleware'
import {
  v2CaughtOrchestrationError,
  v2Data,
  v2WorkspaceAccessError,
} from '@/app/api/v2/lib/response'

export const GET = withPublicApiRouteHandler({
  contract: v2GetTableImportContract,
  rateLimitEndpoint: 'table-import',
  handler: async ({ input, auth: { userId, rateLimit } }) => {
    try {
      const scopeError = await resolveWorkspaceScope(rateLimit, input.query.workspaceId)
      if (scopeError) return v2WorkspaceAccessError(scopeError)
      const record = await getOwnedTableImport({
        importId: input.params.importId,
        workspaceId: input.query.workspaceId,
        userId: rateLimit.principalUserId ?? userId,
      })
      return v2Data(await toV2TableImport(record), { rateLimit })
    } catch (error) {
      const classified = v2CaughtOrchestrationError(error)
      if (classified) return classified
      throw error
    }
  },
})

export const DELETE = withPublicApiRouteHandler({
  contract: v2CancelTableImportContract,
  rateLimitEndpoint: 'table-import',
  handler: async ({ input, auth: { userId, rateLimit } }) => {
    try {
      const scopeError = await resolveWorkspaceScope(rateLimit, input.query.workspaceId)
      if (scopeError) return v2WorkspaceAccessError(scopeError)
      const uploadToken = input.headers['upload-token']
      const ownerUserId = rateLimit.principalUserId ?? userId
      const record = uploadToken
        ? await abortTableImportUpload({
            importId: input.params.importId,
            workspaceId: input.query.workspaceId,
            userId: ownerUserId,
            uploadToken,
          })
        : await cancelTableImportResource(
            await getOwnedTableImport({
              importId: input.params.importId,
              workspaceId: input.query.workspaceId,
              userId: ownerUserId,
            })
          )
      return v2Data(toV2TableImport(record), { rateLimit })
    } catch (error) {
      const classified = v2CaughtOrchestrationError(error)
      if (classified) return classified
      throw error
    }
  },
})
