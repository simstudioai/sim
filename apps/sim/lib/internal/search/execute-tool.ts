import { getErrorMessage } from '@sim/utils/errors'
import { z } from 'zod'
import { executeSearchOperation } from '@/lib/internal/search/operations'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'

const searchInputSchema = z.object({ query: z.string().min(1) })

export const executeSearchTool: InternalToolOperationHandler = async ({
  toolId,
  input,
  context,
  signal,
}) => {
  signal?.throwIfAborted()
  if (toolId !== 'search_tool') {
    return Response.json({ error: `Unsupported Search tool: ${toolId}` }, { status: 500 })
  }
  if (!context.userId) {
    return Response.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = searchInputSchema.safeParse(input)
  if (!parsed.success) {
    return Response.json({ success: false, error: 'Invalid request data' }, { status: 400 })
  }

  try {
    return Response.json(await executeSearchOperation(parsed.data, signal))
  } catch (error) {
    signal?.throwIfAborted()
    const message = getErrorMessage(error, 'Search failed')
    return Response.json(
      { success: false, error: message },
      { status: message === 'Search service not configured' ? 503 : 500 }
    )
  }
}
