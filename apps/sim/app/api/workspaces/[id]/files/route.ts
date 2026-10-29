import {
  createWorkspaceFileContract,
  listWorkspaceFilesContract,
} from '@/lib/api/contracts/workspace-files'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { getFileExtension, getMimeTypeFromExtension } from '@/lib/uploads/utils/file'
import {
  internalFileAnalytics,
  internalFileErrorPolicies,
  internalFilePresenters,
} from '@/lib/workspace-files/api'
import {
  presentWorkspaceFileList,
  toWorkspaceFileListInput,
} from '@/lib/workspace-files/api/list-page'
import {
  admitCreateWorkspaceFile,
  createWorkspaceFile,
} from '@/lib/workspace-files/application/create-workspace-file'
import { listWorkspaceFileCollection } from '@/lib/workspace-files/application/list-workspace-files'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { MAX_WORKSPACE_FILE_INLINE_BODY_BYTES } from '@/lib/workspace-files/orchestration'

export const dynamic = 'force-dynamic'

/**
 * GET /api/workspaces/[id]/files — List workspace files: one bounded page with `nextCursor`
 * when any paging param is sent, else the whole scope.
 */
export const GET = defineInternalJsonRoute({
  contract: listWorkspaceFilesContract,
  auth: internalSessionAuth,
  operation: fileOperations.list,
  // One policy per route: paged requests share the unpaged list's exemption until the builder
  // can choose a policy per request.
  rateLimit: internalRateLimits.none({ reason: 'Preserve existing internal file-list behavior' }),
  errorPolicy: internalFileErrorPolicies.default,
  mapInput: ({ params, query }) => toWorkspaceFileListInput(params.id, query),
  useCase: listWorkspaceFileCollection,
  present: (result, { input }) => presentWorkspaceFileList(result, input),
})

/** POST /api/workspaces/[id]/files — Create an authored workspace file. */
export const POST = defineInternalJsonRoute({
  contract: createWorkspaceFileContract,
  auth: internalSessionAuth,
  operation: fileOperations.create,
  rateLimit: internalRateLimits.none({ reason: 'Preserve existing internal file-create behavior' }),
  errorPolicy: internalFileErrorPolicies.default,
  parseOptions: { maxBodyBytes: MAX_WORKSPACE_FILE_INLINE_BODY_BYTES },
  beforeParse: async ({ principal, params }) => {
    if (typeof params.id === 'string') await admitCreateWorkspaceFile(principal, params.id)
  },
  mapInput: ({ params, body }) => ({
    workspaceId: params.id,
    name: body.name,
    contentType: body.contentType ?? getMimeTypeFromExtension(getFileExtension(body.name)),
    content: body.content,
    encoding: body.encoding,
    folderId: body.folderId,
    exactName: false,
  }),
  useCase: createWorkspaceFile,
  onSuccess: internalFileAnalytics.uploaded,
  present: internalFilePresenters.successFile,
})
