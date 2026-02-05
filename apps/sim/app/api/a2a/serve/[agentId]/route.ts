import type { Artifact, Message, PushNotificationConfig, TaskState } from '@a2a-js/sdk'
import { db } from '@sim/db'
import { a2aAgent, a2aPushNotificationConfig, a2aTask, workflow } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { A2A_DEFAULT_TIMEOUT, A2A_MAX_HISTORY_LENGTH } from '@/lib/a2a/constants'
import { notifyTaskStateChange } from '@/lib/a2a/push-notifications'
import {
  createAgentMessage,
  extractWorkflowInput,
  isTerminalState,
  parseWorkflowSSEChunk,
} from '@/lib/a2a/utils'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { acquireLock, getRedisClient, releaseLock } from '@/lib/core/config/redis'
import { validateUrlWithDNS } from '@/lib/core/security/input-validation.server'
import { SSE_HEADERS } from '@/lib/core/utils/sse'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { markExecutionCancelled } from '@/lib/execution/cancellation'
import {
  A2A_ERROR_CODES,
  A2A_METHODS,
  buildExecuteRequest,
  buildTaskResponse,
  createError,
  createResponse,
  extractAgentContent,
  formatTaskResponse,
  generateTaskId,
  isJSONRPCRequest,
  type MessageSendParams,
  type PushNotificationSetParams,
  type TaskIdParams,
} from '@/app/api/a2a/serve/[agentId]/utils'
import { getBrandConfig } from '@/ee/whitelabeling'

const logger = createLogger('A2AServeAPI')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface RouteParams {
  agentId: string
}

/**
 * GET - Returns the Agent Card (discovery document)
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<RouteParams> }) {
  const { agentId } = await params

  const redis = getRedisClient()
  const cacheKey = `a2a:agent:${agentId}:card`

  if (redis) {
    try {
      const cached = await redis.get(cacheKey)
      if (cached) {
        return NextResponse.json(JSON.parse(cached), {
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'private, max-age=60',
            'X-Cache': 'HIT',
          },
        })
      }
    } catch (err) {
      logger.warn('Redis cache read failed', { agentId, error: err })
    }
  }

  try {
    const [agent] = await db
      .select({
        id: a2aAgent.id,
        name: a2aAgent.name,
        description: a2aAgent.description,
        version: a2aAgent.version,
        capabilities: a2aAgent.capabilities,
        skills: a2aAgent.skills,
        authentication: a2aAgent.authentication,
        isPublished: a2aAgent.isPublished,
      })
      .from(a2aAgent)
      .where(eq(a2aAgent.id, agentId))
      .limit(1)

    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    if (!agent.isPublished) {
      return NextResponse.json({ error: 'Agent not published' }, { status: 404 })
    }

    const baseUrl = getBaseUrl()
    const brandConfig = getBrandConfig()

    const authConfig = agent.authentication as { schemes?: string[] } | undefined
    const schemes = authConfig?.schemes || []
    const isPublic = schemes.includes('none')

    const agentCard = {
      protocolVersion: '0.3.0',
      name: agent.name,
      description: agent.description || '',
      url: `${baseUrl}/api/a2a/serve/${agent.id}`,
      version: agent.version,
      preferredTransport: 'JSONRPC',
      documentationUrl: `${baseUrl}/docs/a2a`,
      provider: {
        organization: brandConfig.name,
        url: baseUrl,
      },
      capabilities: agent.capabilities,
      skills: agent.skills || [],
      ...(isPublic
        ? {}
        : {
            securitySchemes: {
              apiKey: {
                type: 'apiKey' as const,
                name: 'X-API-Key',
                in: 'header' as const,
                description: 'API key authentication',
              },
            },
            security: [{ apiKey: [] }],
          }),
      defaultInputModes: ['text/plain', 'application/json'],
      defaultOutputModes: ['text/plain', 'application/json'],
    }

    if (redis) {
      try {
        await redis.set(cacheKey, JSON.stringify(agentCard), 'EX', 60)
      } catch (err) {
        logger.warn('Redis cache write failed', { agentId, error: err })
      }
    }

    return NextResponse.json(agentCard, {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'private, max-age=60',
        'X-Cache': 'MISS',
      },
    })
  } catch (error) {
    logger.error('Error getting Agent Card:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * POST - Handle JSON-RPC requests
 */
