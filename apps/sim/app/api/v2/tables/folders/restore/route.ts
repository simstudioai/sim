import { v2RestoreTableFolderContract } from '@/lib/api/contracts/v2/tables'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2TableErrorPolicies } from '@/lib/table/api'
import { restoreTableFolderUseCase } from '@/lib/table/application/folders'
import { tableOperations } from '@/lib/table/application/operations'
import { toV2PathFolder } from '@/app/api/v2/lib/folders'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * POST /api/v2/tables/folders/restore — restore a soft-deleted table folder tree.
 *
 * `DELETE /api/v2/tables/folders` archives recursively, so without this a recursive delete
 * was unrecoverable over the API: the archived tables stayed visible through
 * `GET /api/v2/tables?scope=archived`, but nothing could put the folder structure back.
 *
 * Path-addressed, matching the rest of the v2 folder family. The path is the one the folder
 * held when it was deleted; the response reports where it actually landed.
 */
export const POST = defineV2JsonRoute({
  contract: v2RestoreTableFolderContract,
  auth: v2ApiKeyAuth,
  operation: tableOperations.restoreFolder,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2TableErrorPolicies.default,
  mapInput: ({ body }) => ({ workspaceId: body.workspaceId, path: body.path }),
  useCase: restoreTableFolderUseCase,
  present: ({ folder, index, restoredItems }) => ({
    data: { folder: toV2PathFolder(folder, index, false), restoredItems },
  }),
})
