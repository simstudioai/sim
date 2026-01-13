import type { Message, Task } from '@a2a-js/sdk'
import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createA2AClient, extractTextContent, isTerminalState } from '@/lib/a2a/utils'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'

export const dynamic = 'force-dynamic'

const logger = createLogger('A2ASendMessageAPI')

const A2ASendMessageSchema = z.object({
  agentUrl: z.string().min(1, 'Agent URL is required'),
  message: z.string().min(1, 'Message is required'),
  taskId: z.string().optional(),
  contextId: z.string().optional(),
  apiKey: z.string().optional(),
})

export async function POST(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const authResult = await checkHybridAuth(request, { requireWorkflowId: false })

    if (!authResult.success) {
      logger.warn(`[${requestId}] Unauthorized A2A send message attempt: ${authResult.error}`)
      return NextResponse.json(
        {
          success: false,
          error: authResult.error || 'Authentication required',
        },
        { status: 401 }
      )
    }

    logger.info(
      `[${requestId}] Authenticated A2A send message request via ${authResult.authType}`,
      {
        userId: authResult.userId,
      }
    )

    const body = await request.json()
    const validatedData = A2ASendMessageSchema.parse(body)

    logger.info(`[${requestId}] Sending A2A message`, {
      agentUrl: validatedData.agentUrl,
      hasTaskId: !!validatedData.taskId,
      hasContextId: !!validatedData.contextId,
    })

    const client = await createA2AClient(validatedData.agentUrl, validatedData.apiKey)

    const message: Message = {
      kind: 'message',
      messageId: crypto.randomUUID(),
      role: 'user',
      parts: [{ kind: 'text', text: validatedData.message }],
      ...(validatedData.taskId && { taskId: validatedData.taskId }),
      ...(validatedData.contextId && { contextId: validatedData.contextId }),
    }

    const result = await client.sendMessage({ message })

    if (result.kind === 'message') {
      const responseMessage = result as Message

      logger.info(`[${requestId}] A2A message sent successfully (message response)`)

      return NextResponse.json({
        success: true,
        output: {
          content: extractTextContent(responseMessage),
          taskId: responseMessage.taskId || '',
          contextId: responseMessage.contextId,
          state: 'completed',
        },
      })
    }

    const task = result as Task
    const lastAgentMessage = task.history?.filter((m) => m.role === 'agent').pop()
    const content = lastAgentMessage ? extractTextContent(lastAgentMessage) : ''

    logger.info(`[${requestId}] A2A message sent successfully (task response)`, {
      taskId: task.id,
      state: task.status.state,
    })

    return NextResponse.json({
      success: isTerminalState(task.status.state) && task.status.state !== 'failed',
      output: {
        content,
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

    logger.error(`[${requestId}] Error sending A2A message:`, error)

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 }
    )
  }
}
