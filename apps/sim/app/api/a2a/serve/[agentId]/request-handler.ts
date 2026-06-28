import type {
  AgentCard,
  Artifact,
  DeleteTaskPushNotificationConfigParams,
  GetTaskPushNotificationConfigParams,
  ListTaskPushNotificationConfigParams,
  Message,
  MessageSendParams,
  Task,
  TaskArtifactUpdateEvent,
  TaskIdParams,
  TaskPushNotificationConfig,
  TaskQueryParams,
  TaskState,
  TaskStatusUpdateEvent,
} from '@a2a-js/sdk'
import { A2AError, type A2ARequestHandler } from '@a2a-js/sdk/server'
import { db } from '@sim/db'
import { a2aPushNotificationConfig, a2aTask } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { eq } from 'drizzle-orm'
import { A2A_DEFAULT_TIMEOUT, A2A_MAX_HISTORY_LENGTH } from '@/lib/a2a/constants'
import { notifyTaskStateChange } from '@/lib/a2a/push-notifications'
import {
  createAgentMessage,
  extractWorkflowInput,
  isTerminalState,
  parseWorkflowSSEChunk,
} from '@/lib/a2a/utils'
import { acquireLock, releaseLock } from '@/lib/core/config/redis'
import { validateUrlWithDNS } from '@/lib/core/security/input-validation.server'
import { markExecutionCancelled } from '@/lib/execution/cancellation'
import {
  buildExecuteRequest,
  buildStatusUpdate,
  buildTaskResponse,
  extractAgentContent,
} from '@/app/api/a2a/serve/[agentId]/utils'

const logger = createLogger('A2ARequestHandler')

const RESUBSCRIBE_POLL_INTERVAL_MS = 3000
const RESUBSCRIBE_MAX_POLLS = 100

interface HandlerAgent {
  id: string
  name: string
  workflowId: string
  workspaceId: string
}

export interface SimA2AHandlerConfig {
  agent: HandlerAgent
  agentCard: AgentCard
  apiKey?: string | null
  executionUserId?: string
  callerFingerprint: string
  requestSignal?: AbortSignal
}

/**
 * Sim implementation of the A2A {@link A2ARequestHandler} interface.
 *
 * The SDK's {@link import('@a2a-js/sdk/server').JsonRpcTransportHandler} drives this
 * handler — it owns JSON-RPC parsing, method routing, capability checks, and
 * error enveloping. This class supplies the Sim-specific behavior that the SDK
 * cannot know about: executing the backing workflow, task persistence, caller
 * isolation, distributed locking, and push-notification delivery.
 *
 * Auth, workspace access, and billing entitlement are enforced by the route
 * before the request reaches this handler.
 */
export class SimA2ARequestHandler implements A2ARequestHandler {
  constructor(private readonly config: SimA2AHandlerConfig) {}

  getAgentCard(): Promise<AgentCard> {
    return Promise.resolve(this.config.agentCard)
  }

  async getAuthenticatedExtendedAgentCard(): Promise<AgentCard> {
    throw A2AError.authenticatedExtendedCardNotConfigured()
  }

