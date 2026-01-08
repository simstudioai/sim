/**
 * A2A Serve Endpoint - Implements A2A protocol for workflow agents
 *
 * Handles JSON-RPC 2.0 requests for:
 * - tasks/send: Create or continue a task
 * - tasks/get: Query task status
 * - tasks/cancel: Cancel a running task
 * - tasks/sendSubscribe: SSE streaming for real-time updates
 */

import { db } from '@sim/db'
import { a2aAgent, a2aTask, workflow } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { A2A_DEFAULT_TIMEOUT, A2A_METHODS } from '@/lib/a2a/constants'
import {
  A2AErrorCode,
  type Artifact,
  type Task,
  type TaskCancelParams,
  type TaskMessage,
  type TaskQueryParams,
  type TaskSendParams,
  type TaskState,
} from '@/lib/a2a/types'
import {
  createAgentMessage,
  createTaskStatus,
  extractTextContent,
  formatTaskResponse,
  generateTaskId,
  isTerminalState,
} from '@/lib/a2a/utils'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { SSE_HEADERS } from '@/lib/core/utils/sse'
import { getBaseUrl } from '@/lib/core/utils/urls'

const logger = createLogger('A2AServeAPI')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface RouteParams {
  agentId: string
}

interface JSONRPCRequest {
  jsonrpc: '2.0'
  id: string | number
  method: string
  params?: unknown
}

interface JSONRPCResponse {
  jsonrpc: '2.0'
  id: string | number | null
  result?: unknown
  error?: {
    code: number
    message: string
    data?: unknown
  }
}

function createResponse(id: string | number | null, result: unknown): JSONRPCResponse {
  return { jsonrpc: '2.0', id, result }
}

function createError(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown
): JSONRPCResponse {
  return { jsonrpc: '2.0', id, error: { code, message, data } }
}

function isJSONRPCRequest(obj: unknown): obj is JSONRPCRequest {
  if (!obj || typeof obj !== 'object') return false
  const r = obj as Record<string, unknown>
  return r.jsonrpc === '2.0' && typeof r.method === 'string' && r.id !== undefined
}

/**
 * GET - Returns the Agent Card (discovery document)
 *
 * This allows clients to discover the agent's capabilities by calling GET on the serve endpoint.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<RouteParams> }) {
  const { agentId } = await params

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

    // Return full Agent Card for discovery
    return NextResponse.json(
      {
        name: agent.name,
        description: agent.description,
        url: `${baseUrl}/api/a2a/serve/${agent.id}`,
        version: agent.version,
        documentationUrl: `${baseUrl}/docs/a2a`,
        provider: {
          organization: 'Sim Studio',
          url: baseUrl,
        },
        capabilities: agent.capabilities,
        skills: agent.skills,
        authentication: agent.authentication,
        defaultInputModes: ['text', 'data'],
        defaultOutputModes: ['text', 'data'],
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=3600',
        },
      }
    )
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
    // Verify agent exists and is published
    const [agent] = await db
      .select({
        id: a2aAgent.id,
        name: a2aAgent.name,
        workflowId: a2aAgent.workflowId,
        workspaceId: a2aAgent.workspaceId,
        isPublished: a2aAgent.isPublished,
        capabilities: a2aAgent.capabilities,
      })
      .from(a2aAgent)
      .where(eq(a2aAgent.id, agentId))
      .limit(1)

    if (!agent) {
      return NextResponse.json(
        createError(null, A2AErrorCode.AGENT_UNAVAILABLE, 'Agent not found'),
        { status: 404 }
      )
    }

    if (!agent.isPublished) {
      return NextResponse.json(
        createError(null, A2AErrorCode.AGENT_UNAVAILABLE, 'Agent not published'),
        { status: 404 }
      )
    }

    // Auth check
    const auth = await checkHybridAuth(request, { requireWorkflowId: false })
    if (!auth.success || !auth.userId) {
      return NextResponse.json(
        createError(null, A2AErrorCode.AUTHENTICATION_REQUIRED, 'Unauthorized'),
        { status: 401 }
      )
    }

    // Verify workflow is deployed
    const [wf] = await db
      .select({ isDeployed: workflow.isDeployed })
      .from(workflow)
      .where(eq(workflow.id, agent.workflowId))
      .limit(1)

    if (!wf?.isDeployed) {
      return NextResponse.json(
        createError(null, A2AErrorCode.AGENT_UNAVAILABLE, 'Workflow is not deployed'),
        { status: 400 }
      )
    }

    // Parse JSON-RPC request
    const body = await request.json()

    if (!isJSONRPCRequest(body)) {
      return NextResponse.json(
        createError(null, A2AErrorCode.INVALID_REQUEST, 'Invalid JSON-RPC request'),
        { status: 400 }
      )
    }

    const { id, method, params: rpcParams } = body
    const apiKey =
      request.headers.get('X-API-Key') ||
      request.headers.get('Authorization')?.replace('Bearer ', '')

    logger.info(`A2A request: ${method} for agent ${agentId}`)

    switch (method) {
      case A2A_METHODS.TASKS_SEND:
        return handleTaskSend(id, agent, rpcParams as TaskSendParams, apiKey)

      case A2A_METHODS.TASKS_GET:
        return handleTaskGet(id, rpcParams as TaskQueryParams)

      case A2A_METHODS.TASKS_CANCEL:
        return handleTaskCancel(id, rpcParams as TaskCancelParams)

      case A2A_METHODS.TASKS_SEND_SUBSCRIBE:
        return handleTaskSendSubscribe(request, id, agent, rpcParams as TaskSendParams, apiKey)

      default:
        return NextResponse.json(
          createError(id, A2AErrorCode.METHOD_NOT_FOUND, `Method not found: ${method}`),
          { status: 404 }
        )
    }
  } catch (error) {
    logger.error('Error handling A2A request:', error)
    return NextResponse.json(createError(null, A2AErrorCode.INTERNAL_ERROR, 'Internal error'), {
      status: 500,
    })
  }
}

/**
 * Handle tasks/send - Create or continue a task
 */
