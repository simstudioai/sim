import { getValidationErrorMessage } from '@/lib/api/server'
import { DEFAULT_MAX_JSON_BODY_BYTES } from '@/lib/api/server/validation'
import { executeImageGeneration } from '@/lib/internal/image/operations'
import { imageGenerationInputSchema } from '@/lib/internal/image/schema'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'

export const executeImageTool: InternalToolOperationHandler = async (request) => {
  request.signal?.throwIfAborted()
  if (!request.context.userId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (request.toolId !== 'image_generate') {
    return Response.json({ error: `Unsupported image tool: ${request.toolId}` }, { status: 500 })
  }

  let serializedInput: string
  try {
    serializedInput = JSON.stringify(request.input) ?? ''
  } catch {
    return Response.json({ error: 'Invalid request data' }, { status: 400 })
  }
  if (Buffer.byteLength(serializedInput, 'utf8') > DEFAULT_MAX_JSON_BODY_BYTES) {
    return Response.json(
      {
        error: `Request body exceeds the maximum allowed size of ${DEFAULT_MAX_JSON_BODY_BYTES} bytes`,
      },
      { status: 413 }
    )
  }

  const parsed = imageGenerationInputSchema.safeParse(request.input)
  if (!parsed.success) {
    return Response.json(
      { error: getValidationErrorMessage(parsed.error, 'Invalid request data') },
      { status: 400 }
    )
  }

  return executeImageGeneration(parsed.data, {
    userId: request.context.userId,
    workspaceId: request.context.workspaceId,
    workflowId: request.context.workflowId,
    executionId: request.context.executionId,
    requestId: request.requestId,
    signal: request.signal,
  })
}
