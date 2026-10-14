import { listsSubfolders } from '@/lib/api/contracts/v2/files'
import {
  type V2ListProjectFilesQuery,
  v2CreateProjectFileContract,
  v2ListProjectFilesContract,
} from '@/lib/api/contracts/v2/project-files'
import { cursorRoute, cursorScopeKey } from '@/lib/api/cursor-binding'
import {
  defineV2JsonRoute,
  v2ApiKeyAuth,
  v2OrchestrationErrorPolicy,
  v2RateLimits,
} from '@/lib/api/server/routes'
import { toV2ProjectFile } from '@/lib/projects/files/api/presenters'
import { createProjectFile, listProjectFiles } from '@/lib/projects/files/application'
import { projectFileOperations } from '@/lib/projects/files/application/operations'
import { getFileExtension, getMimeTypeFromExtension } from '@/lib/uploads/utils/file-utils'
import { MAX_WORKSPACE_FILE_INLINE_BODY_BYTES } from '@/lib/workspace-files/orchestration'
import { readSortedCursor, writeSortedCursor } from '@/app/api/v2/lib/response'

function cursorFilters(projectId: string, query: V2ListProjectFilesQuery) {
  return cursorScopeKey(cursorRoute(v2ListProjectFilesContract, { projectId }), {
    scope: query.scope,
    folderPath: query.folderPath,
    recursive: String(listsSubfolders(query)),
    search: query.search,
  })
}

export const GET = defineV2JsonRoute({
  contract: v2ListProjectFilesContract,
  auth: v2ApiKeyAuth,
  operation: projectFileOperations.list,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2OrchestrationErrorPolicy,
  mapInput: ({ params, query }) => ({
    projectId: params.projectId,
    scope: query.scope,
    folderPath: query.folderPath,
    recursive: listsSubfolders(query),
    search: query.search,
    sortBy: query.sortBy,
    sortOrder: query.sortOrder,
    limit: query.limit,
    after: readSortedCursor(
      query.cursor,
      query.sortBy,
      query.sortOrder,
      cursorFilters(params.projectId, query)
    ),
  }),
  useCase: listProjectFiles,
  present: ({ files, nextKeys }, { params, query }) => ({
    data: files.map(toV2ProjectFile),
    nextCursor: writeSortedCursor(
      nextKeys,
      query.sortBy,
      query.sortOrder,
      cursorFilters(params.projectId, query)
    ),
  }),
})

export const POST = defineV2JsonRoute({
  contract: v2CreateProjectFileContract,
  auth: v2ApiKeyAuth,
  operation: projectFileOperations.create,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2OrchestrationErrorPolicy,
  parseOptions: { maxBodyBytes: MAX_WORKSPACE_FILE_INLINE_BODY_BYTES },
  mapInput: ({ params, body }) => ({
    projectId: params.projectId,
    name: body.name,
    contentType: body.contentType ?? getMimeTypeFromExtension(getFileExtension(body.name)),
    content: body.content,
    encoding: body.encoding,
    folderPath: body.folderPath ?? '/',
    exactName: true,
  }),
  useCase: createProjectFile,
  present: ({ file }) => ({ data: toV2ProjectFile(file) }),
})
