import type {
  Artifact,
  Message,
  Task,
  TaskArtifactUpdateEvent,
  TaskState,
  TaskStatusUpdateEvent,
} from '@a2a-js/sdk'
import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { createA2AClient, extractTextContent, isTerminalState } from '@/lib/a2a/utils'
import { a2aResubscribeContract } from '@/lib/api/contracts/tools/a2a'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { enforceUserOrIpRateLimit } from '@/lib/core/rate-limiter'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('A2AResubscribeAPI')

export const dynamic = 'force-dynamic'

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })

    if (!authResult.success) {
      logger.warn(`[${requestId}] Unauthorized A2A resubscribe attempt`)
      return NextResponse.json(
        {
          success: false,
          error: authResult.error || 'Authentication required',
        },
        { status: 401 }
      )
    }

    const rateLimited = await enforceUserOrIpRateLimit(
      'a2a-resubscribe',
      authResult.userId,
      request
    )
    if (rateLimited) return rateLimited

    const parsed = await parseRequest(
      a2aResubscribeContract,
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

    const client = await createA2AClient(validatedData.agentUrl, validatedData.apiKey)

    const stream = client.resubscribeTask({ id: validatedData.taskId })

    let taskId = validatedData.taskId
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

    logger.info(`[${requestId}] Successfully resubscribed to A2A task ${taskId}`)

    return NextResponse.json({
      success: true,
      output: {
        taskId,
        contextId,
        state,
        isRunning: !isTerminalState(state),
        artifacts,
        history,
      },
    })
  } catch (error) {
    logger.error(`[${requestId}] Error resubscribing to A2A task:`, error)
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to resubscribe',
      },
      { status: 500 }
    )
  }
})
