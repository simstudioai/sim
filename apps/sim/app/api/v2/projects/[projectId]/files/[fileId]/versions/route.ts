import { v2ListProjectFileVersionsContract } from '@/lib/api/contracts/v2/project-file-versions'
import { cursorRoute, cursorScopeKey } from '@/lib/api/cursor-binding'
import {
  defineV2JsonRoute,
  v2ApiKeyAuth,
  v2OrchestrationErrorPolicy,
  v2RateLimits,
} from '@/lib/api/server/routes'
import { toProjectFileVersion } from '@/lib/projects/files/api'
import { listProjectFileVersions } from '@/lib/projects/files/application'
import { projectFileOperations } from '@/lib/projects/files/application/operations'
import { readSortedCursor, writeSortedCursor } from '@/app/api/v2/lib/response'
export const GET = defineV2JsonRoute({
  contract: v2ListProjectFileVersionsContract,
  auth: v2ApiKeyAuth,
  operation: projectFileOperations.listVersions,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2OrchestrationErrorPolicy,
  mapInput: ({ params, query }) => ({
    projectId: params.projectId,
    fileId: params.fileId,
    sortOrder: query.sortOrder,
    limit: query.limit,
    after: readSortedCursor(
      query.cursor,
      query.sortBy,
      query.sortOrder,
      cursorScopeKey(
        cursorRoute(v2ListProjectFileVersionsContract, {
          projectId: params.projectId,
          fileId: params.fileId,
        })
      )
    ),
  }),
  useCase: listProjectFileVersions,
  present: ({ versions, nextKeys }, { params, query }) => ({
    data: versions.map(toProjectFileVersion),
    nextCursor: writeSortedCursor(
      nextKeys,
      query.sortBy,
      query.sortOrder,
      cursorScopeKey(
        cursorRoute(v2ListProjectFileVersionsContract, {
          projectId: params.projectId,
          fileId: params.fileId,
        })
      )
    ),
  }),
})
