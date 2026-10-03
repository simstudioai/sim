import { createLogger } from '@sim/logger'
import { getValueAtPath, isRecordLike } from '@sim/utils/object'
import { truncate } from '@sim/utils/string'
import type { LoggingSession } from '@/lib/logs/execution/logging-session'
import { getToolDisplayTitle } from '@/lib/mothership/tools/tool-display'
import { getSlackBotCredential } from '@/lib/oauth/credential-service'
import {
  appendSlackAgentStream,
  formatSlackApiFailure,
  type SlackStreamChunk,
  setSlackAgentSessionStatus,
  startSlackAgentStream,
  stopSlackAgentStream,
} from '@/lib/webhooks/slack-agent-api'
import { SlackDeliveryError } from '@/lib/webhooks/slack-delivery-error'
import type {
  SlackStreamOutputConfig,
  SlackStreamResponseConfig,
} from '@/lib/webhooks/slack-stream-config'
import {
  registerSlackStreamSession,
  type SlackStreamSessionTarget,
  unregisterSlackStreamSession,
} from '@/lib/webhooks/slack-stream-sessions'
import { formatOutputSelector, scopeOutputBlockId } from '@/lib/workflows/streaming/output-selector'
import type { BlockCompletionCallbackData, ExecutionCallbacks } from '@/executor/execution/types'
import type { ExecutionResult, StreamingExecution } from '@/executor/types'
import type { AgentStreamEvent } from '@/providers/stream-events'

const TEXT_FLUSH_SIZE = 128
/** Slack applies the markdown limit to the accumulated message, not only the next append. */
const SLACK_MESSAGE_TEXT_LIMIT = 12_000
const TASK_TEXT_LIMIT = 256
const logger = createLogger('SlackExecutionStream')

interface SlackMessageStream {
  channel: string
  ts: string
  taskId?: string
  textLength: number
  textComplete: boolean
  stopped: boolean
}

