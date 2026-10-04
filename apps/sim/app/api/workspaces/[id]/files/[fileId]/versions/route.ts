import { listWorkspaceFileVersionsContract } from '@/lib/api/contracts/workspace-file-versions'
import { cursorRoute, cursorScopeKey } from '@/lib/api/cursor-binding'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { internalFileErrorPolicies, toFileVersion } from '@/lib/workspace-files/api'
import { listWorkspaceFileVersions } from '@/lib/workspace-files/application/file-versions'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { readSortedCursor, writeSortedCursor } from '@/app/api/v2/lib/response'

export const GET = defineInternalJsonRoute({
  contract: listWorkspaceFileVersionsContract,
  auth: internalSessionAuth,
  operation: fileOperations.listVersions,
  rateLimit: internalRateLimits.user({ bucketName: 'workspace-files.history' }),
  errorPolicy: internalFileErrorPolicies.concealResourceAuthorization,
  mapInput: ({ params, query }) => ({
    assertedWorkspaceId: params.id,
    fileId: params.fileId,
    limit: query.limit,
    sortOrder: query.sortOrder,
    after: readSortedCursor(
      query.cursor,
      query.sortBy,
      query.sortOrder,
      cursorScopeKey(cursorRoute(listWorkspaceFileVersionsContract, params))
    ),
  }),
  useCase: listWorkspaceFileVersions,
  present: ({ versions, nextKeys, revision }, { input }) => ({
    versions: versions.map(toFileVersion),
    revision,
    nextCursor: writeSortedCursor(
      nextKeys,
      'version',
      input.sortOrder,
      cursorScopeKey(
        cursorRoute(listWorkspaceFileVersionsContract, {
          id: input.assertedWorkspaceId,
          fileId: input.fileId,
        })
      )
    ),
  }),
})
