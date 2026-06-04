import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { createA2AClient } from '@/lib/a2a/utils'
import { a2aGetPushNotificationContract } from '@/lib/api/contracts/tools/a2a'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { enforceUserOrIpRateLimit } from '@/lib/core/rate-limiter'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

export const dynamic = 'force-dynamic'

const logger = createLogger('A2AGetPushNotificationAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })

    if (!authResult.success) {
      logger.warn(
        `[${requestId}] Unauthorized A2A get push notification attempt: ${authResult.error}`
      )
      return NextResponse.json(
        {
          success: false,
          error: authResult.error || 'Authentication required',
        },
        { status: 401 }
      )
    }

    const rateLimited = await enforceUserOrIpRateLimit(
      'a2a-get-push-notification',
      authResult.userId,
      request
    )
    if (rateLimited) return rateLimited

    logger.info(
      `[${requestId}] Authenticated A2A get push notification request via ${authResult.authType}`,
      {
        userId: authResult.userId,
      }
    )

    const parsed = await parseRequest(
      a2aGetPushNotificationContract,
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

    logger.info(`[${requestId}] Getting push notification config`, {
      agentUrl: validatedData.agentUrl,
      taskId: validatedData.taskId,
    })

    const client = await createA2AClient(validatedData.agentUrl, validatedData.apiKey)

    const result = await client.getTaskPushNotificationConfig({
      id: validatedData.taskId,
    })

    if (!result || !result.pushNotificationConfig) {
      logger.info(`[${requestId}] No push notification config found for task`, {
        taskId: validatedData.taskId,
      })
      return NextResponse.json({
        success: true,
        output: {
          exists: false,
        },
      })
    }

    logger.info(`[${requestId}] Push notification config retrieved successfully`, {
      taskId: validatedData.taskId,
    })

    return NextResponse.json({
      success: true,
      output: {
        url: result.pushNotificationConfig.url,
        token: result.pushNotificationConfig.token,
        exists: true,
      },
    })
  } catch (error) {
    if (error instanceof Error && error.message.includes('not found')) {
      logger.info(`[${requestId}] Task not found, returning exists: false`)
      return NextResponse.json({
        success: true,
        output: {
          exists: false,
        },
      })
    }

    logger.error(`[${requestId}] Error getting A2A push notification:`, error)

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to get push notification',
      },
      { status: 500 }
    )
  }
})
