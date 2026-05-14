import type { Task } from '@a2a-js/sdk'
import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { createA2AClient } from '@/lib/a2a/utils'
import { a2aGetTaskContract } from '@/lib/api/contracts/tools/a2a'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { enforceUserOrIpRateLimit } from '@/lib/core/rate-limiter'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

export const dynamic = 'force-dynamic'

const logger = createLogger('A2AGetTaskAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })

    if (!authResult.success) {
      logger.warn(`[${requestId}] Unauthorized A2A get task attempt: ${authResult.error}`)
      return NextResponse.json(
        {
          success: false,
          error: authResult.error || 'Authentication required',
        },
        { status: 401 }
      )
    }

    const rateLimited = await enforceUserOrIpRateLimit('a2a-get-task', authResult.userId, request)
    if (rateLimited) return rateLimited

    logger.info(`[${requestId}] Authenticated A2A get task request via ${authResult.authType}`, {
      userId: authResult.userId,
    })

    const parsed = await parseRequest(
      a2aGetTaskContract,
      request,
      {},
      {
        validationErrorResponse: (error) =>
          NextResponse.json(
            {
              success: false,
              error: getValidationErrorMessage(error, 'Invalid request data'),
              details: error.issues,
            },
            { status: 400 }
          ),
      }
    )
    if (!parsed.success) return parsed.response
    const validatedData = parsed.data.body

    logger.info(`[${requestId}] Getting A2A task`, {
      agentUrl: validatedData.agentUrl,
      taskId: validatedData.taskId,
      historyLength: validatedData.historyLength,
    })

    const client = await createA2AClient(validatedData.agentUrl, validatedData.apiKey)

    const task = (await client.getTask({
      id: validatedData.taskId,
      historyLength: validatedData.historyLength,
    })) as Task

    logger.info(`[${requestId}] Successfully retrieved A2A task`, {
      taskId: task.id,
      state: task.status.state,
    })

    return NextResponse.json({
      success: true,
      output: {
        taskId: task.id,
        contextId: task.contextId,
        state: task.status.state,
        artifacts: task.artifacts,
        history: task.history,
      },
    })
  } catch (error) {
    logger.error(`[${requestId}] Error getting A2A task:`, error)

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to get task',
      },
      { status: 500 }
    )
  }
})
