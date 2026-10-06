import {
  createProjectFileContract,
  listProjectFilesContract,
} from '@/lib/api/contracts/project-files'
import { canonicalUnorderedArray, cursorRoute, cursorScopeKey } from '@/lib/api/cursor-binding'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import {
  createProjectFile,
  listProjectFileItems,
  projectFileOperations,
} from '@/lib/projects/files/application'
import { getFileExtension, getMimeTypeFromExtension } from '@/lib/uploads/utils/file-utils'
import { MAX_WORKSPACE_FILE_INLINE_BODY_BYTES } from '@/lib/workspace-files/orchestration'
import { readSortedCursor, writeSortedCursor } from '@/app/api/v2/lib/response'

function cursorFilters(
  id: string,
  query: {
    scope?: 'active' | 'archived'
    folderId?: string | null
    types?: readonly string[]
    sizes?: readonly string[]
    creatorIds?: readonly string[]
    search?: string
  }
) {
  return cursorScopeKey(cursorRoute(listProjectFilesContract, { id }), {
    scope: query.scope,
    folderId: query.search || query.scope === 'archived' ? undefined : (query.folderId ?? null),
    types: canonicalUnorderedArray(query.types ?? []),
    sizes: canonicalUnorderedArray(query.sizes ?? []),
    creatorIds: canonicalUnorderedArray(query.creatorIds ?? []),
    search: query.search,
  })
}

export const GET = defineInternalJsonRoute({
  contract: listProjectFilesContract,
  auth: internalSessionAuth,
  operation: projectFileOperations.list,
  rateLimit: internalRateLimits.user({ bucketName: 'project-files.read' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params, query }) => ({
    projectId: params.id,
    scope: query.scope,
    folderId: query.search || query.scope === 'archived' ? undefined : (query.folderId ?? null),
    types: query.types,
    sizes: query.sizes,
    creatorIds: query.creatorIds,
    search: query.search,
    sortBy: query.sortBy,
    sortOrder: query.sortOrder,
    limit: query.limit,
    after: readSortedCursor(
      query.cursor,
      query.sortBy,
      query.sortOrder,
      cursorFilters(params.id, query)
    ),
  }),
  useCase: listProjectFileItems,
  present: ({ files, items, creators, nextKeys, capabilities }, { input }) => ({
    files,
    items,
    creators,
    capabilities,
    nextCursor: writeSortedCursor(
      nextKeys,
      input.sortBy,
      input.sortOrder,
      cursorFilters(input.projectId, input)
    ),
  }),
})

export const POST = defineInternalJsonRoute({
  contract: createProjectFileContract,
  auth: internalSessionAuth,
  operation: projectFileOperations.create,
  rateLimit: internalRateLimits.user({ bucketName: 'project-files.write' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  parseOptions: { maxBodyBytes: MAX_WORKSPACE_FILE_INLINE_BODY_BYTES },
  beforeParse: async ({ principal, params }) => {
    if (typeof params.id === 'string')
      await createProjectFile.authorize({
        principal,
        input: {
          projectId: params.id,
          name: 'admission',
          contentType: 'application/octet-stream',
          content: '',
          encoding: 'utf-8',
        },
      })
  },
  mapInput: ({ params, body }) => ({
    projectId: params.id,
    name: body.name,
    contentType: body.contentType ?? getMimeTypeFromExtension(getFileExtension(body.name)),
    content: body.content,
    encoding: body.encoding,
    exactName: body.exactName,
    folderId: body.folderId,
    folderPath: body.folderPath,
  }),
  useCase: createProjectFile,
  present: (result) => result,
})
