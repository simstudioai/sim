import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { z } from 'zod'
import { DEFAULT_MAX_JSON_BODY_BYTES } from '@/lib/api/server/validation'
import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { JiraOperationError } from '@/lib/internal/jira/errors'
import {
  jiraAddAttachmentInputSchema,
  jiraUpdateInputSchema,
  jiraWriteInputSchema,
} from '@/lib/internal/jira/input'
import {
  executeJiraAddAttachment,
  executeJiraUpdate,
  executeJiraWrite,
  type JiraOperationContext,
} from '@/lib/internal/jira/operations'
import type {
  InternalToolOperationCall,
  InternalToolOperationHandler,
} from '@/lib/internal/tool-operations/types'

const logger = createLogger('JiraToolExecution')

function unauthorizedResponse(toolId: string): Response {
  return toolId === 'jira_add_attachment'
    ? Response.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    : Response.json({ error: 'Unauthorized' }, { status: 401 })
}

function validateInput<S extends z.ZodType>(schema: S, input: unknown): z.output<S> | Response {
  const parsed = schema.safeParse(input)
  return parsed.success
    ? parsed.data
    : Response.json(
        { error: 'Invalid request data', details: parsed.error.issues },
        { status: 400 }
      )
}

async function dispatch(
  request: InternalToolOperationCall,
  context: JiraOperationContext
): Promise<unknown | Response> {
  switch (request.toolId) {
    case 'jira_write': {
      const input = validateInput(jiraWriteInputSchema, request.input)
      return input instanceof Response ? input : executeJiraWrite(input, context)
    }
    case 'jira_update': {
      const input = validateInput(jiraUpdateInputSchema, request.input)
      return input instanceof Response ? input : executeJiraUpdate(input, context)
    }
    case 'jira_add_attachment': {
      const input = validateInput(jiraAddAttachmentInputSchema, request.input)
      return input instanceof Response ? input : executeJiraAddAttachment(input, context)
    }
    default:
      return Response.json(
        { success: false, error: `Unsupported Jira tool: ${request.toolId}` },
        { status: 500 }
      )
  }
}

function unexpectedErrorResponse(request: InternalToolOperationCall, error: unknown): Response {
  const message = getErrorMessage(error, 'Internal server error')
  logger.error('Jira operation failed', {
    error: message,
    requestId: request.requestId,
    toolId: request.toolId,
  })
  const body =
    request.toolId === 'jira_add_attachment'
      ? { success: false, error: message }
      : { error: message, success: false }
  return Response.json(body, { status: isPayloadSizeLimitError(error) ? 413 : 500 })
}

export const executeJiraTool: InternalToolOperationHandler = async (request) => {
  request.signal?.throwIfAborted()
  if (!request.context.userId) return unauthorizedResponse(request.toolId)

  let serializedInput: string
  try {
    serializedInput = JSON.stringify(request.input) ?? ''
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

  try {
    const result = await dispatch(request, {
      userId: request.context.userId,
      requestId: request.requestId,
      signal: request.signal,
    })
    request.signal?.throwIfAborted()
    return result instanceof Response ? result : Response.json(result)
  } catch (error) {
    request.signal?.throwIfAborted()
    if (error instanceof JiraOperationError) {
      return Response.json(error.body, { status: error.status })
    }
    return unexpectedErrorResponse(request, error)
  }
}
