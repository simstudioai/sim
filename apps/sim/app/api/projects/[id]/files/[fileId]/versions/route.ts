import { listProjectFileVersionsContract } from '@/lib/api/contracts/project-file-versions'
import { cursorRoute, cursorScopeKey } from '@/lib/api/cursor-binding'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { toProjectFileVersion } from '@/lib/projects/files/api'
import { listProjectFileVersions } from '@/lib/projects/files/application'
import { readSortedCursor, writeSortedCursor } from '@/app/api/v2/lib/response'
export const GET = defineInternalJsonRoute({
  contract: listProjectFileVersionsContract,
  auth: internalSessionAuth,
  operation: listProjectFileVersions.operation,
  rateLimit: internalRateLimits.user({ bucketName: 'project-files.history' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params, query }) => ({
    projectId: params.id,
    fileId: params.fileId,
    sortOrder: query.sortOrder,
    limit: query.limit,
    after: readSortedCursor(
      query.cursor,
      query.sortBy,
      query.sortOrder,
      cursorScopeKey(
        cursorRoute(listProjectFileVersionsContract, { id: params.id, fileId: params.fileId })
      )
    ),
  }),
  useCase: listProjectFileVersions,
  present: ({ versions, nextKeys, revision }, { input }) => ({
    revision,
    versions: versions.map(toProjectFileVersion),
    nextCursor: writeSortedCursor(
      nextKeys,
      'version',
      input.sortOrder,
      cursorScopeKey(
        cursorRoute(listProjectFileVersionsContract, {
          id: input.projectId,
          fileId: input.fileId,
        })
      )
    ),
  }),
})