  async sendMessage(params: MessageSendParams): Promise<Task> {
    const { agent } = this.config
    const message = params.message
    const taskId = message.taskId || generateId()
    const contextId = message.contextId || generateId()

    const lockKey = `a2a:task:${taskId}:lock`
    const lockValue = generateId()
    const acquired = await acquireLock(lockKey, lockValue, 60)
    if (!acquired) {
      throw A2AError.internalError('Task is currently being processed')
    }

    let movedToWorking = false
    try {
      const existingTask = await this.loadExistingTaskForSend(message.taskId)
      const history: Message[] = existingTask ? (existingTask.messages as Message[]) : []
      history.push(message)
      this.truncateHistory(history)

      if (existingTask) {
        await db
          .update(a2aTask)
          .set({ status: 'working', messages: history, updatedAt: new Date() })
          .where(eq(a2aTask.id, taskId))
      } else {
        await db.insert(a2aTask).values({
          id: taskId,
          agentId: agent.id,
          sessionId: contextId,
          status: 'working',
          messages: history,
          metadata: { callerFingerprint: this.config.callerFingerprint },
          createdAt: new Date(),
          updatedAt: new Date(),
        })
      }
      movedToWorking = true

      const workflowInput = extractWorkflowInput(message)
      if (!workflowInput) {
        throw A2AError.invalidParams('Message must contain at least one part with content')
      }

      const { url, headers, useInternalAuth } = await buildExecuteRequest({
        workflowId: agent.workflowId,
        apiKey: this.config.apiKey,
        userId: this.config.executionUserId,
      })

      logger.info(`Executing workflow ${agent.workflowId} for A2A task ${taskId}`)

      const response = await fetch(url, {
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
      const executionId = executeResult.executionId || executeResult.metadata?.executionId
      const executionSucceeded = response.ok && executeResult.success !== false
      const finalState: TaskState = executionSucceeded ? 'completed' : 'failed'

      const agentMessage = createAgentMessage(extractAgentContent(executeResult))
      agentMessage.taskId = taskId
      agentMessage.contextId = contextId
      history.push(agentMessage)

      const artifacts: Artifact[] = executeResult.output?.artifacts || []

      await db
        .update(a2aTask)
        .set({
          status: finalState,
          messages: history,
          artifacts,
          executionId,
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(a2aTask.id, taskId))

      this.notifyIfTerminal(taskId, finalState)

      return buildTaskResponse({ taskId, contextId, state: finalState, history, artifacts })
    } catch (error) {
      await this.failTask(taskId, movedToWorking)
      throw this.toA2AError(error)
    } finally {
      await releaseLock(lockKey, lockValue)
    }
  }

  async *sendMessageStream(
    params: MessageSendParams
  ): AsyncGenerator<
    Message | Task | TaskStatusUpdateEvent | TaskArtifactUpdateEvent,
    void,
    undefined
  > {
    const { agent } = this.config
    const message = params.message
    const contextId = message.contextId || generateId()
    const taskId = message.taskId || generateId()

    const lockKey = `a2a:task:${taskId}:lock`
    const lockValue = generateId()
    const acquired = await acquireLock(lockKey, lockValue, 300)
    if (!acquired) {
      throw A2AError.internalError('Task is currently being processed')
    }

    let movedToWorking = false
    try {
      const existingTask = await this.loadExistingTaskForSend(message.taskId)
      const history: Message[] = existingTask ? (existingTask.messages as Message[]) : []
      history.push(message)
      this.truncateHistory(history)

      if (existingTask) {
        await db
          .update(a2aTask)
          .set({ status: 'working', messages: history, updatedAt: new Date() })
          .where(eq(a2aTask.id, taskId))
      } else {
        await db.insert(a2aTask).values({
          id: taskId,
          agentId: agent.id,
          sessionId: contextId,
          status: 'working',
          messages: history,
          metadata: { callerFingerprint: this.config.callerFingerprint },
          createdAt: new Date(),
          updatedAt: new Date(),
        })
      }
      movedToWorking = true

      yield buildStatusUpdate({ taskId, contextId, state: 'working', final: false })

      const workflowInput = extractWorkflowInput(message)
      if (!workflowInput) {
        throw A2AError.invalidParams('Message must contain at least one part with content')
      }

      const { url, headers, useInternalAuth } = await buildExecuteRequest({
        workflowId: agent.workflowId,
        apiKey: this.config.apiKey,
        userId: this.config.executionUserId,
        stream: true,
      })

      const response = await fetch(url, {
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
      const streamingExecutionId = response.headers.get('X-Execution-Id') || undefined
      const isStreamingResponse =
        contentType.includes('text/event-stream') || contentType.includes('text/plain')

      if (response.body && isStreamingResponse) {
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        const contentChunks: string[] = []
        let finalContent: string | undefined
        let finalArtifacts: Artifact[] = []
        let sseBuffer = ''

        while (true) {
          if (this.config.requestSignal?.aborted) {
            await reader.cancel().catch(() => {})
            return
          }

          const { done, value } = await reader.read()
          if (done) break

          sseBuffer += decoder.decode(value, { stream: true })
          const frames = sseBuffer.split('\n\n')
          sseBuffer = frames.pop() ?? ''

          for (const frame of frames) {
            const parsed = parseWorkflowSSEChunk(frame)

            if (parsed.content) {
              contentChunks.push(parsed.content)
              yield this.streamMessage(taskId, contextId, parsed.content)
            }

            if (parsed.finalContent) finalContent = parsed.finalContent
            if (parsed.finalArtifacts) finalArtifacts = parsed.finalArtifacts

            if (parsed.terminalState === 'canceled') {
              const agentMessage = createAgentMessage(finalContent || 'Task canceled')
              agentMessage.taskId = taskId
              agentMessage.contextId = contextId
              history.push(agentMessage)

              await db
                .update(a2aTask)
                .set({
                  status: 'canceled',
                  messages: history,
                  executionId: streamingExecutionId,
                  artifacts: finalArtifacts,
                  completedAt: new Date(),
                  updatedAt: new Date(),
                })
                .where(eq(a2aTask.id, taskId))

              this.notifyIfTerminal(taskId, 'canceled')

              yield buildTaskResponse({
                taskId,
                contextId,
                state: 'canceled',
                history,
                artifacts: finalArtifacts,
              })
              return
            }

            if (parsed.finalSuccess === false) {
              throw new Error('Workflow execution failed')
            }
          }
        }

        if (sseBuffer.trim().length > 0) {
          const parsed = parseWorkflowSSEChunk(sseBuffer)
          if (parsed.content) {
            contentChunks.push(parsed.content)
            yield this.streamMessage(taskId, contextId, parsed.content)
          }
          if (parsed.finalContent) finalContent = parsed.finalContent
          if (parsed.finalArtifacts) finalArtifacts = parsed.finalArtifacts
          if (parsed.finalSuccess === false) {
            throw new Error('Workflow execution failed')
          }
        }

        const accumulatedContent = contentChunks.join('')
        const messageContent =
          (finalContent !== undefined && finalContent.length > 0
            ? finalContent
            : accumulatedContent) || 'Task completed'
        const agentMessage = createAgentMessage(messageContent)
        agentMessage.taskId = taskId
        agentMessage.contextId = contextId
        history.push(agentMessage)

        await db
          .update(a2aTask)
          .set({
            status: 'completed',
            messages: history,
            executionId: streamingExecutionId,
            artifacts: finalArtifacts,
            completedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(a2aTask.id, taskId))

        this.notifyIfTerminal(taskId, 'completed')

        yield buildTaskResponse({
          taskId,
          contextId,
          state: 'completed',
          history,
          artifacts: finalArtifacts,
        })
        return
      }

      const result = await response.json()
      const executionSucceeded = result.success !== false
      const content = extractAgentContent(result)
      const finalState: TaskState = executionSucceeded ? 'completed' : 'failed'

      yield this.streamMessage(taskId, contextId, content)

      const agentMessage = createAgentMessage(content)
      agentMessage.taskId = taskId
      agentMessage.contextId = contextId
      history.push(agentMessage)

      const artifacts: Artifact[] = (result.output?.artifacts as Artifact[]) || []

      await db
        .update(a2aTask)
        .set({
          status: finalState,
          messages: history,
          artifacts,
          executionId: result.executionId || result.metadata?.executionId,
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(a2aTask.id, taskId))

      this.notifyIfTerminal(taskId, finalState)

      yield buildTaskResponse({ taskId, contextId, state: finalState, history, artifacts })
    } catch (error) {
      await this.failTask(taskId, movedToWorking)
      throw this.toA2AError(error)
    } finally {
      await releaseLock(lockKey, lockValue)
    }
  }

  async getTask(params: TaskQueryParams): Promise<Task> {
    const task = await this.getTaskForCaller(params.id)
    const historyLength =
      params.historyLength !== undefined && params.historyLength >= 0
        ? params.historyLength
        : undefined

    const history = task.messages as Message[]
    return buildTaskResponse({
      taskId: task.id,
      contextId: task.sessionId || task.id,
      state: task.status as TaskState,
      history: historyLength !== undefined ? history.slice(-historyLength) : history,
      artifacts: (task.artifacts as Artifact[]) || [],
    })
  }

  async cancelTask(params: TaskIdParams): Promise<Task> {
    const task = await this.getTaskForCaller(params.id)

    if (isTerminalState(task.status as TaskState)) {
      throw A2AError.taskNotCancelable(params.id)
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
      .set({ status: 'canceled', completedAt: new Date(), updatedAt: new Date() })
      .where(eq(a2aTask.id, params.id))

    this.notifyIfTerminal(params.id, 'canceled')

    return buildTaskResponse({
      taskId: task.id,
      contextId: task.sessionId || task.id,
      state: 'canceled',
      history: task.messages as Message[],
      artifacts: (task.artifacts as Artifact[]) || [],
    })
  }

  async setTaskPushNotificationConfig(
    params: TaskPushNotificationConfig
  ): Promise<TaskPushNotificationConfig> {
    const config = params.pushNotificationConfig
    const urlValidation = await validateUrlWithDNS(config.url, 'Push notification URL')
    if (!urlValidation.isValid) {
      throw A2AError.invalidParams(urlValidation.error || 'Invalid push notification URL')
    }

    await this.getTaskForCaller(params.taskId)

    const [existingConfig] = await db
      .select()
      .from(a2aPushNotificationConfig)
      .where(eq(a2aPushNotificationConfig.taskId, params.taskId))
      .limit(1)

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
        id: generateId(),
        taskId: params.taskId,
        url: config.url,
        token: config.token || null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
    }

    return {
      taskId: params.taskId,
      pushNotificationConfig: { url: config.url, token: config.token },
    }
  }

  async getTaskPushNotificationConfig(
    params: TaskIdParams | GetTaskPushNotificationConfigParams
  ): Promise<TaskPushNotificationConfig> {
    await this.getTaskForCaller(params.id)

    const [config] = await db
      .select()
      .from(a2aPushNotificationConfig)
      .where(eq(a2aPushNotificationConfig.taskId, params.id))
      .limit(1)

    if (!config) {
      throw A2AError.invalidParams('No push notification configuration found for task')
    }

    return {
      taskId: params.id,
      pushNotificationConfig: { url: config.url, token: config.token || undefined },
    }
  }

  async listTaskPushNotificationConfigs(
    params: ListTaskPushNotificationConfigParams
  ): Promise<TaskPushNotificationConfig[]> {
    await this.getTaskForCaller(params.id)

    const configs = await db
      .select()
      .from(a2aPushNotificationConfig)
      .where(eq(a2aPushNotificationConfig.taskId, params.id))

    return configs.map((config) => ({
      taskId: params.id,
      pushNotificationConfig: { url: config.url, token: config.token || undefined },
    }))
  }

  async deleteTaskPushNotificationConfig(
    params: DeleteTaskPushNotificationConfigParams
  ): Promise<void> {
    await this.getTaskForCaller(params.id)

    await db
      .delete(a2aPushNotificationConfig)
      .where(eq(a2aPushNotificationConfig.taskId, params.id))
  }

  async *resubscribe(
    params: TaskIdParams
  ): AsyncGenerator<Task | TaskStatusUpdateEvent | TaskArtifactUpdateEvent, void, undefined> {
    const task = await this.getTaskForCaller(params.id)
    const contextId = task.sessionId || task.id

    if (isTerminalState(task.status as TaskState)) {
      yield buildTaskResponse({
        taskId: task.id,
        contextId,
        state: task.status as TaskState,
        history: task.messages as Message[],
        artifacts: (task.artifacts as Artifact[]) || [],
      })
      return
    }

    yield buildStatusUpdate({
      taskId: task.id,
      contextId,
      state: task.status as TaskState,
      final: false,
    })

    let lastStatus = task.status

    for (let poll = 0; poll < RESUBSCRIBE_MAX_POLLS; poll++) {
      if (this.config.requestSignal?.aborted) return

      await sleep(RESUBSCRIBE_POLL_INTERVAL_MS)
      if (this.config.requestSignal?.aborted) return

      const [updated] = await db.select().from(a2aTask).where(eq(a2aTask.id, params.id)).limit(1)
      if (!updated) {
        throw A2AError.taskNotFound(params.id)
      }

      const terminal = isTerminalState(updated.status as TaskState)

      if (updated.status !== lastStatus) {
        lastStatus = updated.status
        yield buildStatusUpdate({
          taskId: updated.id,
          contextId: updated.sessionId || updated.id,
          state: updated.status as TaskState,
          final: terminal,
        })
      }

      if (terminal) {
        yield buildTaskResponse({
          taskId: updated.id,
          contextId: updated.sessionId || updated.id,
          state: updated.status as TaskState,
          history: updated.messages as Message[],
          artifacts: (updated.artifacts as Artifact[]) || [],
        })
        return
      }
    }
  }

  private async loadExistingTaskForSend(
    taskId: string | undefined
  ): Promise<typeof a2aTask.$inferSelect | null> {
    if (!taskId) return null

    const [task] = await db.select().from(a2aTask).where(eq(a2aTask.id, taskId)).limit(1)
    if (!task || task.agentId !== this.config.agent.id) {
      throw A2AError.taskNotFound(taskId)
    }
    if (!this.hasCallerAccess(task)) {
      throw A2AError.taskNotFound(taskId)
    }
    if (isTerminalState(task.status as TaskState)) {
      throw A2AError.invalidRequest(`Task ${taskId} is already in a terminal state`)
    }
    return task
  }

  private async getTaskForCaller(taskId: string): Promise<typeof a2aTask.$inferSelect> {
    const [task] = await db.select().from(a2aTask).where(eq(a2aTask.id, taskId)).limit(1)
    if (!task || task.agentId !== this.config.agent.id || !this.hasCallerAccess(task)) {
      throw A2AError.taskNotFound(taskId)
    }
    return task
  }

  private hasCallerAccess(task: typeof a2aTask.$inferSelect): boolean {
    const metadata = (task.metadata as Record<string, unknown> | null) ?? {}
    const stored =
      typeof metadata.callerFingerprint === 'string' ? metadata.callerFingerprint : null
    return !stored || stored === this.config.callerFingerprint
  }

  private streamMessage(taskId: string, contextId: string, text: string): Message {
    const message = createAgentMessage(text)
    message.taskId = taskId
    message.contextId = contextId
    return message
  }

  private truncateHistory(history: Message[]): void {
    if (history.length > A2A_MAX_HISTORY_LENGTH) {
      history.splice(0, history.length - A2A_MAX_HISTORY_LENGTH)
    }
  }

  private notifyIfTerminal(taskId: string, state: TaskState): void {
    if (!isTerminalState(state)) return
    notifyTaskStateChange(taskId, state).catch((err) => {
      logger.error('Failed to trigger push notification', { taskId, state, error: err })
    })
  }

  private async failTask(taskId: string, movedToWorking: boolean): Promise<void> {
    if (!movedToWorking) return
    try {
      await db
        .update(a2aTask)
        .set({ status: 'failed', completedAt: new Date(), updatedAt: new Date() })
        .where(eq(a2aTask.id, taskId))
      this.notifyIfTerminal(taskId, 'failed')
    } catch (error) {
      logger.error('Failed to mark A2A task as failed', { taskId, error })
    }
  }

  private toA2AError(error: unknown): A2AError {
    if (error instanceof A2AError) return error
    const isTimeout = error instanceof Error && error.name === 'TimeoutError'
    const message = isTimeout
      ? `Workflow execution timed out after ${A2A_DEFAULT_TIMEOUT}ms`
      : getErrorMessage(error, 'Workflow execution failed')
    return A2AError.internalError(message)
  }
}
