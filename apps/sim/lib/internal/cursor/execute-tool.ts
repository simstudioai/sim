import { z } from 'zod'
import { CursorOperationError } from '@/lib/internal/cursor/errors'
import {
  cursorOperationErrorMessage,
  downloadCursorArtifact,
} from '@/lib/internal/cursor/operations'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'

const inputSchema = z.object({
  apiKey: z.string().min(1, 'API key is required'),
  agentId: z.string().min(1, 'Agent ID is required'),
  path: z.string().min(1, 'Artifact path is required'),
})

export const executeCursorTool: InternalToolOperationHandler = async (request) => {
  request.signal?.throwIfAborted()
  if (
    request.toolId !== 'cursor_download_artifact' &&
    request.toolId !== 'cursor_download_artifact_v2'
  ) {
    return Response.json(
      { success: false, error: `Unsupported Cursor tool: ${request.toolId}` },
      { status: 500 }
    )
  }
  const parsed = inputSchema.safeParse(request.input)
  if (!parsed.success) {
    return Response.json({ success: false, error: 'Invalid request data' }, { status: 400 })
  }

  try {
    return Response.json(
      await downloadCursorArtifact(parsed.data, {
        requestId: request.requestId,
        signal: request.signal,
      })
    )
  } catch (error) {
    request.signal?.throwIfAborted()
    const status = error instanceof CursorOperationError ? error.status : 500
    return Response.json({ success: false, error: cursorOperationErrorMessage(error) }, { status })
  }
}
