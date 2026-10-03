import { getValidationErrorMessage } from '@/lib/api/server'
import { executeFirecrawlParse } from '@/lib/internal/firecrawl/operations'
import { firecrawlParseInputSchema } from '@/lib/internal/firecrawl/schema'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'

export const executeFirecrawlTool: InternalToolOperationHandler = async (request) => {
  request.signal?.throwIfAborted()
  if (request.toolId !== 'firecrawl_parse') {
    return Response.json(
      { error: `Unsupported Firecrawl tool: ${request.toolId}` },
      { status: 500 }
    )
  }
  if (!request.context.userId) {
    return Response.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = firecrawlParseInputSchema.safeParse(request.input)
  if (!parsed.success) {
    return Response.json(
      { success: false, error: getValidationErrorMessage(parsed.error, 'Invalid request data') },
      { status: 400 }
    )
  }

  return executeFirecrawlParse(parsed.data, {
    headers: request.headers,
    userId: request.context.userId,
    requestId: request.requestId,
    signal: request.signal,
  })
}