/** Prefer a nearby paragraph/sentence, then a whole word; only oversized words need hard cuts. */
function textChunkEnd(
  text: string,
  offset: number,
  capacity: number,
  allowWordSplit: boolean
): number {
  let end = Math.min(offset + capacity, text.length)
  if (end === text.length) return end
  const candidate = text.slice(offset, end)
  const nearby = Math.max(0, candidate.length - 1_024)
  const boundaries = [/\n[\t\r ]*\n\s*/g, /[.!?]["'”’)]*\s+|\n\s*/g, /\s+/g]
  for (const [index, boundary] of boundaries.entries()) {
    let lastEnd = 0
    for (const match of candidate.matchAll(boundary)) {
      const boundaryEnd = match.index + match[0].length
      if (index === 2 || boundaryEnd > nearby) lastEnd = boundaryEnd
    }
    if (lastEnd) return offset + lastEnd
  }
  if (!allowWordSplit) return offset
  const lastCodeUnit = text.charCodeAt(end - 1)
  if (lastCodeUnit >= 0xd800 && lastCodeUnit <= 0xdbff) end--
  return end
}

interface SlackReplyTarget extends SlackStreamSessionTarget {
  initiatorUserId: string
  recipientUserId?: string
  recipientTeamId?: string
}

interface SlackExecutionStreamControllerOptions {
  credentialId: string
  workspaceId: string
  workflowId: string
  executionId: string
  userId: string
  triggerInput: Record<string, unknown>
  config: SlackStreamResponseConfig
  loggingSession: LoggingSession
  abortSignal?: AbortSignal
}

function requireEvent(triggerInput: Record<string, unknown>): Record<string, unknown> {
  if (!isRecordLike(triggerInput.event)) {
    throw new Error('Slack streaming trigger input is missing its normalized event')
  }
  return triggerInput.event
}

export function resolveSlackReplyTarget(triggerInput: Record<string, unknown>): SlackReplyTarget {
  const event = requireEvent(triggerInput)
  if (typeof event.channel !== 'string' || !event.channel) {
    throw new Error('Slack streaming trigger event is missing a channel')
  }
  const threadTs =
    typeof event.thread_ts === 'string' && event.thread_ts
      ? event.thread_ts
      : typeof event.timestamp === 'string'
        ? event.timestamp
        : ''
  if (!threadTs) {
    throw new Error('Slack streaming trigger event is missing a thread timestamp')
  }
  if (typeof event.user !== 'string' || !event.user) {
    throw new Error('Slack streaming trigger event is missing the initiator user ID')
  }

  if (event.channel.startsWith('D')) {
    return { channel: event.channel, threadTs, initiatorUserId: event.user }
  }
  if (typeof event.user_team_id !== 'string' || !event.user_team_id) {
    throw new Error('Slack channel streaming requires the recipient team ID')
  }
  return {
    channel: event.channel,
    threadTs,
    initiatorUserId: event.user,
    recipientUserId: event.user,
    recipientTeamId: event.user_team_id,
  }
}

function formatOutput(value: unknown): string {
  if (typeof value === 'string') return value
  const serialized = JSON.stringify(value, null, 2)
  if (serialized === undefined) throw new Error('Selected Slack stream output is not serializable')
  return serialized
}

class SlackInvocationStream {
  private readonly messages: SlackMessageStream[] = []
  private answerBuffer = ''
  private acknowledgedAnswer = ''
  private thinking = ''
  private failure?: Error
  private stopAttempted = false
  private chain: Promise<void> = Promise.resolve()
  private readonly tools = new Map<
    string,
    {
      name: string
      status: 'pending' | 'in_progress' | 'complete' | 'error'
      message: SlackMessageStream
    }
  >()

  constructor(
    private readonly token: string,
    private readonly target: SlackReplyTarget,
    private readonly config: SlackStreamResponseConfig,
    private readonly taskId: string,
    private readonly title: string,
    private readonly projectLiveText: (text: string) => Promise<string | null>,
    private readonly signal?: AbortSignal
  ) {}

  /** Retain the first failure without poisoning the queue used to settle and stop this response. */
  private enqueue(operation: () => Promise<void>): Promise<void> {
    this.chain = this.chain.then(operation).catch((error) => {
      this.failure ??= formatSlackApiFailure(error)
    })
    return this.chain
  }

  private async ensureStarted(): Promise<SlackMessageStream> {
    const current = this.messages.at(-1)
    if (current) return current
    return this.startMessage(
      [{ type: 'task_update', id: this.taskId, title: this.title, status: 'in_progress' }],
      this.taskId
    )
  }

  private async startMessage(
    chunks: SlackStreamChunk[],
    taskId?: string
  ): Promise<SlackMessageStream> {
    const started = await startSlackAgentStream(
      this.token,
      this.target,
      chunks,
      this.config.taskDisplayMode,
      this.signal
    )
    const textLength = chunks.reduce(
      (length, chunk) => length + (chunk.type === 'markdown_text' ? chunk.text.length : 0),
      0
    )
    const message = { ...started, taskId, textLength, textComplete: false, stopped: false }
    this.messages.push(message)
    return message
  }

  private async append(chunks: SlackStreamChunk[], message?: SlackMessageStream): Promise<void> {
    const target = message ?? (await this.ensureStarted())
    const textLength = chunks.reduce(
      (length, chunk) => length + (chunk.type === 'markdown_text' ? chunk.text.length : 0),
      0
    )
    try {
      await appendSlackAgentStream(this.token, target.channel, target.ts, chunks, this.signal)
      target.textLength += textLength
    } catch (error) {
      logger.warn('Slack stream append failed', {
        taskId: this.taskId,
        messageCount: this.messages.length,
        acknowledgedMessageCharacters: target.textLength,
        appendCharacters: textLength,
        error: formatSlackApiFailure(error).message,
      })
      throw error
    }
  }

  /** Continue in the same thread before the accumulated message reaches Slack's limit. */
  private async appendAnswerText(text: string): Promise<void> {
    for (let offset = 0; offset < text.length; ) {
      let message: SlackMessageStream | undefined = await this.ensureStarted()
      let end = message.textComplete
        ? offset
        : textChunkEnd(
            text,
            offset,
            SLACK_MESSAGE_TEXT_LIMIT - message.textLength,
            !message.textLength
          )
      if (end === offset) {
        message.textComplete = true
        message = undefined
        end = textChunkEnd(text, offset, SLACK_MESSAGE_TEXT_LIMIT, true)
      }
      for (;;) {
        const chunk = text.slice(offset, end)
        try {
          const chunks: SlackStreamChunk[] = [{ type: 'markdown_text', text: chunk }]
          if (message) await this.append(chunks, message)
          else message = await this.startMessage(chunks)
          this.acknowledgedAnswer += chunk
          offset = end
          message.textComplete = end < text.length
          break
        } catch (error) {
          /** Only an explicit size rejection proves this text was not delivered. */
          if (
            !(error instanceof SlackDeliveryError) ||
            error.method !== (message ? 'chat.appendStream' : 'chat.startStream') ||
            error.outcome !== 'rejected' ||
            error.code !== 'msg_too_long'
          ) {
            throw error
          }
          if (message && message.textLength > 0) {
            message.textComplete = true
            message = undefined
            end = textChunkEnd(text, offset, SLACK_MESSAGE_TEXT_LIMIT, true)
          } else {
            /** A rejected first write shrinks on each attempt, stopping at one code point. */
            const smallerEnd = textChunkEnd(text, offset, Math.floor((end - offset) / 2), true)
            if (smallerEnd <= offset) throw error
            end = smallerEnd
          }
        }
      }
    }
  }

  private async flushAnswer(force: boolean): Promise<void> {
    if (
      this.failure ||
      !this.answerBuffer ||
      (!force && this.acknowledgedAnswer && this.answerBuffer.length < TEXT_FLUSH_SIZE)
    )
      return
    let end = this.answerBuffer.length
    if (!force) {
      end = 0
      for (const match of this.answerBuffer.matchAll(/\s/g)) end = match.index + 1
      if (!end && this.answerBuffer.length < SLACK_MESSAGE_TEXT_LIMIT) return
      if (!end) end = this.answerBuffer.length
    }
    const projected = await this.projectLiveText(this.answerBuffer.slice(0, end))
    if (projected === null) return
    await this.appendAnswerText(projected)
    this.answerBuffer = this.answerBuffer.slice(end)
  }

  private async appendAnswer(text: string): Promise<void> {
    if (this.failure) return
    this.answerBuffer += text
    await this.flushAnswer(false)
  }

  private async flushThinking(): Promise<void> {
    if (this.failure || !this.config.includeThinking || !this.thinking) return
    const projected = await this.projectLiveText(this.thinking)
    if (projected === null) return
    if (projected) {
      await this.append([
        {
          type: 'task_update',
          id: `${this.taskId}-thinking`,
          title: 'Thinking',
          status: 'complete',
          details: truncate(projected, TASK_TEXT_LIMIT),
        },
      ])
    }
    this.thinking = ''
  }

  onEvent(event: AgentStreamEvent): Promise<void> {
    return this.enqueue(async () => {
      switch (event.type) {
        case 'text_delta':
          if (event.turn !== 'intermediate') await this.appendAnswer(event.text)
          return
        case 'turn_end':
          await this.flushThinking()
          await this.flushAnswer(true)
          if (event.turn === 'intermediate' && !this.failure) {
            this.acknowledgedAnswer = ''
            this.answerBuffer = ''
          }
          return
        case 'thinking_delta':
          if (this.config.includeThinking) this.thinking += event.text
          return
        case 'tool_call_start': {
          await this.flushAnswer(true)
          await this.flushThinking()
          if (!this.config.includeToolCalls || this.failure || this.tools.has(event.id)) return
          const message = await this.ensureStarted()
          const tool = { name: event.name, status: 'in_progress' as const, message }
          this.tools.set(event.id, { ...tool, status: 'pending' })
          await this.append([this.toolChunk(event.id, tool)], message)
          this.tools.set(event.id, tool)
          return
        }
        case 'tool_call_end': {
          const previous = this.tools.get(event.id)
          if (!this.config.includeToolCalls || this.failure || previous?.status !== 'in_progress')
            return
          const tool = {
            name: previous.name,
            status: event.status === 'success' ? ('complete' as const) : ('error' as const),
            message: previous.message,
          }
          await this.append([this.toolChunk(event.id, tool)], tool.message)
          this.tools.set(event.id, tool)
          return
        }
      }
    })
  }

  private toolChunk(
    id: string,
    tool: { name: string; status: 'in_progress' | 'complete' | 'error' }
  ): SlackStreamChunk {
    return {
      type: 'task_update',
      id: `${this.taskId}-tool-${id}`,
      title: truncate(getToolDisplayTitle(tool.name), TASK_TEXT_LIMIT),
      status: tool.status,
    }
  }

  appendProjectedBytes(text: string): Promise<void> {
    return this.enqueue(() => this.appendAnswer(text))
  }

  drain(): Promise<void> {
    return this.enqueue(async () => {
      await this.flushThinking()
      await this.flushAnswer(true)
    })
  }

  /** The settled output is an explicit snapshot; never infer snapshots from live delta prefixes. */
  reconcileSettledOutput(text: string): Promise<void> {
    return this.enqueue(async () => {
      if (this.failure || this.stopAttempted) return
      if (!text.startsWith(this.acknowledgedAnswer)) {
        throw new Error('Slack delivery failed: settled output differs from acknowledged answer')
      }
      const remaining = text.slice(this.acknowledgedAnswer.length)
      await this.appendAnswerText(remaining)
      this.answerBuffer = ''
    })
  }

  recordFailure(error: unknown): void {
    this.failure ??= formatSlackApiFailure(error)
  }

  finish(success: boolean): Promise<void> {
    return this.enqueue(async () => {
      if (this.stopAttempted) return
      if (this.messages.length === 0) {
        if (this.failure || !success) return
        await this.ensureStarted()
      }
      if (
        success &&
        [...this.tools.values()].some(
          (tool) => tool.status === 'pending' || tool.status === 'in_progress'
        )
      ) {
        this.failure ??= new Error('Slack delivery ended with unfinished tool calls')
      }
      this.stopAttempted = true
      for (const message of this.messages) {
        const failed = Boolean(this.failure) || !success
        const chunks: SlackStreamChunk[] = [...this.tools].flatMap(([id, tool]) =>
          tool.message === message && (tool.status === 'pending' || tool.status === 'in_progress')
            ? [this.toolChunk(id, { ...tool, status: 'error' })]
            : []
        )
        if (message.taskId) {
          chunks.push({
            type: 'task_update',
            id: message.taskId,
            title: this.title,
            status: failed ? 'error' : 'complete',
          })
        }
        try {
          /** Cleanup has its own deadline and attempts every part even if an earlier stop failed. */
          await stopSlackAgentStream(
            this.token,
            message.channel,
            message.ts,
            failed ? 'suspended' : 'processing',
            undefined,
            undefined,
            chunks
          )
          message.stopped = true
        } catch (error) {
          this.recordFailure(error)
        }
      }
    })
  }

  assertSucceeded(): void {
    if (this.failure) throw this.failure
    if (this.messages.some((message) => !message.stopped)) {
      throw new Error('Slack response stream was not stopped')
    }
  }
}

export class SlackExecutionStreamController {
  readonly selectedOutputs: string[]
  readonly callbacks: ExecutionCallbacks

  private failure?: Error
  private readonly target: SlackReplyTarget
  private readonly token: string
  private readonly invocations = new Map<string, SlackInvocationStream>()
  private finalization?: Promise<void>
  private finalized = false

  private constructor(
    private readonly options: SlackExecutionStreamControllerOptions,
    token: string,
    target: SlackReplyTarget
  ) {
    this.token = token
    this.target = target
    this.selectedOutputs = options.config.outputConfigs.map((output) =>
      formatOutputSelector(output.blockId, output.path, output.workflowId)
    )
    this.callbacks = {
      onStream: (stream) => this.onStream(stream),
      onBlockComplete: (blockId, _blockName, _blockType, data) =>
        this.onBlockComplete(blockId, data),
    }
  }

  static async create(
    options: SlackExecutionStreamControllerOptions
  ): Promise<SlackExecutionStreamController> {
    const credential = await getSlackBotCredential(options.credentialId)
    if (!credential || credential.workspaceId !== options.workspaceId) {
      throw new Error('Slack streaming credential is unavailable in this workspace')
    }
    const target = resolveSlackReplyTarget(options.triggerInput)
    const controller = new SlackExecutionStreamController(options, credential.botToken, target)
    await registerSlackStreamSession(options.credentialId, target, {
      executionId: options.executionId,
      workflowId: options.workflowId,
      userId: options.userId,
      workspaceId: options.workspaceId,
    })
    try {
      await setSlackAgentSessionStatus(
        credential.botToken,
        target,
        'processing',
        options.abortSignal
      )
    } catch (error) {
      await unregisterSlackStreamSession(options.credentialId, target, options.executionId)
      throw error
    }
    return controller
  }

  private selectedForBlock(blockId: string): SlackStreamOutputConfig[] {
    return this.options.config.outputConfigs.filter((output) => {
      const selectedBlockId = output.workflowId
        ? scopeOutputBlockId(output.workflowId, output.blockId)
        : output.blockId
      return selectedBlockId === blockId
    })
  }

  private invocationKey(
    blockId: string,
    executionOrder: number,
    childWorkflowInstanceId?: string
  ): string {
    return `${blockId}:${childWorkflowInstanceId ?? executionOrder}`
  }

  private taskId(executionOrder: number, childWorkflowInstanceId?: string): string {
    return `sim-${this.options.executionId}-${childWorkflowInstanceId ?? executionOrder}`
  }

  private recordFailure(error: unknown): Error {
    const failure = formatSlackApiFailure(error)
    this.failure ??= failure
    return failure
  }

  private async projectLiveText(
    text: string,
    provenance: StreamingExecution['displayResolvedSecretTraceProvenance']
  ): Promise<string | null> {
    const display = await this.options.loggingSession.projectLiveDisplayText(
      'chunk',
      text,
      provenance
    )
    return typeof display.chunk === 'string' ? display.chunk : null
  }

  private async onStream(stream: StreamingExecution): Promise<void> {
    try {
      if (!stream.blockId || stream.executionOrder === undefined) {
        throw new Error('Slack streaming received a stream without invocation metadata')
      }
      if (this.selectedForBlock(stream.blockId).length === 0) {
        throw new Error(`Slack streaming received an unselected block: ${stream.blockId}`)
      }
      const key = this.invocationKey(
        stream.blockId,
        stream.executionOrder,
        stream.childWorkflowInstanceId
      )
      if (this.invocations.has(key)) {
        throw new Error(`Duplicate Slack stream invocation: ${key}`)
      }
      const invocation = new SlackInvocationStream(
        this.token,
        this.target,
        this.options.config,
        this.taskId(stream.executionOrder, stream.childWorkflowInstanceId),
        this.options.config.taskTitle,
        (text) => this.projectLiveText(text, stream.displayResolvedSecretTraceProvenance),
        this.options.abortSignal
      )
      this.invocations.set(key, invocation)

      const answerFromEventSink = Boolean(stream.subscribe) && !stream.clientStreamTransformed
      const unsubscribe = stream.subscribe?.({
        onEvent: async (event) => {
          if (!answerFromEventSink && event.type === 'text_delta') return
          await invocation.onEvent(event)
        },
      })
      const reader = stream.stream.getReader()
      const decoder = new TextDecoder()
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          if (!answerFromEventSink) {
            await invocation.appendProjectedBytes(decoder.decode(value, { stream: true }))
          }
        }
        if (!answerFromEventSink) {
          const remainder = decoder.decode()
          if (remainder) await invocation.appendProjectedBytes(remainder)
        }
        await invocation.drain()
      } catch (error) {
        invocation.recordFailure(error)
        throw error
      } finally {
        unsubscribe?.()
        reader.releaseLock()
      }
    } catch (error) {
      throw this.recordFailure(error)
    }
  }

  private async onBlockComplete(blockId: string, data: BlockCompletionCallbackData): Promise<void> {
    try {
      const selectedOutputBlockId = data.outputBlockId ?? blockId
      const selected = this.selectedForBlock(selectedOutputBlockId)
      if (selected.length === 0) return
      const key = this.invocationKey(
        selectedOutputBlockId,
        data.executionOrder,
        data.childWorkflowInstanceId
      )

      const display = await this.options.loggingSession.projectDisplayContent(
        { output: data.output },
        data.displayResolvedSecretTraceProvenance
      )
      if (!Object.hasOwn(display, 'output')) return
      const values = selected.flatMap((selection) => {
        const value = getValueAtPath(display.output, selection.path)
        return value === undefined ? [] : [{ path: selection.path, value }]
      })
      if (values.length === 0) return
      const text =
        values.length === 1
          ? formatOutput(values[0].value)
          : values.map(({ path, value }) => `*${path}*\n${formatOutput(value)}`).join('\n\n')
      const invocation =
        this.invocations.get(key) ??
        new SlackInvocationStream(
          this.token,
          this.target,
          this.options.config,
          this.taskId(data.executionOrder, data.childWorkflowInstanceId),
          this.options.config.taskTitle,
          async (value) => value,
          this.options.abortSignal
        )
      this.invocations.set(key, invocation)
      await invocation.reconcileSettledOutput(text)
    } catch (error) {
      this.recordFailure(error)
    }
  }

  finalize(result: ExecutionResult): Promise<void> {
    this.finalization ??= this.finalizeOnce(result)
    return this.finalization
  }

  private async finalizeOnce(result: ExecutionResult): Promise<void> {
    for (const invocation of this.invocations.values()) {
      await invocation.finish(
        !this.failure &&
          result.success &&
          result.status !== 'cancelled' &&
          result.status !== 'paused'
      )
      try {
        invocation.assertSucceeded()
      } catch (error) {
        this.recordFailure(error)
      }
    }
    const status =
      !this.failure &&
      (result.status === 'cancelled' || (result.success && result.status !== 'paused'))
        ? 'active'
        : 'suspended'
    try {
      await setSlackAgentSessionStatus(this.token, this.target, status)
    } catch (error) {
      this.recordFailure(error)
    }
    try {
      await unregisterSlackStreamSession(
        this.options.credentialId,
        this.target,
        this.options.executionId
      )
    } catch (error) {
      this.recordFailure(error)
    }
    this.finalized = true
  }

  assertSucceeded(): void {
    if (this.failure) throw this.failure
    if (!this.finalized) throw new Error('Slack delivery has not been finalized')
  }
}
