import { getErrorMessage } from '@sim/utils/errors'
import { z } from 'zod'
import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'
import { TypeformOperationError } from '@/lib/internal/typeform/errors'
import { downloadTypeformFile } from '@/lib/internal/typeform/operations'

const inputSchema = z.object({
  formId: z.string().min(1, 'Form ID is required'),
  responseId: z.string().min(1, 'Response ID is required'),
  fieldId: z.string().min(1, 'Field ID is required'),
  filename: z.string().min(1, 'Filename is required'),
  inline: z.boolean().optional(),
  apiKey: z.string().min(1, 'API key is required'),
})

export const executeTypeformTool: InternalToolOperationHandler = async (request) => {
  request.signal?.throwIfAborted()
  if (request.toolId !== 'typeform_files') {
    return Response.json(
      { success: false, error: `Unsupported Typeform tool: ${request.toolId}` },
      { status: 500 }
    )
  }
  const userId = request.context.userId
  if (!userId) {
    return Response.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }
  const parsed = inputSchema.safeParse(request.input)
  if (!parsed.success) {
    return Response.json({ success: false, error: 'Invalid request data' }, { status: 400 })
  }
  try {
    return Response.json(
      await downloadTypeformFile(parsed.data, {
        userId,
        workspaceId: request.context.workspaceId,
        workflowId: request.context.workflowId,
        executionId: request.context.executionId,
        signal: request.signal,
      })
    )
  } catch (error) {
    request.signal?.throwIfAborted()
    const status = isPayloadSizeLimitError(error)
      ? 413
      : error instanceof TypeformOperationError
        ? error.status
        : 500
    return Response.json(
      { success: false, error: getErrorMessage(error, 'Failed to download Typeform file') },
      { status }
    )
  }
}