export async function POST(request: NextRequest, { params }: { params: Promise<RouteParams> }) {
  const { agentId } = await params

  try {
    const [agent] = await db
      .select({
        id: a2aAgent.id,
        name: a2aAgent.name,
        workflowId: a2aAgent.workflowId,
        workspaceId: a2aAgent.workspaceId,
        isPublished: a2aAgent.isPublished,
        capabilities: a2aAgent.capabilities,
        authentication: a2aAgent.authentication,
      })
      .from(a2aAgent)
      .where(eq(a2aAgent.id, agentId))
      .limit(1)

    if (!agent) {
      return NextResponse.json(
        createError(null, A2A_ERROR_CODES.AGENT_UNAVAILABLE, 'Agent not found'),
        { status: 404 }
      )
    }

    if (!agent.isPublished) {
      return NextResponse.json(
        createError(null, A2A_ERROR_CODES.AGENT_UNAVAILABLE, 'Agent not published'),
        { status: 404 }
      )
    }

    const authSchemes = (agent.authentication as { schemes?: string[] })?.schemes || []
    const requiresAuth = !authSchemes.includes('none')

    if (requiresAuth) {
      const auth = await checkHybridAuth(request, { requireWorkflowId: false })
      if (!auth.success || !auth.userId) {
        return NextResponse.json(
          createError(null, A2A_ERROR_CODES.AUTHENTICATION_REQUIRED, 'Unauthorized'),
          { status: 401 }
        )
      }
    }

    const [wf] = await db
      .select({ isDeployed: workflow.isDeployed })
      .from(workflow)
      .where(eq(workflow.id, agent.workflowId))
      .limit(1)

    if (!wf?.isDeployed) {
      return NextResponse.json(
        createError(null, A2A_ERROR_CODES.AGENT_UNAVAILABLE, 'Workflow is not deployed'),
        { status: 400 }
      )
    }

    const body = await request.json()

    if (!isJSONRPCRequest(body)) {
      return NextResponse.json(
        createError(null, A2A_ERROR_CODES.INVALID_REQUEST, 'Invalid JSON-RPC request'),
        { status: 400 }
      )
    }

    const { id, method, params: rpcParams } = body
    const apiKey = request.headers.get('X-API-Key')

    logger.info(`A2A request: ${method} for agent ${agentId}`)

    switch (method) {
      case A2A_METHODS.MESSAGE_SEND:
        return handleMessageSend(id, agent, rpcParams as MessageSendParams, apiKey)

      case A2A_METHODS.MESSAGE_STREAM:
        return handleMessageStream(request, id, agent, rpcParams as MessageSendParams, apiKey)

      case A2A_METHODS.TASKS_GET:
        return handleTaskGet(id, rpcParams as TaskIdParams)

      case A2A_METHODS.TASKS_CANCEL:
        return handleTaskCancel(id, rpcParams as TaskIdParams)

      case A2A_METHODS.TASKS_RESUBSCRIBE:
        return handleTaskResubscribe(request, id, rpcParams as TaskIdParams)

      case A2A_METHODS.PUSH_NOTIFICATION_SET:
        return handlePushNotificationSet(id, rpcParams as PushNotificationSetParams)

      case A2A_METHODS.PUSH_NOTIFICATION_GET:
        return handlePushNotificationGet(id, rpcParams as TaskIdParams)

      case A2A_METHODS.PUSH_NOTIFICATION_DELETE:
        return handlePushNotificationDelete(id, rpcParams as TaskIdParams)

      default:
        return NextResponse.json(
          createError(id, A2A_ERROR_CODES.METHOD_NOT_FOUND, `Method not found: ${method}`),
          { status: 404 }
        )
    }
  } catch (error) {
    logger.error('Error handling A2A request:', error)
    return NextResponse.json(createError(null, A2A_ERROR_CODES.INTERNAL_ERROR, 'Internal error'), {
      status: 500,
    })
  }
}

/**
 * Handle message/send - Send a message (v0.3)
 */