async function handleTaskSend(
  id: string | number,
  agent: {
    id: string
    name: string
    workflowId: string
    workspaceId: string
  },
  params: TaskSendParams,
  apiKey?: string | null
): Promise<NextResponse> {
  if (!params?.message) {
    return NextResponse.json(createError(id, A2AErrorCode.INVALID_PARAMS, 'Message is required'), {
      status: 400,
    })
  }

  const taskId = params.id || generateTaskId()
  const contextId = params.contextId

  // Check if task exists (continuation)
  let existingTask: typeof a2aTask.$inferSelect | null = null
  if (params.id) {
    const [found] = await db.select().from(a2aTask).where(eq(a2aTask.id, params.id)).limit(1)
    existingTask = found || null

    if (!existingTask) {
      return NextResponse.json(createError(id, A2AErrorCode.TASK_NOT_FOUND, 'Task not found'), {
        status: 404,
      })
    }

    if (isTerminalState(existingTask.status as TaskState)) {
      return NextResponse.json(
        createError(id, A2AErrorCode.TASK_ALREADY_COMPLETE, 'Task already in terminal state'),
        { status: 400 }
      )
    }
  }

  // Get existing history or start fresh
  const history: TaskMessage[] = existingTask?.messages
    ? (existingTask.messages as TaskMessage[])
    : []

  // Add the new user message
  history.push(params.message)

  // Create or update task
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
      metadata: params.metadata || {},
      createdAt: new Date(),
      updatedAt: new Date(),
    })
  }

  // Execute the workflow
  const executeUrl = `${getBaseUrl()}/api/workflows/${agent.workflowId}/execute`
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey) headers['X-API-Key'] = apiKey

  logger.info(`Executing workflow ${agent.workflowId} for A2A task ${taskId}`)

  try {
    // Extract text content from the TaskMessage for easier workflow consumption
    const messageText = extractTextContent(params.message)

    const response = await fetch(executeUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        input: messageText,
        triggerType: 'api',
      }),
      signal: AbortSignal.timeout(A2A_DEFAULT_TIMEOUT),
    })

    const executeResult = await response.json()

    // Determine final state
    const finalState: TaskState = response.ok ? 'completed' : 'failed'

    // Create agent response message
    const agentContent =
      executeResult.output?.content ||
      (typeof executeResult.output === 'object'
        ? JSON.stringify(executeResult.output)
        : String(executeResult.output || executeResult.error || 'Task completed'))

    const agentMessage = createAgentMessage(agentContent)
    history.push(agentMessage)

    // Extract artifacts if present
    const artifacts = executeResult.output?.artifacts || []

    // Update task with result
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

    const task: Task = {
      id: taskId,
      contextId: contextId || undefined,
      status: createTaskStatus(finalState),
      history,
      artifacts,
      metadata: params.metadata,
      kind: 'task',
    }

    return NextResponse.json(createResponse(id, task))
  } catch (error) {
    logger.error(`Error executing workflow for task ${taskId}:`, error)

    // Mark task as failed
    const errorMessage = error instanceof Error ? error.message : 'Workflow execution failed'

    await db
      .update(a2aTask)
      .set({
        status: 'failed',
        updatedAt: new Date(),
        completedAt: new Date(),
      })
      .where(eq(a2aTask.id, taskId))

    return NextResponse.json(createError(id, A2AErrorCode.INTERNAL_ERROR, errorMessage), {
      status: 500,
    })
  }
}

