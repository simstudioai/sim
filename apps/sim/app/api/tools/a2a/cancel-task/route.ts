import type { Task } from '@a2a-js/sdk'
import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { createA2AClient } from '@/lib/a2a/utils'
import { a2aCancelTaskContract } from '@/lib/api/contracts/tools/internal/a2a'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('A2ACancelTaskAPI')

export const dynamic = 'force-dynamic'

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })

    if (!authResult.success) {
      logger.warn(`[${requestId}] Unauthorized A2A cancel task attempt`)
      return NextResponse.json(
        {
          success: false,
          error: authResult.error || 'Authentication required',
        },
        { status: 401 }
      )
    }

    const parsed = await parseRequest(
      a2aCancelTaskContract,
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

    logger.info(`[${requestId}] Canceling A2A task`, {
      agentUrl: validatedData.agentUrl,
      taskId: validatedData.taskId,
    })

    const client = await createA2AClient(validatedData.agentUrl, validatedData.apiKey)

    const task = (await client.cancelTask({ id: validatedData.taskId })) as Task

    logger.info(`[${requestId}] Successfully canceled A2A task`, {
      taskId: validatedData.taskId,
      state: task.status.state,
    })

    return NextResponse.json({
      success: true,
      output: {
        cancelled: true,
        state: task.status.state,
      },
    })
  } catch (error) {
    logger.error(`[${requestId}] Error canceling A2A task:`, error)
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to cancel task',
      },
      { status: 500 }
    )
  }
})