async function handleMessageSend(
  id: string | number,
  agent: {
    id: string
    name: string
    workflowId: string
    workspaceId: string
  },
  params: MessageSendParams,
  apiKey?: string | null
): Promise<NextResponse> {
  if (!params?.message) {
    return NextResponse.json(
      createError(id, A2A_ERROR_CODES.INVALID_PARAMS, 'Message is required'),
      { status: 400 }
    )
  }

  const message = params.message
  const taskId = message.taskId || generateTaskId()
  const contextId = message.contextId || uuidv4()

  // Distributed lock to prevent concurrent task processing
  const lockKey = `a2a:task:${taskId}:lock`
  const lockValue = uuidv4()
  const acquired = await acquireLock(lockKey, lockValue, 60)

  if (!acquired) {
    return NextResponse.json(
      createError(id, A2A_ERROR_CODES.INTERNAL_ERROR, 'Task is currently being processed'),
      { status: 409 }
    )
  }

  try {
    let existingTask: typeof a2aTask.$inferSelect | null = null
    if (message.taskId) {
      const [found] = await db.select().from(a2aTask).where(eq(a2aTask.id, message.taskId)).limit(1)
      existingTask = found || null

      if (!existingTask) {
        return NextResponse.json(
          createError(id, A2A_ERROR_CODES.TASK_NOT_FOUND, 'Task not found'),
          { status: 404 }
        )
      }

      if (isTerminalState(existingTask.status as TaskState)) {
        return NextResponse.json(
          createError(id, A2A_ERROR_CODES.TASK_ALREADY_COMPLETE, 'Task already in terminal state'),
          { status: 400 }
        )
      }
    }

    const history: Message[] = existingTask?.messages ? (existingTask.messages as Message[]) : []

    history.push(message)

    if (history.length > A2A_MAX_HISTORY_LENGTH) {
      history.splice(0, history.length - A2A_MAX_HISTORY_LENGTH)
    }

    if (existingTask) {
      await db
        .update(a2aTask)
        .set({
          status: 'working',
          messages: history,
          updatedAt: new Date(),
        })
        .where(eq(a2aTask.id, taskId))
    } else {
      await db.insert(a2aTask).values({
        id: taskId,
        agentId: agent.id,
        sessionId: contextId || null,
        status: 'working',
        messages: history,
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      })
    }

    const {
      url: executeUrl,
      headers,
      useInternalAuth,
    } = await buildExecuteRequest({
      workflowId: agent.workflowId,
      apiKey,
    })

    logger.info(`Executing workflow ${agent.workflowId} for A2A task ${taskId}`)

    try {
      const workflowInput = extractWorkflowInput(message)
      if (!workflowInput) {
        return NextResponse.json(
          createError(
            id,
            A2A_ERROR_CODES.INVALID_PARAMS,
            'Message must contain at least one part with content'
          ),
          { status: 400 }
        )
      }

      const response = await fetch(executeUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          ...workflowInput,
          triggerType: 'a2a',
          ...(useInternalAuth && { workflowId: agent.workflowId }),
        }),
        signal: AbortSignal.timeout(A2A_DEFAULT_TIMEOUT),
      })

      const executeResult = await response.json()

      const finalState: TaskState = response.ok ? 'completed' : 'failed'

      const agentContent = extractAgentContent(executeResult)
      const agentMessage = createAgentMessage(agentContent)
      agentMessage.taskId = taskId
      if (contextId) agentMessage.contextId = contextId
      history.push(agentMessage)

      const artifacts = executeResult.output?.artifacts || []

      await db
        .update(a2aTask)
        .set({
          status: finalState,
          messages: history,
          artifacts,
          executionId: executeResult.metadata?.executionId,
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(a2aTask.id, taskId))

      if (isTerminalState(finalState)) {
        notifyTaskStateChange(taskId, finalState).catch((err) => {
          logger.error('Failed to trigger push notification', { taskId, error: err })
        })
      }

      const task = buildTaskResponse({
        taskId,
        contextId,
        state: finalState,
        history,
        artifacts,
      })

      return NextResponse.json(createResponse(id, task))
    } catch (error) {
      const isTimeout = error instanceof Error && error.name === 'TimeoutError'
      logger.error(`Error executing workflow for task ${taskId}:`, { error, isTimeout })

      const errorMessage = isTimeout
        ? `Workflow execution timed out after ${A2A_DEFAULT_TIMEOUT}ms`
        : error instanceof Error
          ? error.message
          : 'Workflow execution failed'

      await db
        .update(a2aTask)
        .set({
          status: 'failed',
          updatedAt: new Date(),
          completedAt: new Date(),
        })
        .where(eq(a2aTask.id, taskId))

      notifyTaskStateChange(taskId, 'failed').catch((err) => {
        logger.error('Failed to trigger push notification for failure', { taskId, error: err })
      })

      return NextResponse.json(createError(id, A2A_ERROR_CODES.INTERNAL_ERROR, errorMessage), {
        status: 500,
      })
    }
  } finally {
    await releaseLock(lockKey, lockValue)
  }
}