/**
 * Handle tasks/get - Query task status
 */
async function handleTaskGet(id: string | number, params: TaskQueryParams): Promise<NextResponse> {
  if (!params?.id) {
    return NextResponse.json(createError(id, A2AErrorCode.INVALID_PARAMS, 'Task ID is required'), {
      status: 400,
    })
  }

  // Validate historyLength if provided
  const historyLength =
    params.historyLength !== undefined && params.historyLength >= 0
      ? params.historyLength
      : undefined

  const [task] = await db.select().from(a2aTask).where(eq(a2aTask.id, params.id)).limit(1)

  if (!task) {
    return NextResponse.json(createError(id, A2AErrorCode.TASK_NOT_FOUND, 'Task not found'), {
      status: 404,
    })
  }

  const result = formatTaskResponse(
    {
      id: task.id,
      contextId: task.sessionId || undefined,
      status: createTaskStatus(task.status as TaskState),
      history: task.messages as TaskMessage[],
      artifacts: (task.artifacts as Artifact[]) || [],
      metadata: (task.metadata as Record<string, unknown>) || {},
      kind: 'task',
    },
    historyLength
  )

  return NextResponse.json(createResponse(id, result))
}

/**
 * Handle tasks/cancel - Cancel a running task
 */
async function handleTaskCancel(
  id: string | number,
  params: TaskCancelParams
): Promise<NextResponse> {
  if (!params?.id) {
    return NextResponse.json(createError(id, A2AErrorCode.INVALID_PARAMS, 'Task ID is required'), {
      status: 400,
    })
  }

  const [task] = await db.select().from(a2aTask).where(eq(a2aTask.id, params.id)).limit(1)

  if (!task) {
    return NextResponse.json(createError(id, A2AErrorCode.TASK_NOT_FOUND, 'Task not found'), {
      status: 404,
    })
  }

  if (isTerminalState(task.status as TaskState)) {
    return NextResponse.json(
      createError(id, A2AErrorCode.TASK_ALREADY_COMPLETE, 'Task already in terminal state'),
      { status: 400 }
    )
  }

  await db
    .update(a2aTask)
    .set({
      status: 'canceled',
      updatedAt: new Date(),
      completedAt: new Date(),
    })
    .where(eq(a2aTask.id, params.id))

  const result: Task = {
    id: task.id,
    contextId: task.sessionId || undefined,
    status: createTaskStatus('canceled'),
    history: task.messages as TaskMessage[],
    artifacts: (task.artifacts as Artifact[]) || [],
    kind: 'task',
  }

  return NextResponse.json(createResponse(id, result))
}

/**
 * Handle tasks/sendSubscribe - SSE streaming
 */
