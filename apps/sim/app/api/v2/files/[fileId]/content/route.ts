import { v2UpdateFileContentContract } from '@/lib/api/contracts/v2/files'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2FileErrorPolicies } from '@/lib/workspace-files/api'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import {
  admitUpdateWorkspaceFileContent,
  updateWorkspaceFileContent,
} from '@/lib/workspace-files/application/update-workspace-file-content'
import { MAX_WORKSPACE_FILE_INLINE_BODY_BYTES } from '@/lib/workspace-files/orchestration'
import { toV2File } from '@/app/api/v2/files/utils'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** PUT /api/v2/files/[fileId]/content — Replace a file's bytes. */
export const PUT = defineV2JsonRoute({
  contract: v2UpdateFileContentContract,
  auth: v2ApiKeyAuth,
  operation: fileOperations.updateContent,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2FileErrorPolicies.concealResourceAuthorization,
  parseOptions: {
    maxBodyBytes: MAX_WORKSPACE_FILE_INLINE_BODY_BYTES,
  },
  beforeParse: async ({ principal, params }) => {
    if (typeof params.fileId === 'string') {
      await admitUpdateWorkspaceFileContent(principal, params.fileId)
    }
  },
  mapInput: ({ params, body }) => ({
    fileId: params.fileId,
    assertedWorkspaceId: body.workspaceId,
    content: body.content,
    encoding: body.encoding,
  }),
  useCase: updateWorkspaceFileContent,
  present: async ({ file }) => ({ data: await toV2File(file) }),
})
