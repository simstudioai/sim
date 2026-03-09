import type { Task } from '@a2a-js/sdk'
import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createA2AClient } from '@/lib/a2a/utils'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'

export const dynamic = 'force-dynamic'

const logger = createLogger('A2AGetTaskAPI')

const A2AGetTaskSchema = z.object({
  agentUrl: z.string().min(1, 'Agent URL is required'),
  taskId: z.string().min(1, 'Task ID is required'),
  apiKey: z.string().optional(),
  historyLength: z.number().optional(),
})

export async function POST(request: NextRequest) {
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

    logger.info(`[${requestId}] Authenticated A2A get task request via ${authResult.authType}`, {
      userId: authResult.userId,
    })

    const body = await request.json()
    const validatedData = A2AGetTaskSchema.parse(body)

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

    logger.error(`[${requestId}] Error getting A2A task:`, error)

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get task',
      },
      { status: 500 }
    )
  }
}
