import { createLogger } from '@sim/logger'
import { getValueAtPath, isRecordLike } from '@sim/utils/object'
import { truncate } from '@sim/utils/string'
import type { LoggingSession } from '@/lib/logs/execution/logging-session'
import { parseMcpToolTarget } from '@/lib/mcp/utils'
import { getToolDisplayTitle } from '@/lib/mothership/tools/display'
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
import {
  SLACK_TIMELINE_SOURCE_PATH,
  type SlackStreamBlockRef,
  type SlackStreamResponseConfig,
} from '@/lib/webhooks/slack-stream-config'
import {
  registerSlackStreamSession,
  type SlackStreamSessionTarget,
  unregisterSlackStreamSession,
} from '@/lib/webhooks/slack-stream-sessions'
import { formatOutputSelector, scopeOutputBlockId } from '@/lib/workflows/streaming/output-selector'
import { isMcpTool } from '@/executor/constants'
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
  /** Settles after this message's latest append, so writers sharing it append in order. */
  writes: Promise<void>
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

/** An MCP tool's label may be keyed by its own name rather than the server-scoped one. */
function mcpToolName(name: string): string | undefined {
  if (!isMcpTool(name)) return undefined
  try {
    return parseMcpToolTarget(name).toolName
  } catch {
    return undefined
  }
}

function toolTitle(name: string, labels: Record<string, string>): string {
  const ownName = Object.hasOwn(labels, name) ? name : mcpToolName(name)
  const label = ownName !== undefined && Object.hasOwn(labels, ownName) ? labels[ownName] : ''
  return truncate(label || getToolDisplayTitle(name), TASK_TEXT_LIMIT)
}

/** Matches a configured block against the scoped block ID the executor reports. */
function isBlock(blockId: string): (ref: SlackStreamBlockRef) => boolean {
  return (ref) =>
    (ref.workflowId ? scopeOutputBlockId(ref.workflowId, ref.blockId) : ref.blockId) === blockId
}

function markdownLength(chunks: SlackStreamChunk[]): number {
  return chunks.reduce(
    (length, chunk) => length + (chunk.type === 'markdown_text' ? chunk.text.length : 0),
    0
  )
}

async function openSlackMessage(
  token: string,
  target: SlackReplyTarget,
  config: SlackStreamResponseConfig,
  chunks: SlackStreamChunk[],
  taskId: string | undefined,
  signal?: AbortSignal
): Promise<SlackMessageStream> {
  const started = await startSlackAgentStream(token, target, chunks, config.taskDisplayMode, signal)
  return {
    ...started,
    taskId,
    textLength: markdownLength(chunks),
    textComplete: false,
    stopped: false,
    writes: Promise.resolve(),
  }
}

/** Stops one message, settling its task. Cleanup has its own deadline, so no abort signal. */
async function stopMessage(
  token: string,
  message: SlackMessageStream,
  title: string,
  failed: boolean,
  chunks: SlackStreamChunk[]
): Promise<void> {
  await stopSlackAgentStream(
    token,
    message.channel,
    message.ts,
    failed ? 'suspended' : 'processing',
    undefined,
    undefined,
    message.taskId
      ? [
          ...chunks,
          { type: 'task_update', id: message.taskId, title, status: failed ? 'error' : 'complete' },
        ]
      : chunks
  )
  message.stopped = true
}

/**
 * The first message of an execution, owned and stopped by the controller. Timeline sources write
 * their steps into it and the first answer invocation writes its text there too, so steps and
 * answer read as one reply. A later answer starts its own message so two answers never interleave.
 */
interface SharedMessage {
  message: Promise<SlackMessageStream>
  hasAnswer: boolean
  /** Only these invocations' outcomes decide how the shared message settles. */
  writers: Set<SlackInvocationStream>
}

/** Returns the shared message, or undefined when another answer already writes to it. */
type AcquireSharedMessage = (
  writer: SlackInvocationStream,
  forAnswer: boolean,
  start: () => Promise<SlackMessageStream>
) => Promise<SlackMessageStream> | undefined

