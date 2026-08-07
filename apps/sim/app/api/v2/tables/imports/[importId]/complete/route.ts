import { v2CompleteTableImportContract } from '@/lib/api/contracts/v2/tables'
import {
  findOwnedTableImport,
  getOwnedTableImportUpload,
  startUploadedTableImport,
  toV2TableImport,
} from '@/lib/table/orchestration/import-resource'
import { completeUploadSession } from '@/lib/uploads/upload-session/service'
import { withPublicApiRouteHandler } from '@/app/api/public-api-route-handler'
import { resolveWorkspaceScope } from '@/app/api/v1/middleware'
import {
  v2CaughtOrchestrationError,
  v2Data,
  v2WorkspaceAccessError,
} from '@/app/api/v2/lib/response'
import { v2TableLockError } from '@/app/api/v2/tables/utils'

export const POST = withPublicApiRouteHandler({
  contract: v2CompleteTableImportContract,
  rateLimitEndpoint: 'table-import',
  handler: async ({ input, auth: { userId, rateLimit } }) => {
    try {
      const { workspaceId } = input.query
      const scopeError = await resolveWorkspaceScope(rateLimit, workspaceId)
      if (scopeError) return v2WorkspaceAccessError(scopeError)
      const upload = await getOwnedTableImportUpload({
        importId: input.params.importId,
        workspaceId,
        userId,
        uploadToken: input.headers['upload-token'],
      })
      const existing = await findOwnedTableImport({
        importId: upload.id,
        workspaceId,
        userId: upload.userId,
      })
      if (existing) return v2Data(toV2TableImport(existing), { rateLimit })
      const completed = await completeUploadSession({
        session: upload,
        finalize: async () => ({ value: null }),
      })
      const started = await startUploadedTableImport(completed.session)
      return v2Data(await toV2TableImport(started), { rateLimit })
    } catch (error) {
      const lockError = v2TableLockError(error)
      if (lockError) return lockError
      const classified = v2CaughtOrchestrationError(error)
      if (classified) return classified
      throw error
    }
  },
})
