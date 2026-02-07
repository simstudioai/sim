import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createA2AClient } from '@/lib/a2a/utils'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'

export const dynamic = 'force-dynamic'

const logger = createLogger('A2ADeletePushNotificationAPI')

const A2ADeletePushNotificationSchema = z.object({
  agentUrl: z.string().min(1, 'Agent URL is required'),
  taskId: z.string().min(1, 'Task ID is required'),
  pushNotificationConfigId: z.string().optional(),
  apiKey: z.string().optional(),
})

export async function POST(request: NextRequest) {
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

    const body = await request.json()
    const validatedData = A2ADeletePushNotificationSchema.parse(body)

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

    logger.error(`[${requestId}] Error deleting A2A push notification:`, error)

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete push notification',
      },
      { status: 500 }
    )
  }
}
