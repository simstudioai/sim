import { v2UpdateFileContentContract } from '@/lib/api/contracts/v2/files'
import { messageForOrchestrationError } from '@/lib/core/orchestration/types'
import {
  MAX_WORKSPACE_FILE_INLINE_BODY_BYTES,
  performUpdateWorkspaceFileContent,
} from '@/lib/workspace-files/orchestration'
import { withPublicApiRouteHandler } from '@/app/api/public-api-route-handler'
import { resolveWorkspaceAccess } from '@/app/api/v1/middleware'
import { toV2File } from '@/app/api/v2/files/utils'
import {
  v2Data,
  v2Error,
  v2ErrorForOrchestration,
  v2WorkspaceAccessError,
} from '@/app/api/v2/lib/response'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * PUT /api/v2/files/[fileId]/content — Replace a file's bytes.
 *
 * A full replace, not an append: `content` becomes the entire body of the file.
 * `encoding: 'base64'` carries non-UTF-8 bytes. The decoded body is capped at
 * 50 MB and still debits the workspace storage quota, so a write that would push
 * the payer past its limit fails with 413.
 */
export const PUT = withPublicApiRouteHandler({
  contract: v2UpdateFileContentContract,
  rateLimitEndpoint: 'file-content',
  parseOptions: {
    invalidJsonResponse: () => v2Error('BAD_REQUEST', 'Request body must be valid JSON'),
    maxBodyBytes: MAX_WORKSPACE_FILE_INLINE_BODY_BYTES,
    payloadTooLargeResponse: () => v2Error('PAYLOAD_TOO_LARGE', 'Request body is too large'),
  },
  handler: async ({ request, input, auth: { userId, rateLimit } }) => {
    const { fileId } = input.params
    const { workspaceId, content, encoding } = input.body

    const access = await resolveWorkspaceAccess(rateLimit, userId, workspaceId, 'write')
    if (access) return v2WorkspaceAccessError(access)

    const result = await performUpdateWorkspaceFileContent({
      workspaceId,
      fileId,
      userId,
      content,
      encoding,
      request,
    })

    if (!result.success || !result.file) {
      return v2ErrorForOrchestration(
        result.errorCode,
        messageForOrchestrationError(result, 'Failed to update file content')
      )
    }

    return v2Data(await toV2File(result.file), { rateLimit })
  },
})
