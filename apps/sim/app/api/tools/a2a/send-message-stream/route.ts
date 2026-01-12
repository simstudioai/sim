import type {
  Artifact,
  Message,
  Task,
  TaskArtifactUpdateEvent,
  TaskState,
  TaskStatusUpdateEvent,
} from '@a2a-js/sdk'
import { ClientFactory } from '@a2a-js/sdk/client'
import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { extractTextContent, isTerminalState } from '@/lib/a2a/utils'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'

export const dynamic = 'force-dynamic'

const logger = createLogger('A2ASendMessageStreamAPI')

const A2ASendMessageStreamSchema = z.object({
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
      logger.warn(
        `[${requestId}] Unauthorized A2A send message stream attempt: ${authResult.error}`
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
      `[${requestId}] Authenticated A2A send message stream request via ${authResult.authType}`,
      {
        userId: authResult.userId,
      }
    )

    const body = await request.json()
    const validatedData = A2ASendMessageStreamSchema.parse(body)

    logger.info(`[${requestId}] Sending A2A streaming message`, {
      agentUrl: validatedData.agentUrl,
      hasTaskId: !!validatedData.taskId,
      hasContextId: !!validatedData.contextId,
    })

    const factory = new ClientFactory()
    const client = await factory.createFromUrl(validatedData.agentUrl)

    const message: Message = {
      kind: 'message',
      messageId: crypto.randomUUID(),
      role: 'user',
      parts: [{ kind: 'text', text: validatedData.message }],
      ...(validatedData.taskId && { taskId: validatedData.taskId }),
      ...(validatedData.contextId && { contextId: validatedData.contextId }),
    }

    const stream = client.sendMessageStream({ message })

    let taskId = ''
    let contextId: string | undefined
    let state: TaskState = 'working'
    let content = ''
    let artifacts: Artifact[] = []
    let history: Message[] = []

    for await (const event of stream) {
      if (event.kind === 'message') {
        const msg = event as Message
        content = extractTextContent(msg)
        taskId = msg.taskId || taskId
        contextId = msg.contextId || contextId
        state = 'completed'
      } else if (event.kind === 'task') {
        const task = event as Task
        taskId = task.id
        contextId = task.contextId
        state = task.status.state
        artifacts = task.artifacts || []
        history = task.history || []
        const lastAgentMessage = history.filter((m) => m.role === 'agent').pop()
        if (lastAgentMessage) {
          content = extractTextContent(lastAgentMessage)
        }
      } else if ('status' in event) {
        const statusEvent = event as TaskStatusUpdateEvent
        state = statusEvent.status.state
      } else if ('artifact' in event) {
        const artifactEvent = event as TaskArtifactUpdateEvent
        artifacts.push(artifactEvent.artifact)
      }
    }

    logger.info(`[${requestId}] A2A streaming message completed`, {
      taskId,
      state,
      artifactCount: artifacts.length,
    })

    return NextResponse.json({
      success: isTerminalState(state) && state !== 'failed',
      output: {
        content,
        taskId,
        contextId,
        state,
        artifacts,
        history,
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

    logger.error(`[${requestId}] Error in A2A streaming:`, error)

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Streaming failed',
      },
      { status: 500 }
    )
  }
}