async function handleTaskSendSubscribe(
  request: NextRequest,
  id: string | number,
  agent: {
    id: string
    name: string
    workflowId: string
    workspaceId: string
  },
  params: TaskSendParams,
  apiKey?: string | null
): Promise<NextResponse> {
  if (!params?.message) {
    return NextResponse.json(createError(id, A2AErrorCode.INVALID_PARAMS, 'Message is required'), {
      status: 400,
    })
  }

  const contextId = params.contextId

  // Get existing task or prepare for new one
  let history: TaskMessage[] = []
  let existingTask: typeof a2aTask.$inferSelect | null = null

  if (params.id) {
    const [found] = await db.select().from(a2aTask).where(eq(a2aTask.id, params.id)).limit(1)
    existingTask = found || null

    if (!existingTask) {
      return NextResponse.json(createError(id, A2AErrorCode.TASK_NOT_FOUND, 'Task not found'), {
        status: 404,
      })
    }

    if (isTerminalState(existingTask.status as TaskState)) {
      return NextResponse.json(
        createError(id, A2AErrorCode.TASK_ALREADY_COMPLETE, 'Task already in terminal state'),
        { status: 400 }
      )
    }

    history = existingTask.messages as TaskMessage[]
  }

  const taskId = params.id || generateTaskId()
  history.push(params.message)

  // Create or update task record
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
      metadata: params.metadata || {},
      createdAt: new Date(),
      updatedAt: new Date(),
    })
  }

  // Create SSE stream
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
        } catch (error) {
          logger.error('Error sending SSE event:', error)
        }
      }

      // Send initial status
      sendEvent('task:status', {
        id: taskId,
        status: { state: 'working', timestamp: new Date().toISOString() },
      })

      try {
        // Execute workflow with streaming
        const executeUrl = `${getBaseUrl()}/api/workflows/${agent.workflowId}/execute`
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'X-Stream-Response': 'true',
        }
        if (apiKey) headers['X-API-Key'] = apiKey

        // Extract text content from the TaskMessage for easier workflow consumption
        const messageText = extractTextContent(params.message)

        const response = await fetch(executeUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            input: messageText,
            triggerType: 'api',
            stream: true,
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

        // Check content type to determine response handling
        const contentType = response.headers.get('content-type') || ''
        const isStreamingResponse =
          contentType.includes('text/event-stream') || contentType.includes('text/plain')

        if (response.body && isStreamingResponse) {
          // Handle streaming response - forward chunks
          const reader = response.body.getReader()
          const decoder = new TextDecoder()
          let fullContent = ''

          while (true) {
            const { done, value } = await reader.read()
            if (done) break

            const chunk = decoder.decode(value, { stream: true })
            fullContent += chunk

            // Forward chunk as message event
            sendEvent('task:message', {
              id: taskId,
              chunk,
            })
          }

          // Create final agent message
          const agentMessage = createAgentMessage(fullContent || 'Task completed')
          history.push(agentMessage)

          // Update task
          await db
            .update(a2aTask)
            .set({
              status: 'completed',
              messages: history,
              completedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(a2aTask.id, taskId))

          sendEvent('task:status', {
            id: taskId,
            status: { state: 'completed', timestamp: new Date().toISOString() },
            final: true,
          })
        } else {
          // Handle JSON response (non-streaming workflow)
          const result = await response.json()

          const content =
            result.output?.content ||
            (typeof result.output === 'object'
              ? JSON.stringify(result.output)
              : String(result.output || 'Task completed'))

          // Send the complete content as a single message
          sendEvent('task:message', {
            id: taskId,
            chunk: content,
          })

          const agentMessage = createAgentMessage(content)
          history.push(agentMessage)

          const artifacts = (result.output?.artifacts as Artifact[]) || []

          // Update task with result
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

          sendEvent('task:status', {
            id: taskId,
            status: { state: 'completed', timestamp: new Date().toISOString() },
            final: true,
          })
        }
      } catch (error) {
        logger.error(`Streaming error for task ${taskId}:`, error)

        await db
          .update(a2aTask)
          .set({
            status: 'failed',
            completedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(a2aTask.id, taskId))

        sendEvent('error', {
          code: A2AErrorCode.INTERNAL_ERROR,
          message: error instanceof Error ? error.message : 'Streaming failed',
        })
      } finally {
        sendEvent('task:done', { id: taskId })
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