/**
 * Handle message/stream - Stream a message response (v0.3)
 */
async function handleMessageStream(
  _request: NextRequest,
  id: string | number,
  agent: {
    id: string
    name: string
    workflowId: string
    workspaceId: string
  },
  params: MessageSendParams,
  apiKey?: string | null
): Promise<NextResponse> {
  if (!params?.message) {
    return NextResponse.json(
      createError(id, A2A_ERROR_CODES.INVALID_PARAMS, 'Message is required'),
      { status: 400 }
    )
  }

  const message = params.message
  const contextId = message.contextId || uuidv4()
  const taskId = message.taskId || generateTaskId()

  // Distributed lock to prevent concurrent task processing
  const lockKey = `a2a:task:${taskId}:lock`
  const lockValue = uuidv4()
  const acquired = await acquireLock(lockKey, lockValue, 300)

  if (!acquired) {
    const encoder = new TextEncoder()
    const errorStream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            `event: error\ndata: ${JSON.stringify({ code: A2A_ERROR_CODES.INTERNAL_ERROR, message: 'Task is currently being processed' })}\n\n`
          )
        )
        controller.close()
      },
    })
    return new NextResponse(errorStream, { headers: SSE_HEADERS })
  }

  let history: Message[] = []
  let existingTask: typeof a2aTask.$inferSelect | null = null

  if (message.taskId) {
    const [found] = await db.select().from(a2aTask).where(eq(a2aTask.id, message.taskId)).limit(1)
    existingTask = found || null

    if (!existingTask) {
      await releaseLock(lockKey, lockValue)
      return NextResponse.json(createError(id, A2A_ERROR_CODES.TASK_NOT_FOUND, 'Task not found'), {
        status: 404,
      })
    }

    if (isTerminalState(existingTask.status as TaskState)) {
      await releaseLock(lockKey, lockValue)
      return NextResponse.json(
        createError(id, A2A_ERROR_CODES.TASK_ALREADY_COMPLETE, 'Task already in terminal state'),
        { status: 400 }
      )
    }

    history = existingTask.messages as Message[]
  }

  history.push(message)

  if (history.length > A2A_MAX_HISTORY_LENGTH) {
    history.splice(0, history.length - A2A_MAX_HISTORY_LENGTH)
  }

  if (existingTask) {
    await db
      .update(a2aTask)
      .set({
        status: 'working',
        messages: history,
        updatedAt: new Date(),
      })
      .where(eq(a2aTask.id, taskId))
  } else {
    await db.insert(a2aTask).values({
      id: taskId,
      agentId: agent.id,
      sessionId: contextId || null,
      status: 'working',
      messages: history,
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    })
  }

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (event: string, data: unknown) => {
        try {
          const jsonRpcResponse = {
            jsonrpc: '2.0' as const,
            id,
            result: data,
          }
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(jsonRpcResponse)}\n\n`)
          )
        } catch (error) {
          logger.error('Error sending SSE event:', error)
        }
      }

      sendEvent('status', {
        kind: 'status',
        taskId,
        contextId,
        status: { state: 'working', timestamp: new Date().toISOString() },
      })

      try {
        const {
          url: executeUrl,
          headers,
          useInternalAuth,
        } = await buildExecuteRequest({
          workflowId: agent.workflowId,
          apiKey,
          stream: true,
        })

        const workflowInput = extractWorkflowInput(message)
        if (!workflowInput) {
          sendEvent('error', {
            code: A2A_ERROR_CODES.INVALID_PARAMS,
            message: 'Message must contain at least one part with content',
          })
          await releaseLock(lockKey, lockValue)
          controller.close()
          return
        }

        const response = await fetch(executeUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            ...workflowInput,
            triggerType: 'a2a',
            stream: true,
            ...(useInternalAuth && { workflowId: agent.workflowId }),
          }),
          signal: AbortSignal.timeout(A2A_DEFAULT_TIMEOUT),
        })

        if (!response.ok) {
          let errorMessage = 'Workflow execution failed'
          try {
            const errorResult = await response.json()
            errorMessage = errorResult.error || errorMessage
          } catch {
            // Response may not be JSON
          }
          throw new Error(errorMessage)
        }

        const contentType = response.headers.get('content-type') || ''
        const isStreamingResponse =
          contentType.includes('text/event-stream') || contentType.includes('text/plain')

        if (response.body && isStreamingResponse) {
          const reader = response.body.getReader()
          const decoder = new TextDecoder()
          let accumulatedContent = ''
          let finalContent: string | undefined

          while (true) {
            const { done, value } = await reader.read()
            if (done) break

            const rawChunk = decoder.decode(value, { stream: true })
            const parsed = parseWorkflowSSEChunk(rawChunk)

            if (parsed.content) {
              accumulatedContent += parsed.content
              sendEvent('message', {
                kind: 'message',
                taskId,
                contextId,
                role: 'agent',
                parts: [{ kind: 'text', text: parsed.content }],
                final: false,
              })
            }

            if (parsed.finalContent) {
              finalContent = parsed.finalContent
            }
          }

          const messageContent =
            (finalContent !== undefined && finalContent.length > 0
              ? finalContent
              : accumulatedContent) || 'Task completed'
          const agentMessage = createAgentMessage(messageContent)
          agentMessage.taskId = taskId
          if (contextId) agentMessage.contextId = contextId
          history.push(agentMessage)

          await db
            .update(a2aTask)
            .set({
              status: 'completed',
              messages: history,
              completedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(a2aTask.id, taskId))

          notifyTaskStateChange(taskId, 'completed').catch((err) => {
            logger.error('Failed to trigger push notification', { taskId, error: err })
          })

          sendEvent('task', {
            kind: 'task',
            id: taskId,
            contextId,
            status: { state: 'completed', timestamp: new Date().toISOString() },
            history,
            artifacts: [],
          })
        } else {
          const result = await response.json()

          const content = extractAgentContent(result)

          sendEvent('message', {
            kind: 'message',
            taskId,
            contextId,
            role: 'agent',
            parts: [{ kind: 'text', text: content }],
            final: true,
          })

          const agentMessage = createAgentMessage(content)
          agentMessage.taskId = taskId
          if (contextId) agentMessage.contextId = contextId
          history.push(agentMessage)

          const artifacts = (result.output?.artifacts as Artifact[]) || []

          await db
            .update(a2aTask)
            .set({
              status: 'completed',
              messages: history,
              artifacts,
              executionId: result.metadata?.executionId,
              completedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(a2aTask.id, taskId))

          notifyTaskStateChange(taskId, 'completed').catch((err) => {
            logger.error('Failed to trigger push notification', { taskId, error: err })
          })

          sendEvent('task', {
            kind: 'task',
            id: taskId,
            contextId,
            status: { state: 'completed', timestamp: new Date().toISOString() },
            history,
            artifacts,
          })
        }
      } catch (error) {
        const isTimeout = error instanceof Error && error.name === 'TimeoutError'
        logger.error(`Streaming error for task ${taskId}:`, { error, isTimeout })

        const errorMessage = isTimeout
          ? `Workflow execution timed out after ${A2A_DEFAULT_TIMEOUT}ms`
          : error instanceof Error
            ? error.message
            : 'Streaming failed'

        await db
          .update(a2aTask)
          .set({
            status: 'failed',
            completedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(a2aTask.id, taskId))

        notifyTaskStateChange(taskId, 'failed').catch((err) => {
          logger.error('Failed to trigger push notification for failure', { taskId, error: err })
        })

        sendEvent('error', {
          code: A2A_ERROR_CODES.INTERNAL_ERROR,
          message: errorMessage,
        })
      } finally {
        await releaseLock(lockKey, lockValue)
        controller.close()
      }
    },
  })

  return new NextResponse(stream, {
    headers: {
      ...SSE_HEADERS,
      'X-Task-Id': taskId,
    },
  })
}

/**
 * Handle tasks/get - Query task status
 */
async function handleTaskGet(id: string | number, params: TaskIdParams): Promise<NextResponse> {
  if (!params?.id) {
    return NextResponse.json(
      createError(id, A2A_ERROR_CODES.INVALID_PARAMS, 'Task ID is required'),
      { status: 400 }
    )
  }

  const historyLength =
    params.historyLength !== undefined && params.historyLength >= 0
      ? params.historyLength
      : undefined

  const [task] = await db.select().from(a2aTask).where(eq(a2aTask.id, params.id)).limit(1)

  if (!task) {
    return NextResponse.json(createError(id, A2A_ERROR_CODES.TASK_NOT_FOUND, 'Task not found'), {
      status: 404,
    })
  }

  const taskResponse = buildTaskResponse({
    taskId: task.id,
    contextId: task.sessionId || task.id,
    state: task.status as TaskState,
    history: task.messages as Message[],
    artifacts: (task.artifacts as Artifact[]) || [],
  })

  const result = formatTaskResponse(taskResponse, historyLength)

  return NextResponse.json(createResponse(id, result))
}

/**
 * Handle tasks/cancel - Cancel a running task
 */
async function handleTaskCancel(id: string | number, params: TaskIdParams): Promise<NextResponse> {
  if (!params?.id) {
    return NextResponse.json(
      createError(id, A2A_ERROR_CODES.INVALID_PARAMS, 'Task ID is required'),
      { status: 400 }
    )
  }

  const [task] = await db.select().from(a2aTask).where(eq(a2aTask.id, params.id)).limit(1)

  if (!task) {
    return NextResponse.json(createError(id, A2A_ERROR_CODES.TASK_NOT_FOUND, 'Task not found'), {
      status: 404,
    })
  }

  if (isTerminalState(task.status as TaskState)) {
    return NextResponse.json(
      createError(id, A2A_ERROR_CODES.TASK_ALREADY_COMPLETE, 'Task already in terminal state'),
      { status: 400 }
    )
  }

  if (task.executionId) {
    try {
      await markExecutionCancelled(task.executionId)
      logger.info('Cancelled workflow execution', {
        taskId: task.id,
        executionId: task.executionId,
      })
    } catch (error) {
      logger.warn('Failed to cancel workflow execution', {
        taskId: task.id,
        executionId: task.executionId,
        error,
      })
    }
  }

  await db
    .update(a2aTask)
    .set({
      status: 'canceled',
      updatedAt: new Date(),
      completedAt: new Date(),
    })
    .where(eq(a2aTask.id, params.id))

  notifyTaskStateChange(params.id, 'canceled').catch((err) => {
    logger.error('Failed to trigger push notification for cancellation', {
      taskId: params.id,
      error: err,
    })
  })

  const canceledTask = buildTaskResponse({
    taskId: task.id,
    contextId: task.sessionId || task.id,
    state: 'canceled',
    history: task.messages as Message[],
    artifacts: (task.artifacts as Artifact[]) || [],
  })

  return NextResponse.json(createResponse(id, canceledTask))
}

/**
 * Handle tasks/resubscribe - Reconnect to SSE stream for an ongoing task
 */
async function handleTaskResubscribe(
  request: NextRequest,
  id: string | number,
  params: TaskIdParams
): Promise<NextResponse> {
  if (!params?.id) {
    return NextResponse.json(
      createError(id, A2A_ERROR_CODES.INVALID_PARAMS, 'Task ID is required'),
      { status: 400 }
    )
  }

  const [task] = await db.select().from(a2aTask).where(eq(a2aTask.id, params.id)).limit(1)

  if (!task) {
    return NextResponse.json(createError(id, A2A_ERROR_CODES.TASK_NOT_FOUND, 'Task not found'), {
      status: 404,
    })
  }

  const encoder = new TextEncoder()

  if (isTerminalState(task.status as TaskState)) {
    const completedTask = buildTaskResponse({
      taskId: task.id,
      contextId: task.sessionId || task.id,
      state: task.status as TaskState,
      history: task.messages as Message[],
      artifacts: (task.artifacts as Artifact[]) || [],
    })
    const jsonRpcResponse = { jsonrpc: '2.0' as const, id, result: completedTask }
    const sseData = `event: task\ndata: ${JSON.stringify(jsonRpcResponse)}\n\n`
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(sseData))
        controller.close()
      },
    })
    return new NextResponse(stream, { headers: SSE_HEADERS })
  }
  let isCancelled = false
  let pollTimeoutId: ReturnType<typeof setTimeout> | null = null

  const abortSignal = request.signal
  abortSignal.addEventListener('abort', () => {
    isCancelled = true
    if (pollTimeoutId) {
      clearTimeout(pollTimeoutId)
      pollTimeoutId = null
    }
  })

  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (event: string, data: unknown): boolean => {
        if (isCancelled || abortSignal.aborted) return false
        try {
          const jsonRpcResponse = { jsonrpc: '2.0' as const, id, result: data }
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(jsonRpcResponse)}\n\n`)
          )
          return true
        } catch (error) {
          logger.error('Error sending SSE event:', error)
          isCancelled = true
          return false
        }
      }

      const cleanup = () => {
        isCancelled = true
        if (pollTimeoutId) {
          clearTimeout(pollTimeoutId)
          pollTimeoutId = null
        }
      }

      if (
        !sendEvent('status', {
          kind: 'status',
          taskId: task.id,
          contextId: task.sessionId,
          status: { state: task.status, timestamp: new Date().toISOString() },
        })
      ) {
        cleanup()
        return
      }

      const pollInterval = 3000 // 3 seconds
      const maxPolls = 100 // 5 minutes max

      let polls = 0
      const poll = async () => {
        if (isCancelled || abortSignal.aborted) {
          cleanup()
          return
        }

        polls++
        if (polls > maxPolls) {
          cleanup()
          try {
            controller.close()
          } catch {
            // Already closed
          }
          return
        }

        try {
          const [updatedTask] = await db
            .select()
            .from(a2aTask)
            .where(eq(a2aTask.id, params.id))
            .limit(1)

          if (isCancelled) {
            cleanup()
            return
          }

          if (!updatedTask) {
            sendEvent('error', { code: A2A_ERROR_CODES.TASK_NOT_FOUND, message: 'Task not found' })
            cleanup()
            try {
              controller.close()
            } catch {
              // Already closed
            }
            return
          }

          if (updatedTask.status !== task.status) {
            if (
              !sendEvent('status', {
                kind: 'status',
                taskId: updatedTask.id,
                contextId: updatedTask.sessionId,
                status: { state: updatedTask.status, timestamp: new Date().toISOString() },
                final: isTerminalState(updatedTask.status as TaskState),
              })
            ) {
              cleanup()
              return
            }
          }

          if (isTerminalState(updatedTask.status as TaskState)) {
            const messages = updatedTask.messages as Message[]
            const lastMessage = messages[messages.length - 1]
            if (lastMessage && lastMessage.role === 'agent') {
              sendEvent('message', {
                ...lastMessage,
                taskId: updatedTask.id,
                contextId: updatedTask.sessionId || updatedTask.id,
                final: true,
              })
            }

            cleanup()
            try {
              controller.close()
            } catch {
              // Already closed
            }
            return
          }

          pollTimeoutId = setTimeout(poll, pollInterval)
        } catch (error) {
          logger.error('Error during SSE poll:', error)
          sendEvent('error', {
            code: A2A_ERROR_CODES.INTERNAL_ERROR,
            message: error instanceof Error ? error.message : 'Polling failed',
          })
          cleanup()
          try {
            controller.close()
          } catch {
            // Already closed
          }
        }
      }

      poll()
    },
    cancel() {
      isCancelled = true
      if (pollTimeoutId) {
        clearTimeout(pollTimeoutId)
        pollTimeoutId = null
      }
    },
  })

  return new NextResponse(stream, {
    headers: {
      ...SSE_HEADERS,
      'X-Task-Id': params.id,
    },
  })
}

