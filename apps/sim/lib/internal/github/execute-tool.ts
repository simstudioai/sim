import { getErrorMessage } from '@sim/utils/errors'
import { z } from 'zod'
import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { GitHubOperationError } from '@/lib/internal/github/errors'
import { getGitHubLatestCommit } from '@/lib/internal/github/operations'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'

const TOOL_IDS = new Set(['github_latest_commit', 'github_latest_commit_v2'])

const inputSchema = z.object({
  owner: z.string().min(1, 'Owner is required'),
  repo: z.string().min(1, 'Repo is required'),
  branch: z.string().optional(),
  apiKey: z.string().min(1, 'API key is required'),
})

export const executeGitHubTool: InternalToolOperationHandler = async (request) => {
  request.signal?.throwIfAborted()
  if (!TOOL_IDS.has(request.toolId)) {
    return Response.json(
      { success: false, error: `Unsupported GitHub tool: ${request.toolId}` },
      { status: 500 }
    )
  }
  const parsed = inputSchema.safeParse(request.input)
  if (!parsed.success) {
    return Response.json({ success: false, error: 'Invalid request data' }, { status: 400 })
  }
  try {
    return Response.json(
      await getGitHubLatestCommit(parsed.data, {
        requestId: request.requestId,
        signal: request.signal,
      })
    )
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
