import { getErrorMessage } from '@sim/utils/errors'
import { BufferOperationError } from '@/lib/internal/buffer/errors'
import { bufferCreatePostInputSchema, bufferEditPostInputSchema } from '@/lib/internal/buffer/input'
import { createBufferPost, editBufferPost } from '@/lib/internal/buffer/operations'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'

export const executeBufferTool: InternalToolOperationHandler = async (request) => {
  request.signal?.throwIfAborted()
  const userId = request.context.userId
  if (!userId) {
    return Response.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const context = { userId, requestId: request.requestId, signal: request.signal }
    if (request.toolId === 'buffer_create_post') {
      const parsed = bufferCreatePostInputSchema.safeParse(request.input)
      if (!parsed.success) {
        return Response.json({ success: false, error: 'Invalid request data' }, { status: 400 })
      }
      return Response.json(await createBufferPost(parsed.data, context))
    }
    if (request.toolId === 'buffer_edit_post') {
      const parsed = bufferEditPostInputSchema.safeParse(request.input)
      if (!parsed.success) {
        return Response.json({ success: false, error: 'Invalid request data' }, { status: 400 })
      }
      return Response.json(await editBufferPost(parsed.data, context))
    }
    return Response.json(
      { success: false, error: `Unsupported Buffer tool: ${request.toolId}` },
      { status: 500 }
    )
  } catch (error) {
    request.signal?.throwIfAborted()
    if (error instanceof BufferOperationError) {
      return Response.json({ success: false, error: error.message }, { status: error.status })
    }
    return Response.json(
      { success: false, error: getErrorMessage(error, 'Buffer operation failed') },
      { status: 500 }
    )
  }
}
