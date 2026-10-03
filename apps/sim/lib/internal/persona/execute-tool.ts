import { getErrorMessage } from '@sim/utils/errors'
import { z } from 'zod'
import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { PersonaOperationError } from '@/lib/internal/persona/errors'
import { importPersonaAccounts } from '@/lib/internal/persona/operations'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'
import { RawFileInputSchema } from '@/lib/uploads/utils/file-schemas'
import { docNotReadyResponse } from '@/lib/uploads/utils/servable-file-response'

const inputSchema = z.object({
  apiKey: z.string().min(1, 'Persona API key is required'),
  file: RawFileInputSchema,
})

export const executePersonaTool: InternalToolOperationHandler = async (request) => {
  request.signal?.throwIfAborted()
  if (request.toolId !== 'persona_import_accounts') {
    return Response.json(
      { success: false, error: `Unsupported Persona tool: ${request.toolId}` },
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
      await importPersonaAccounts(parsed.data, {
        userId,
        requestId: request.requestId,
        signal: request.signal,
      })
    )
  } catch (error) {
    request.signal?.throwIfAborted()
    const notReady = docNotReadyResponse(error)
    if (notReady) return notReady
    const status = isPayloadSizeLimitError(error)
      ? 413
      : error instanceof PersonaOperationError
        ? error.status
        : 500
    return Response.json(
      { success: false, error: getErrorMessage(error, 'Internal server error') },
      { status }
    )
  }
}