/**
 * Handle tasks/pushNotificationConfig/set - Set webhook for task updates
 */
async function handlePushNotificationSet(
  id: string | number,
  params: PushNotificationSetParams
): Promise<NextResponse> {
  if (!params?.id) {
    return NextResponse.json(
      createError(id, A2A_ERROR_CODES.INVALID_PARAMS, 'Task ID is required'),
      { status: 400 }
    )
  }

  if (!params?.pushNotificationConfig?.url) {
    return NextResponse.json(
      createError(id, A2A_ERROR_CODES.INVALID_PARAMS, 'Push notification URL is required'),
      { status: 400 }
    )
  }

  const urlValidation = await validateUrlWithDNS(
    params.pushNotificationConfig.url,
    'Push notification URL'
  )
  if (!urlValidation.isValid) {
    return NextResponse.json(
      createError(id, A2A_ERROR_CODES.INVALID_PARAMS, urlValidation.error || 'Invalid URL'),
      { status: 400 }
    )
  }

  const [task] = await db.select().from(a2aTask).where(eq(a2aTask.id, params.id)).limit(1)

  if (!task) {
    return NextResponse.json(createError(id, A2A_ERROR_CODES.TASK_NOT_FOUND, 'Task not found'), {
      status: 404,
    })
  }

  const [existingConfig] = await db
    .select()
    .from(a2aPushNotificationConfig)
    .where(eq(a2aPushNotificationConfig.taskId, params.id))
    .limit(1)

  const config = params.pushNotificationConfig

  if (existingConfig) {
    await db
      .update(a2aPushNotificationConfig)
      .set({
        url: config.url,
        token: config.token || null,
        isActive: true,
        updatedAt: new Date(),
      })
      .where(eq(a2aPushNotificationConfig.id, existingConfig.id))
  } else {
    await db.insert(a2aPushNotificationConfig).values({
      id: uuidv4(),
      taskId: params.id,
      url: config.url,
      token: config.token || null,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
  }

  const result: PushNotificationConfig = {
    url: config.url,
    token: config.token,
  }

  return NextResponse.json(createResponse(id, result))
}

/**
 * Handle tasks/pushNotificationConfig/get - Get webhook config for a task
 */
async function handlePushNotificationGet(
  id: string | number,
  params: TaskIdParams
): Promise<NextResponse> {
  if (!params?.id) {
    return NextResponse.json(
      createError(id, A2A_ERROR_CODES.INVALID_PARAMS, 'Task ID is required'),
      { status: 400 }
    )
  }

  const [task] = await db.select().from(a2aTask).where(eq(a2aTask.id, params.id)).limit(1)

  if (!task) {
    return NextResponse.json(createError(id, A2A_ERROR_CODES.TASK_NOT_FOUND, 'Task not found'), {
      status: 404,
    })
  }

  const [config] = await db
    .select()
    .from(a2aPushNotificationConfig)
    .where(eq(a2aPushNotificationConfig.taskId, params.id))
    .limit(1)

  if (!config) {
    return NextResponse.json(
      createError(id, A2A_ERROR_CODES.TASK_NOT_FOUND, 'Push notification config not found'),
      { status: 404 }
    )
  }

  const result: PushNotificationConfig = {
    url: config.url,
    token: config.token || undefined,
  }

  return NextResponse.json(createResponse(id, result))
}

/**
 * Handle tasks/pushNotificationConfig/delete - Delete webhook config for a task
 */
async function handlePushNotificationDelete(
  id: string | number,
  params: TaskIdParams
): Promise<NextResponse> {
  if (!params?.id) {
    return NextResponse.json(
      createError(id, A2A_ERROR_CODES.INVALID_PARAMS, 'Task ID is required'),
      { status: 400 }
    )
  }

  const [task] = await db.select().from(a2aTask).where(eq(a2aTask.id, params.id)).limit(1)

  if (!task) {
    return NextResponse.json(createError(id, A2A_ERROR_CODES.TASK_NOT_FOUND, 'Task not found'), {
      status: 404,
    })
  }

  const [config] = await db
    .select()
    .from(a2aPushNotificationConfig)
    .where(eq(a2aPushNotificationConfig.taskId, params.id))
    .limit(1)

  if (!config) {
    return NextResponse.json(
      createError(id, A2A_ERROR_CODES.TASK_NOT_FOUND, 'Push notification config not found'),
      { status: 404 }
    )
  }

  await db.delete(a2aPushNotificationConfig).where(eq(a2aPushNotificationConfig.id, config.id))

  return NextResponse.json(createResponse(id, { success: true }))
}
