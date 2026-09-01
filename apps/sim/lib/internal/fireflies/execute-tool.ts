import { getValidationErrorMessage } from '@/lib/api/server'
import { executeFirefliesUploadAudio } from '@/lib/internal/fireflies/operations'
import { firefliesUploadAudioInputSchema } from '@/lib/internal/fireflies/schema'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'

export const executeFirefliesTool: InternalToolOperationHandler = async (request) => {
  request.signal?.throwIfAborted()
  if (request.toolId !== 'fireflies_upload_audio') {
    return Response.json(
      { error: `Unsupported Fireflies tool: ${request.toolId}` },
      { status: 500 }
    )
  }
  if (!request.context.userId) {
    return Response.json({ errors: [{ message: 'Unauthorized' }] }, { status: 401 })
  }

  const parsed = firefliesUploadAudioInputSchema.safeParse(request.input)
  if (!parsed.success) {
    return Response.json(
      { errors: [{ message: getValidationErrorMessage(parsed.error, 'Invalid request data') }] },
      { status: 400 }
    )
  }

  return executeFirefliesUploadAudio(parsed.data, {
    headers: request.headers,
    userId: request.context.userId,
    requestId: request.requestId,
    signal: request.signal,
  })
}