function formatOutput(value: unknown): string {
  if (typeof value === 'string') return value
  const serialized = JSON.stringify(value, null, 2)
  if (serialized === undefined) throw new Error('Selected Slack stream output is not serializable')
  return serialized
}

class SlackInvocationStream {
  /** Every message this invocation writes to. */
  private readonly messages: SlackMessageStream[] = []
  /** The messages this invocation started, and so stops. */
  private readonly ownedMessages = new Set<SlackMessageStream>()
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
    private readonly projectLiveText: (text: string) => Promise<string | null>,
    private readonly acquireSharedMessage: AcquireSharedMessage,
    /** Shows tool steps and thinking only; the source's text never reaches Slack. */
    private readonly timelineOnly: boolean,
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
    const start = () =>
      openSlackMessage(
        this.token,
        this.target,
        this.config,
        [
          {
            type: 'task_update',
            id: this.taskId,
            title: this.config.taskTitle,
            status: 'in_progress',
          },
        ],
        this.taskId,
        this.signal
      )
    const shared = this.acquireSharedMessage(this, !this.timelineOnly, start)
    const message = shared ? await shared : await start()
    if (!shared) this.ownedMessages.add(message)
    this.messages.push(message)
    return message
  }

  private async startMessage(chunks: SlackStreamChunk[]): Promise<SlackMessageStream> {
    const message = await openSlackMessage(
      this.token,
      this.target,
      this.config,
      chunks,
      undefined,
      this.signal
    )
    this.ownedMessages.add(message)
    this.messages.push(message)
    return message
  }

  private async append(chunks: SlackStreamChunk[], message?: SlackMessageStream): Promise<void> {
    const target = message ?? (await this.ensureStarted())
    const textLength = markdownLength(chunks)
    try {
      const write = target.writes.then(() =>
        appendSlackAgentStream(this.token, target.channel, target.ts, chunks, this.signal)
      )
      target.writes = write.catch(() => {})
      await write
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
      title: toolTitle(tool.name, this.config.toolLabels),
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

  get failed(): boolean {
    return Boolean(this.failure)
  }

  /** Error steps for this invocation's tools still running on `message`. */
  unfinishedToolChunks(message: SlackMessageStream): SlackStreamChunk[] {
    return [...this.tools].flatMap(([id, tool]) =>
      tool.message === message && (tool.status === 'pending' || tool.status === 'in_progress')
        ? [this.toolChunk(id, { ...tool, status: 'error' })]
        : []
    )
  }

  /** Readies this response to stop: a successful empty answer still shows its settled task. */
  settle(success: boolean): Promise<void> {
    return this.enqueue(async () => {
      if (this.stopAttempted) return
      if (this.messages.length === 0) {
        if (this.failure || !success || this.timelineOnly) return
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
    })
  }

  /** Stops the messages this invocation started; the controller stops the shared one. */
  stop(success: boolean): Promise<void> {
    return this.enqueue(async () => {
      if (this.stopAttempted) return
      this.stopAttempted = true
      for (const message of this.ownedMessages) {
        try {
          await stopMessage(
            this.token,
            message,
            this.config.taskTitle,
            Boolean(this.failure) || !success,
            this.unfinishedToolChunks(message)
          )
        } catch (error) {
          this.recordFailure(error)
        }
      }
    })
  }

  assertSucceeded(): void {
    if (this.failure) throw this.failure
    if ([...this.ownedMessages].some((message) => !message.stopped)) {
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
  private sharedMessage?: SharedMessage
  private finalization?: Promise<void>
  private finalized = false

  private constructor(
    private readonly options: SlackExecutionStreamControllerOptions,
    token: string,
    target: SlackReplyTarget
  ) {
    this.token = token
    this.target = target
    this.selectedOutputs = [
      ...options.config.outputConfigs.map((output) =>
        formatOutputSelector(output.blockId, output.path, output.workflowId)
      ),
      ...options.config.timelineSources.map((source) =>
        formatOutputSelector(source.blockId, SLACK_TIMELINE_SOURCE_PATH, source.workflowId)
      ),
    ]
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

  private readonly acquireSharedMessage: AcquireSharedMessage = (writer, forAnswer, start) => {
    if (!this.sharedMessage) {
      this.sharedMessage = { message: start(), hasAnswer: forAnswer, writers: new Set([writer]) }
      return this.sharedMessage.message
    }
    if (forAnswer) {
      if (this.sharedMessage.hasAnswer) return undefined
      this.sharedMessage.hasAnswer = true
    }
    this.sharedMessage.writers.add(writer)
    return this.sharedMessage.message
  }

  private createInvocation(
    executionOrder: number,
    childWorkflowInstanceId: string | undefined,
    projectLiveText: (text: string) => Promise<string | null>,
    timelineOnly: boolean
  ): SlackInvocationStream {
    return new SlackInvocationStream(
      this.token,
      this.target,
      this.options.config,
      this.taskId(executionOrder, childWorkflowInstanceId),
      projectLiveText,
      this.acquireSharedMessage,
      timelineOnly,
      this.options.abortSignal
    )
  }

  private invocationKey(
    blockId: string,
    executionOrder: number,
    childWorkflowInstanceId?: string
  ): string {
    return `${blockId}:${childWorkflowInstanceId ?? executionOrder}`
  }

  /** Unique per invocation: blocks of one child workflow instance share the shared message. */
  private taskId(executionOrder: number, childWorkflowInstanceId?: string): string {
    const invocation = childWorkflowInstanceId
      ? `${childWorkflowInstanceId}-${executionOrder}`
      : executionOrder
    return `sim-${this.options.executionId}-${invocation}`
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
      const { outputConfigs, timelineSources } = this.options.config
      const timelineOnly = !outputConfigs.some(isBlock(stream.blockId))
      if (timelineOnly && !timelineSources.some(isBlock(stream.blockId))) {
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
      const invocation = this.createInvocation(
        stream.executionOrder,
        stream.childWorkflowInstanceId,
        (text) => this.projectLiveText(text, stream.displayResolvedSecretTraceProvenance),
        timelineOnly
      )
      this.invocations.set(key, invocation)

      // A timeline source's text is drained for the executor but never read into Slack.
      const answerFromEventSink =
        !timelineOnly && Boolean(stream.subscribe) && !stream.clientStreamTransformed
      const answerFromBytes = !timelineOnly && !answerFromEventSink
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
          if (answerFromBytes) {
            await invocation.appendProjectedBytes(decoder.decode(value, { stream: true }))
          }
        }
        if (answerFromBytes) {
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
      const selected = this.options.config.outputConfigs.filter(isBlock(selectedOutputBlockId))
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
        this.createInvocation(
          data.executionOrder,
          data.childWorkflowInstanceId,
          async (value) => value,
          false
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
    const succeeded = () =>
      !this.failure && result.success && result.status !== 'cancelled' && result.status !== 'paused'
    const invocations = [...this.invocations.values()]
    // An invocation succeeds only if every one before it did, as when each settled in turn.
    const successes = new Map<SlackInvocationStream, boolean>()
    let earlierFailed = false
    for (const invocation of invocations) {
      const success = succeeded() && !earlierFailed
      successes.set(invocation, success)
      await invocation.settle(success)
      earlierFailed ||= invocation.failed
    }
    // The shared message is the reply's first, so it settles before any continuation.
    await this.stopSharedMessage(invocations, successes)
    for (const invocation of invocations) {
      await invocation.stop(successes.get(invocation) === true)
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

  private async stopSharedMessage(
    invocations: SlackInvocationStream[],
    successes: ReadonlyMap<SlackInvocationStream, boolean>
  ): Promise<void> {
    if (!this.sharedMessage) return
    try {
      const message = await this.sharedMessage.message
      await stopMessage(
        this.token,
        message,
        this.options.config.taskTitle,
        [...this.sharedMessage.writers].some(
          (writer) => writer.failed || successes.get(writer) !== true
        ),
        invocations.flatMap((invocation) => invocation.unfinishedToolChunks(message))
      )
    } catch (error) {
      this.recordFailure(error)
    }
  }

  assertSucceeded(): void {
    if (this.failure) throw this.failure
    if (!this.finalized) throw new Error('Slack delivery has not been finalized')
  }
}
