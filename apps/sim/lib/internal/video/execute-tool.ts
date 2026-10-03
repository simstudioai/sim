import { getErrorMessage } from '@sim/utils/errors'
import { videoToolBodySchema } from '@/lib/api/contracts/tools/media/video'
import { getValidationErrorMessage } from '@/lib/api/server'
import { DEFAULT_MAX_JSON_BODY_BYTES } from '@/lib/api/server/validation'
import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'
import type { VideoProvider } from '@/lib/internal/video/client'
import { VideoOperationError } from '@/lib/internal/video/errors'
import { executeVideoOperation } from '@/lib/internal/video/operations'

const VIDEO_TOOL_IDS = new Set([
  'video_falai',
  'video_luma',
  'video_minimax',
  'video_runway',
  'video_veo',
])

function parseInput(input: unknown): Response | ReturnType<typeof videoToolBodySchema.parse> {
  let serialized: string
  try {
    serialized = JSON.stringify(input) ?? ''
  } catch {
    return Response.json({ error: 'Invalid request data' }, { status: 400 })
  }
  if (Buffer.byteLength(serialized, 'utf8') > DEFAULT_MAX_JSON_BODY_BYTES) {
    return Response.json(
      {
        error: `Request body exceeds the maximum allowed size of ${DEFAULT_MAX_JSON_BODY_BYTES} bytes`,
      },
      { status: 413 }
    )
  }
  const parsed = videoToolBodySchema.safeParse(input)
  if (!parsed.success) {
    return Response.json(
      {
        error: getValidationErrorMessage(parsed.error, 'Invalid request data'),
        details: parsed.error.issues,
      },
      { status: 400 }
    )
  }
  return parsed.data
}

export const executeVideoTool: InternalToolOperationHandler = async (request) => {
  request.signal?.throwIfAborted()
  if (!VIDEO_TOOL_IDS.has(request.toolId)) {
    return Response.json(
      { success: false, error: `Unsupported Video tool: ${request.toolId}` },
      { status: 500 }
    )
  }
  const userId = request.context.userId
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const input = parseInput(request.input)
  if (input instanceof Response) return input

  try {
    const result = await executeVideoOperation(
      { ...input, provider: input.provider as VideoProvider },
      {
        headers: request.headers,
        requestId: request.requestId,
        signal: request.signal,
        userId,
        workspaceId: request.context.workspaceId,
        workflowId: request.context.workflowId,
        executionId: request.context.executionId,
      }
    )
    request.signal?.throwIfAborted()
    return Response.json(result)
  } catch (error) {
    request.signal?.throwIfAborted()
    if (error instanceof VideoOperationError) {
      return Response.json(error.body, { status: error.status })
    }
    return Response.json(
      { error: getErrorMessage(error, 'Video generation failed') },
      { status: isPayloadSizeLimitError(error) ? 413 : 500 }
    )
  }
}
