import { getErrorMessage } from '@sim/utils/errors'
import { z } from 'zod'
import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { GitHubOperationError } from '@/lib/internal/github/errors'
import {
  executeGitHubCommentOperation,
  executeGitHubCommentV2Operation,
  getGitHubLatestCommit,
} from '@/lib/internal/github/operations'
import { executeToolOperationImplementation } from '@/lib/internal/tool-operations/execute'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'

const inputSchema = z.object({
  owner: z.string().min(1, 'Owner is required'),
  repo: z.string().min(1, 'Repo is required'),
  branch: z.string().optional(),
  apiKey: z.string().min(1, 'API key is required'),
})

export const executeGitHubTool: InternalToolOperationHandler = async (request) => {
  request.signal?.throwIfAborted()
  try {
    switch (request.toolId) {
      case 'github_comment':
        return executeToolOperationImplementation(executeGitHubCommentOperation, request)
      case 'github_comment_v2':
        return executeToolOperationImplementation(executeGitHubCommentV2Operation, request)
      case 'github_latest_commit':
      case 'github_latest_commit_v2': {
        const parsed = inputSchema.safeParse(request.input)
        if (!parsed.success) {
          return Response.json({ success: false, error: 'Invalid request data' }, { status: 400 })
        }
        return Response.json(
          await getGitHubLatestCommit(parsed.data, {
            requestId: request.requestId,
            signal: request.signal,
          })
        )
      }
      default:
        return Response.json(
          { success: false, error: `Unsupported GitHub tool: ${request.toolId}` },
          { status: 500 }
        )
    }
  } catch (error) {
    request.signal?.throwIfAborted()
    const status = isPayloadSizeLimitError(error)
      ? 413
      : error instanceof GitHubOperationError
        ? error.status
        : 500
    return Response.json(
      { success: false, error: getErrorMessage(error, 'Unknown error occurred') },
      { status }
    )
  }
}
