import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { isPlainRecord } from '@sim/utils/object'
import { DEFAULT_MAX_JSON_BODY_BYTES } from '@/lib/api/server/validation'
import { GuardrailsOperationError } from '@/lib/internal/guardrails/errors'
import { guardrailsValidationInputSchema } from '@/lib/internal/guardrails/input'
import { executeGuardrailsValidation } from '@/lib/internal/guardrails/operations'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'
import { isAbortError } from '@/providers/streaming-tool-loop-shared'

const logger = createLogger('GuardrailsToolExecution')

function unexpectedFailure(error: unknown, requestId: string): Response {
  const message = getErrorMessage(error, 'Validation failed due to unexpected error')
  logger.error(`[${requestId}] Guardrails validation failed`, { error: message })
  return Response.json({
    success: true,
    output: {
      passed: false,
      validationType: 'unknown',
      input: '',
      error: message,
    },
  })
}

export const executeGuardrailsTool: InternalToolOperationHandler = async (request) => {
  request.signal?.throwIfAborted()
  if (request.toolId !== 'guardrails_validate') {
    return Response.json(
      { success: false, error: `Unsupported Guardrails tool: ${request.toolId}` },
      { status: 500 }
    )
  }
  if (!request.context.userId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!isPlainRecord(request.input)) {
    return Response.json({ error: 'Invalid request data' }, { status: 400 })
  }

  let serializedInput: string
  try {
    serializedInput = JSON.stringify(request.input)
  } catch {
    return Response.json({ error: 'Invalid request data' }, { status: 400 })
  }
  if (Buffer.byteLength(serializedInput, 'utf8') > DEFAULT_MAX_JSON_BODY_BYTES) {
    return Response.json(
      {
        error: `Request body exceeds the maximum allowed size of ${DEFAULT_MAX_JSON_BODY_BYTES} bytes`,
      },
      { status: 413 }
    )
  }

  const parsed = guardrailsValidationInputSchema.safeParse({
    ...request.input,
    workflowId: request.context.workflowId,
  })
  if (!parsed.success) {
    return Response.json(
      { error: 'Invalid request data', details: parsed.error.issues },
      { status: 400 }
    )
  }

  try {
    const result = await executeGuardrailsValidation(parsed.data, {
      actorUserId: request.context.userId,
      executionContext: request.context,
      headers: request.headers,
      requestId: request.requestId,
      signal: request.signal,
    })
    request.signal?.throwIfAborted()
    return Response.json(result)
  } catch (error) {
    if (isAbortError(error) || request.signal?.aborted) throw error
    if (error instanceof GuardrailsOperationError) {
      return Response.json(error.body, { status: error.status })
    }
    return unexpectedFailure(error, request.requestId)
  }
}
