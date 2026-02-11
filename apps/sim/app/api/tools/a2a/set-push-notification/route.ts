import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createA2AClient } from '@/lib/a2a/utils'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { validateUrlWithDNS } from '@/lib/core/security/input-validation.server'
import { generateRequestId } from '@/lib/core/utils/request'

export const dynamic = 'force-dynamic'

const logger = createLogger('A2ASetPushNotificationAPI')

const A2ASetPushNotificationSchema = z.object({
  agentUrl: z.string().min(1, 'Agent URL is required'),
  taskId: z.string().min(1, 'Task ID is required'),
  webhookUrl: z.string().min(1, 'Webhook URL is required'),
  token: z.string().optional(),
  apiKey: z.string().optional(),
})

export async function POST(request: NextRequest) {
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

    const body = await request.json()
    const validatedData = A2ASetPushNotificationSchema.parse(body)

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
    if (error instanceof z.ZodError) {
      logger.warn(`[${requestId}] Invalid request data`, { errors: error.errors })
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid request data',
          details: error.errors,
        },
        { status: 400 }
      )
    }

    logger.error(`[${requestId}] Error setting A2A push notification:`, error)

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to set push notification',
      },
      { status: 500 }
    )
  }
}
