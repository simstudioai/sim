import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createA2AClient } from '@/lib/a2a/utils'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'

export const dynamic = 'force-dynamic'

const logger = createLogger('A2AGetPushNotificationAPI')

const A2AGetPushNotificationSchema = z.object({
  agentUrl: z.string().min(1, 'Agent URL is required'),
  taskId: z.string().min(1, 'Task ID is required'),
  apiKey: z.string().optional(),
})

export async function POST(request: NextRequest) {
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

    logger.info(
      `[${requestId}] Authenticated A2A get push notification request via ${authResult.authType}`,
      {
        userId: authResult.userId,
      }
    )

    const body = await request.json()
    const validatedData = A2AGetPushNotificationSchema.parse(body)

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
        error: error instanceof Error ? error.message : 'Failed to get push notification',
      },
      { status: 500 }
    )
  }
}
