import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { createA2AClient } from '@/lib/a2a/utils'
import { a2aDeletePushNotificationContract } from '@/lib/api/contracts/tools/internal/a2a'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

export const dynamic = 'force-dynamic'

const logger = createLogger('A2ADeletePushNotificationAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })

    if (!authResult.success) {
      logger.warn(
        `[${requestId}] Unauthorized A2A delete push notification attempt: ${authResult.error}`
      )
      return NextResponse.json(
        {
          success: false,
          error: authResult.error || 'Authentication required',
        },
        { status: 401 }
      )
    }

    logger.info(
      `[${requestId}] Authenticated A2A delete push notification request via ${authResult.authType}`,
      {
        userId: authResult.userId,
      }
    )

    const parsed = await parseRequest(
      a2aDeletePushNotificationContract,
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

    logger.info(`[${requestId}] Deleting A2A push notification config`, {
      agentUrl: validatedData.agentUrl,
      taskId: validatedData.taskId,
      pushNotificationConfigId: validatedData.pushNotificationConfigId,
    })

    const client = await createA2AClient(validatedData.agentUrl, validatedData.apiKey)

    await client.deleteTaskPushNotificationConfig({
      id: validatedData.taskId,
      pushNotificationConfigId: validatedData.pushNotificationConfigId || validatedData.taskId,
    })

    logger.info(`[${requestId}] Push notification config deleted successfully`, {
      taskId: validatedData.taskId,
    })

    return NextResponse.json({
      success: true,
      output: {
        success: true,
      },
    })
  } catch (error) {
    logger.error(`[${requestId}] Error deleting A2A push notification:`, error)

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to delete push notification',
      },
      { status: 500 }
    )
  }
})
