import { createLogger } from '@sim/logger'
import { getValidationErrorMessage } from '@/lib/api/server'
import { DEFAULT_MAX_JSON_BODY_BYTES } from '@/lib/api/server/validation'
import { ResendOperationError } from '@/lib/internal/resend/errors'
import { executeResendSend } from '@/lib/internal/resend/operations'
import { resendSendInputSchema } from '@/lib/internal/resend/schema'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'

const logger = createLogger('ResendToolExecution')

export const executeResendTool: InternalToolOperationHandler = async (request) => {
  request.signal?.throwIfAborted()
  if (request.toolId !== 'resend_send') {
    return Response.json(
      { success: false, message: `Unsupported Resend tool: ${request.toolId}` },
      { status: 500 }
    )
  }
  if (!request.context.userId) {
    return Response.json({ success: false, message: 'Authentication required' }, { status: 401 })
  }
  let serializedInput: string
  try {
    serializedInput = JSON.stringify(request.input) ?? ''
  } catch {
    return Response.json(
      { success: false, message: 'Invalid request data', errors: [] },
      { status: 400 }
    )
  }
  if (Buffer.byteLength(serializedInput, 'utf8') > DEFAULT_MAX_JSON_BODY_BYTES) {
    return Response.json(
      {
        error: `Request body exceeds the maximum allowed size of ${DEFAULT_MAX_JSON_BODY_BYTES} bytes`,
      },
      { status: 413 }
    )
  }
  const parsed = resendSendInputSchema.safeParse(request.input)
  if (!parsed.success) {
    return Response.json(
      {
        success: false,
        message: getValidationErrorMessage(parsed.error, 'Invalid request data'),
        errors: parsed.error.issues,
      },
      { status: 400 }
    )
  }

  try {
    const result = await executeResendSend(parsed.data, request.signal)
    request.signal?.throwIfAborted()
    return Response.json(result)
  } catch (error) {
    request.signal?.throwIfAborted()
    if (error instanceof ResendOperationError) {
      return Response.json(error.body, { status: error.status })
    }
    logger.error('Resend send failed', { requestId: request.requestId })
    return Response.json(
      { success: false, message: 'Internal server error while sending email', data: {} },
      { status: 500 }
    )
  }
}
