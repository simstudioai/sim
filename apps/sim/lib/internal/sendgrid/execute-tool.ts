import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { DEFAULT_MAX_JSON_BODY_BYTES } from '@/lib/api/server/validation'
import { SendGridOperationError } from '@/lib/internal/sendgrid/errors'
import { executeSendGridSend } from '@/lib/internal/sendgrid/operations'
import { sendGridSendInputSchema } from '@/lib/internal/sendgrid/schema'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'

const logger = createLogger('SendGridToolExecution')

export const executeSendGridTool: InternalToolOperationHandler = async (request) => {
  request.signal?.throwIfAborted()
  if (request.toolId !== 'sendgrid_send_mail') {
    return Response.json(
      { success: false, error: `Unsupported SendGrid tool: ${request.toolId}` },
      { status: 500 }
    )
  }
  if (!request.context.userId) {
    return Response.json({ success: false, error: 'Authentication required' }, { status: 401 })
  }
  let serializedInput: string
  try {
    serializedInput = JSON.stringify(request.input) ?? ''
  } catch {
    return Response.json({ error: 'Validation error', details: [] }, { status: 400 })
  }
  if (Buffer.byteLength(serializedInput, 'utf8') > DEFAULT_MAX_JSON_BODY_BYTES) {
    return Response.json(
      {
        error: `Request body exceeds the maximum allowed size of ${DEFAULT_MAX_JSON_BODY_BYTES} bytes`,
      },
      { status: 413 }
    )
  }
  const parsed = sendGridSendInputSchema.safeParse(request.input)
  if (!parsed.success) {
    return Response.json(
      { error: 'Validation error', details: parsed.error.issues },
      { status: 400 }
    )
  }

  try {
    const result = await executeSendGridSend(parsed.data, {
      headers: request.headers,
      requestId: request.requestId,
      signal: request.signal,
      userId: request.context.userId,
    })
    request.signal?.throwIfAborted()
    return Response.json(result)
  } catch (error) {
    request.signal?.throwIfAborted()
    if (error instanceof SendGridOperationError) {
      return Response.json(error.body, { status: error.status })
    }
    const message = getErrorMessage(error, 'Unknown error')
    logger.error('SendGrid send failed', { error: message, requestId: request.requestId })
    return Response.json({ success: false, error: message }, { status: 500 })
  }
}
