import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { isPlainRecord } from '@sim/utils/object'
import { DEFAULT_MAX_JSON_BODY_BYTES } from '@/lib/api/server/validation'
import { LlmOperationError } from '@/lib/internal/llm/errors'
import { llmProviderOperationInputSchema } from '@/lib/internal/llm/input'
import { executeLlmProviderOperation } from '@/lib/internal/llm/operations'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'

const logger = createLogger('LlmToolExecution')

function invalidBodyResponse(): Response {
  return Response.json({ error: 'Invalid request body' }, { status: 400 })
}

export const executeLlmTool: InternalToolOperationHandler = async (request) => {
  request.signal?.throwIfAborted()
  if (request.toolId !== 'llm_chat') {
    return Response.json(
      { success: false, error: `Unsupported LLM tool: ${request.toolId}` },
      { status: 500 }
    )
  }
  if (!request.context.userId || !request.context.workspaceId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!isPlainRecord(request.input)) return invalidBodyResponse()

  let serializedInput: string
  try {
    serializedInput = JSON.stringify(request.input)
  } catch {
    return invalidBodyResponse()
  }
  if (Buffer.byteLength(serializedInput, 'utf8') > DEFAULT_MAX_JSON_BODY_BYTES) {
    return Response.json(
      {
        error: `Request body exceeds the maximum allowed size of ${DEFAULT_MAX_JSON_BODY_BYTES} bytes`,
      },
      { status: 413 }
    )
  }

  const parsed = llmProviderOperationInputSchema.safeParse({
    ...request.input,
    workspaceId: request.context.workspaceId,
    workflowId: request.context.workflowId,
    stream: false,
  })
  if (!parsed.success) return invalidBodyResponse()

  try {
    const result = await executeLlmProviderOperation(parsed.data, {
      actorUserId: request.context.userId,
      headers: request.headers,
      requestId: request.requestId,
      signal: request.signal,
    })
    request.signal?.throwIfAborted()
    if (result instanceof ReadableStream || ('stream' in result && 'execution' in result)) {
      throw new Error('LLM chat operation returned an unexpected streaming response')
    }
    return Response.json(result)
  } catch (error) {
    request.signal?.throwIfAborted()
    if (error instanceof LlmOperationError) {
      return Response.json(error.body, { status: error.status })
    }
    const message = getErrorMessage(error)
    logger.error(`[${request.requestId}] LLM chat operation failed`, { error: message })
    return Response.json({ error: message }, { status: 500 })
  }
}
