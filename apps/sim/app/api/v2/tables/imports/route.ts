import { v2CreateTableImportContract } from '@/lib/api/contracts/v2/tables'
import {
  createTableImportResource,
  toV2CreateTableImport,
} from '@/lib/table/orchestration/import-resource'
import { withPublicApiRouteHandler } from '@/app/api/public-api-route-handler'
import { resolveWorkspaceScope } from '@/app/api/v1/middleware'
import { resolveFolderPathIdentity } from '@/app/api/v2/lib/folders'
import {
  v2CaughtOrchestrationError,
  v2Data,
  v2Error,
  v2WorkspaceAccessError,
} from '@/app/api/v2/lib/response'
import { v2TableLockError } from '@/app/api/v2/tables/utils'

export const POST = withPublicApiRouteHandler({
  contract: v2CreateTableImportContract,
  rateLimitEndpoint: 'table-import',
  handler: async ({ request, input, auth: { userId, rateLimit } }) => {
    try {
      const scopeError = await resolveWorkspaceScope(rateLimit, input.body.workspaceId)
      if (scopeError) return v2WorkspaceAccessError(scopeError)
      let created: Awaited<ReturnType<typeof createTableImportResource>>
      if (input.body.target.type === 'new') {
        const resolution = await resolveFolderPathIdentity({
          workspaceId: input.body.workspaceId,
          resourceType: 'table',
          path: input.body.target.folderPath ?? '/',
        })
        if (!resolution.found) return v2Error('NOT_FOUND', 'Folder not found')
        created = await createTableImportResource(
          input.body,
          userId,
          request.nextUrl.origin,
          resolution.folderId
        )
      } else {
        created = await createTableImportResource(input.body, userId, request.nextUrl.origin)
      }
      return v2Data(toV2CreateTableImport(created), { rateLimit, status: 201 })
    } catch (error) {
      const lockError = v2TableLockError(error)
      if (lockError) return lockError
      const classified = v2CaughtOrchestrationError(error)
      if (classified) return classified
      throw error
    }
  },
})
