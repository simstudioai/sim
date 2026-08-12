import { updateWorkspaceFileContentContract } from '@/lib/api/contracts/workspace-files'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { internalFileErrorPolicies, internalFilePresenters } from '@/lib/workspace-files/api'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import {
  admitUpdateWorkspaceFileContent,
  updateWorkspaceFileContent,
} from '@/lib/workspace-files/application/update-workspace-file-content'
import { MAX_WORKSPACE_FILE_INLINE_BODY_BYTES } from '@/lib/workspace-files/orchestration'

export const dynamic = 'force-dynamic'

/** PUT /api/workspaces/[id]/files/[fileId]/content — Replace a file's bytes. */
export const PUT = defineInternalJsonRoute({
  contract: updateWorkspaceFileContentContract,
  auth: internalSessionAuth,
  operation: fileOperations.updateContent,
  rateLimit: internalRateLimits.none({
    reason: 'Preserve existing internal content-update behavior',
  }),
  errorPolicy: internalFileErrorPolicies.concealContentAuthorization,
  parseOptions: { maxBodyBytes: MAX_WORKSPACE_FILE_INLINE_BODY_BYTES },
  beforeParse: async ({ principal, params }) => {
    if (typeof params.fileId === 'string') {
      await admitUpdateWorkspaceFileContent(principal, params.fileId)
    }
  },
  mapInput: ({ params, body }) => ({
    fileId: params.fileId,
    assertedWorkspaceId: params.id,
    content: body.content,
    encoding: body.encoding === 'base64' ? ('base64' as const) : ('utf-8' as const),
  }),
  useCase: updateWorkspaceFileContent,
  present: internalFilePresenters.successFile,
})
