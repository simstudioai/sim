import { getValidationErrorMessage } from '@/lib/api/server'
import { DEFAULT_MAX_JSON_BODY_BYTES } from '@/lib/api/server/validation'
import { executeEnrichment } from '@/lib/internal/enrichment/operations'
import { enrichmentInputSchema } from '@/lib/internal/enrichment/schema'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'

export const executeEnrichmentTool: InternalToolOperationHandler = async (request) => {
  request.signal?.throwIfAborted()
  if (!request.context.userId || !request.context.workspaceId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (request.toolId !== 'enrichment_run') {
    return Response.json(
      { error: `Unsupported enrichment tool: ${request.toolId}` },
      { status: 500 }
    )
  }

  let serializedInput: string
  try {
    serializedInput = JSON.stringify(request.input) ?? ''
  } catch {
    return Response.json({ error: 'Invalid request' }, { status: 400 })
  }
  if (Buffer.byteLength(serializedInput, 'utf8') > DEFAULT_MAX_JSON_BODY_BYTES) {
    return Response.json(
      {
        error: `Request body exceeds the maximum allowed size of ${DEFAULT_MAX_JSON_BODY_BYTES} bytes`,
      },
      { status: 413 }
    )
  }

  const parsed = enrichmentInputSchema.safeParse(request.input)
  if (!parsed.success) {
    return Response.json(
      { error: getValidationErrorMessage(parsed.error, 'Invalid request') },
      { status: 400 }
    )
  }

  return executeEnrichment(parsed.data, {
    workspaceId: request.context.workspaceId,
    signal: request.signal,
    resolvedSecretTraceRegistry: request.context.resolvedSecretTraceRegistry,
  })
}
