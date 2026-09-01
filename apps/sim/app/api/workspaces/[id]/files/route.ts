import {
  createWorkspaceFileContract,
  listWorkspaceFilesContract,
} from '@/lib/api/contracts/workspace-files'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { getFileExtension, getMimeTypeFromExtension } from '@/lib/uploads/utils/file-utils'
import {
  internalFileAnalytics,
  internalFileErrorPolicies,
  internalFilePresenters,
} from '@/lib/workspace-files/api'
import {
  admitCreateWorkspaceFile,
  createWorkspaceFile,
} from '@/lib/workspace-files/application/create-workspace-file'
import { listAllWorkspaceFiles } from '@/lib/workspace-files/application/list-workspace-files'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { MAX_WORKSPACE_FILE_INLINE_BODY_BYTES } from '@/lib/workspace-files/orchestration'

export const dynamic = 'force-dynamic'

/** GET /api/workspaces/[id]/files — List workspace files. */
export const GET = defineInternalJsonRoute({
  contract: listWorkspaceFilesContract,
  auth: internalSessionAuth,
  operation: fileOperations.list,
  rateLimit: internalRateLimits.none({ reason: 'Preserve existing internal file-list behavior' }),
  errorPolicy: internalFileErrorPolicies.default,
  mapInput: ({ params, query }) => ({ workspaceId: params.id, scope: query.scope }),
  useCase: listAllWorkspaceFiles,
  present: internalFilePresenters.successFiles,
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
