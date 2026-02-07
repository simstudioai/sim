import type { Task } from '@a2a-js/sdk'
import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createA2AClient } from '@/lib/a2a/utils'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'

const logger = createLogger('A2ACancelTaskAPI')

export const dynamic = 'force-dynamic'

const A2ACancelTaskSchema = z.object({
  agentUrl: z.string().min(1, 'Agent URL is required'),
  taskId: z.string().min(1, 'Task ID is required'),
  apiKey: z.string().optional(),
})

export async function POST(request: NextRequest) {
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

    const body = await request.json()
    const validatedData = A2ACancelTaskSchema.parse(body)

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
    if (error instanceof z.ZodError) {
      logger.warn(`[${requestId}] Invalid A2A cancel task request`, {
        errors: error.errors,
      })
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid request data',
          details: error.errors,
        },
        { status: 400 }
      )
    }

    logger.error(`[${requestId}] Error canceling A2A task:`, error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to cancel task',
      },
      { status: 500 }
    )
  }
}
