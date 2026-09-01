import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { getValidationErrorMessage } from '@/lib/api/server'
import { enforceUserRateLimit } from '@/lib/core/rate-limiter'
import { A2AOperationError } from '@/lib/internal/a2a/errors'
import {
  a2aCancelTaskInputSchema,
  a2aGetAgentCardInputSchema,
  a2aGetTaskInputSchema,
  a2aSendMessageInputSchema,
} from '@/lib/internal/a2a/input'
import {
  cancelA2ATask,
  getA2AAgentCard,
  getA2ATask,
  sendA2AMessage,
} from '@/lib/internal/a2a/operations'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'
import { docNotReadyResponse } from '@/lib/uploads/utils/servable-file-response'

const logger = createLogger('A2AToolExecution')

const RATE_LIMIT_BUCKETS = {
  a2a_cancel_task: 'a2a-cancel-task',
  a2a_get_agent_card: 'a2a-get-agent-card',
  a2a_get_task: 'a2a-get-task',
  a2a_send_message: 'a2a-send-message',
} as const

export const executeA2ATool: InternalToolOperationHandler = async (request) => {
  request.signal?.throwIfAborted()
  const userId = request.context.userId
  if (!userId) {
    return Response.json({ success: false, error: 'Authentication required' }, { status: 401 })
  }
  if (!Object.hasOwn(RATE_LIMIT_BUCKETS, request.toolId)) {
    return Response.json(
      { success: false, error: `Unsupported A2A tool: ${request.toolId}` },
      { status: 500 }
    )
  }
  const bucket = RATE_LIMIT_BUCKETS[request.toolId as keyof typeof RATE_LIMIT_BUCKETS]
  const rateLimited = await enforceUserRateLimit(bucket, userId)
  request.signal?.throwIfAborted()
  if (rateLimited) return rateLimited

  const context = {
    headers: request.headers,
    requestId: request.requestId,
    signal: request.signal,
    userId,
  }

  try {
    switch (request.toolId) {
      case 'a2a_cancel_task': {
        const parsed = a2aCancelTaskInputSchema.safeParse(request.input)
        if (!parsed.success) {
          return Response.json(
            {
              success: false,
              error: getValidationErrorMessage(parsed.error, 'Invalid request data'),
            },
            { status: 400 }
          )
        }
        return Response.json(await cancelA2ATask(parsed.data, context))
      }
      case 'a2a_get_agent_card': {
        const parsed = a2aGetAgentCardInputSchema.safeParse(request.input)
        if (!parsed.success) {
          return Response.json(
            {
              success: false,
              error: getValidationErrorMessage(parsed.error, 'Invalid request data'),
            },
            { status: 400 }
          )
        }
        return Response.json(await getA2AAgentCard(parsed.data, context))
      }
      case 'a2a_get_task': {
        const parsed = a2aGetTaskInputSchema.safeParse(request.input)
        if (!parsed.success) {
          return Response.json(
            {
              success: false,
              error: getValidationErrorMessage(parsed.error, 'Invalid request data'),
            },
            { status: 400 }
          )
        }
        return Response.json(await getA2ATask(parsed.data, context))
      }
      case 'a2a_send_message': {
        const parsed = a2aSendMessageInputSchema.safeParse(request.input)
        if (!parsed.success) {
          return Response.json(
            {
              success: false,
              error: getValidationErrorMessage(parsed.error, 'Invalid request data'),
            },
            { status: 400 }
          )
        }
        return Response.json(await sendA2AMessage(parsed.data, context))
      }
    }
    return Response.json(
      { success: false, error: `Unsupported A2A tool: ${request.toolId}` },
      { status: 500 }
    )
  } catch (error) {
    request.signal?.throwIfAborted()
    if (error instanceof A2AOperationError) {
      return Response.json({ success: false, error: error.message }, { status: error.status })
    }
    const notReady = docNotReadyResponse(error)
    if (notReady) return notReady
    logger.error(`[${request.requestId}] A2A operation failed`, {
      error: getErrorMessage(error),
      toolId: request.toolId,
    })
    return Response.json({ success: false, error: getErrorMessage(error) }, { status: 502 })
  }
}
