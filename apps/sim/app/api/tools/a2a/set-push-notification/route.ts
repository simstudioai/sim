import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { createA2AClient } from '@/lib/a2a/utils'
import { a2aSetPushNotificationContract } from '@/lib/api/contracts/tools/a2a'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { enforceUserOrIpRateLimit } from '@/lib/core/rate-limiter'
import { validateUrlWithDNS } from '@/lib/core/security/input-validation.server'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

export const dynamic = 'force-dynamic'

const logger = createLogger('A2ASetPushNotificationAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })

    if (!authResult.success) {
      logger.warn(`[${requestId}] Unauthorized A2A set push notification attempt`, {
        error: authResult.error || 'Authentication required',
      })
      return NextResponse.json(
        {
          success: false,
          error: authResult.error || 'Authentication required',
        },
        { status: 401 }
      )
    }

    const rateLimited = await enforceUserOrIpRateLimit(
      'a2a-set-push-notification',
      authResult.userId,
      request
    )
    if (rateLimited) return rateLimited

    const parsed = await parseRequest(
      a2aSetPushNotificationContract,
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

    const urlValidation = await validateUrlWithDNS(validatedData.webhookUrl, 'Webhook URL')
    if (!urlValidation.isValid) {
      logger.warn(`[${requestId}] Invalid webhook URL`, { error: urlValidation.error })
      return NextResponse.json(
        {
          success: false,
          error: urlValidation.error,
        },
        { status: 400 }
      )
    }

    logger.info(`[${requestId}] A2A set push notification request`, {
      agentUrl: validatedData.agentUrl,
      taskId: validatedData.taskId,
      webhookUrl: validatedData.webhookUrl,
    })

    const client = await createA2AClient(validatedData.agentUrl, validatedData.apiKey)

    const result = await client.setTaskPushNotificationConfig({
      taskId: validatedData.taskId,
      pushNotificationConfig: {
        url: validatedData.webhookUrl,
        token: validatedData.token,
      },
    })

    logger.info(`[${requestId}] A2A set push notification successful`, {
      taskId: validatedData.taskId,
    })

    return NextResponse.json({
      success: true,
      output: {
        url: result.pushNotificationConfig.url,
        token: result.pushNotificationConfig.token,
        success: true,
      },
    })
  } catch (error) {
    logger.error(`[${requestId}] Error setting A2A push notification:`, error)

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to set push notification',
      },
      { status: 500 }
    )
  }
})
