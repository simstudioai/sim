import { getValidationErrorMessage } from '@/lib/api/server'
import { executeSquareCreateCatalogImage } from '@/lib/internal/square/operations'
import { squareCatalogImageInputSchema } from '@/lib/internal/square/schema'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'

export const executeSquareTool: InternalToolOperationHandler = async (request) => {
  request.signal?.throwIfAborted()
  if (request.toolId !== 'square_create_catalog_image') {
    return Response.json({ error: `Unsupported Square tool: ${request.toolId}` }, { status: 500 })
  }
  if (!request.context.userId) {
    return Response.json({ success: false, error: 'Authentication required' }, { status: 401 })
  }

  const parsed = squareCatalogImageInputSchema.safeParse(request.input)
  if (!parsed.success) {
    return Response.json(
      { success: false, error: getValidationErrorMessage(parsed.error, 'Invalid request data') },
      { status: 400 }
    )
  }

  return executeSquareCreateCatalogImage(parsed.data, {
    userId: request.context.userId,
    requestId: request.requestId,
    signal: request.signal,
  })
}
