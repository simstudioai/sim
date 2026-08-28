import { DEFAULT_MAX_JSON_BODY_BYTES } from '@/lib/api/server/validation'
import { SmtpOperationError } from '@/lib/internal/smtp/errors'
import { executeSmtpSend } from '@/lib/internal/smtp/operations'
import { smtpSendInputSchema } from '@/lib/internal/smtp/schema'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'

export const executeSmtpTool: InternalToolOperationHandler = async (request) => {
  request.signal?.throwIfAborted()
  if (request.toolId !== 'smtp_send_mail') {
    return Response.json(
      { success: false, error: `Unsupported SMTP tool: ${request.toolId}` },
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
  const parsed = smtpSendInputSchema.safeParse(request.input)
  if (!parsed.success) {
    return Response.json(
      { error: 'Validation error', details: parsed.error.issues },
      { status: 400 }
    )
  }
  try {
    const result = await executeSmtpSend(parsed.data, {
      requestId: request.requestId,
      signal: request.signal,
      userId: request.context.userId,
    })
    request.signal?.throwIfAborted()
    return Response.json(result)
  } catch (error) {
    request.signal?.throwIfAborted()
    if (error instanceof SmtpOperationError) {
      return Response.json(error.body, { status: error.status })
    }
    return Response.json(
      { success: false, error: 'Failed to send email via SMTP' },
      { status: 500 }
    )
  }
}
