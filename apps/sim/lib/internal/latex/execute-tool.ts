import { getErrorMessage } from '@sim/utils/errors'
import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { LatexOperationError } from '@/lib/internal/latex/errors'
import { compileLatexDocument } from '@/lib/internal/latex/operations'
import { latexCompileInputSchema } from '@/lib/internal/latex/schema'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'

export const executeLatexTool: InternalToolOperationHandler = async (request) => {
  request.signal?.throwIfAborted()
  if (request.toolId !== 'latex_compile') {
    return Response.json(
      { success: false, error: `Unsupported LaTeX tool: ${request.toolId}` },
      { status: 500 }
    )
  }
  const userId = request.context.userId
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const parsed = latexCompileInputSchema.safeParse(request.input)
  if (!parsed.success) {
    return Response.json({ error: 'Invalid request data' }, { status: 400 })
  }
  try {
    return Response.json(
      await compileLatexDocument(parsed.data, {
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
      : error instanceof LatexOperationError
        ? error.status
        : 500
    return Response.json({ error: getErrorMessage(error, 'LaTeX compilation failed') }, { status })
  }
}
