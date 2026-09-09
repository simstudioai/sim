import { getErrorMessage } from '@sim/utils/errors'
import { getValueAtPath, isRecordLike } from '@sim/utils/object'
import { truncate } from '@sim/utils/string'
import { getToolDisplayTitle } from '@/lib/copilot/tools/tool-display'
import type { LoggingSession } from '@/lib/logs/execution/logging-session'
import { getSlackBotCredential } from '@/lib/oauth/credential-service'
import {
  appendSlackAgentStream,
  formatSlackApiFailure,
  type SlackStreamChunk,
  setSlackAgentSessionStatus,
  startSlackAgentStream,
  stopSlackAgentStream,
} from '@/lib/webhooks/slack-agent-api'
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
const SLACK_MARKDOWN_LIMIT = 12_000
const TASK_TEXT_LIMIT = 256

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

function splitMarkdown(text: string): SlackStreamChunk[] {
  const chunks: SlackStreamChunk[] = []
  for (let offset = 0; offset < text.length; offset += SLACK_MARKDOWN_LIMIT) {
    chunks.push({
      type: 'markdown_text',
      text: text.slice(offset, offset + SLACK_MARKDOWN_LIMIT),
    })
  }
  return chunks
}

function formatOutput(value: unknown): string {
  if (typeof value === 'string') return value
  const serialized = JSON.stringify(value, null, 2)
  if (serialized === undefined) throw new Error('Selected Slack stream output is not serializable')
  return serialized
}

class SlackInvocationStream {
  private channel?: string
  private ts?: string
  private answerBuffer = ''
  private fullAnswer = ''
  private thinking = ''
  private emittedAnswer = false
  private chain: Promise<void> = Promise.resolve()

  constructor(
    private readonly token: string,
    private readonly target: SlackReplyTarget,
    private readonly config: SlackStreamResponseConfig,
    private readonly taskId: string,
    private readonly title: string,
    private readonly projectLiveText: (text: string) => Promise<string | null>,
    private readonly projectFinalText: (text: string) => Promise<string | null>,
    private readonly signal?: AbortSignal
  ) {}

  private enqueue(operation: () => Promise<void>): Promise<void> {
    this.chain = this.chain.then(operation)
    return this.chain
  }

  private async ensureStarted(): Promise<void> {
    if (this.channel && this.ts) return
    const started = await startSlackAgentStream(
      this.token,
      this.target,
      [
        {
          type: 'task_update',
          id: this.taskId,
          title: this.title,
          status: 'in_progress',
        },
      ],
      this.config.taskDisplayMode,
      this.signal
    )
    this.channel = started.channel
    this.ts = started.ts
  }

  private async append(chunks: SlackStreamChunk[]): Promise<void> {
    await this.ensureStarted()
    await appendSlackAgentStream(this.token, this.channel!, this.ts!, chunks, this.signal)
  }

  private async flushAnswer(force: boolean): Promise<void> {
    if (!force && this.answerBuffer.length < TEXT_FLUSH_SIZE) return
    if (!this.answerBuffer) return
    const value = this.answerBuffer
    this.answerBuffer = ''
    const projected = await this.projectLiveText(value)
    if (!projected) return
    await this.append(splitMarkdown(projected))
    this.emittedAnswer = true
  }

  private async appendAnswer(text: string, force = false): Promise<void> {
    if (!text) return
    this.fullAnswer += text
    this.answerBuffer += text
    await this.flushAnswer(force || !this.emittedAnswer)
  }

  private async flushThinking(): Promise<void> {
    if (!this.config.includeThinking || !this.thinking) return
    const value = this.thinking
    this.thinking = ''
    const projected = await this.projectLiveText(value)
    if (!projected) return
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

  onEvent(event: AgentStreamEvent): Promise<void> {
    return this.enqueue(async () => {
      switch (event.type) {
        case 'text_delta':
          if (event.turn !== 'intermediate') {
            await this.appendAnswer(event.text)
          }
          return
        case 'turn_end':
          await this.flushThinking()
          await this.flushAnswer(true)
          return
        case 'thinking_delta':
          if (this.config.includeThinking) this.thinking += event.text
          return
        case 'tool_call_start':
          await this.flushThinking()
          if (this.config.includeToolCalls) {
            await this.append([
              {
                type: 'task_update',
                id: `${this.taskId}-tool-${event.id}`,
                title: truncate(getToolDisplayTitle(event.name), TASK_TEXT_LIMIT),
                status: 'in_progress',
              },
            ])
          }
          return
        case 'tool_call_end':
          if (this.config.includeToolCalls) {
            await this.append([
              {
                type: 'task_update',
                id: `${this.taskId}-tool-${event.id}`,
                title: truncate(getToolDisplayTitle(event.name), TASK_TEXT_LIMIT),
                status: event.status === 'success' ? 'complete' : 'error',
              },
            ])
          }
      }
    })
  }

  appendProjectedBytes(text: string): Promise<void> {
    return this.enqueue(() => this.appendAnswer(text))
  }

  complete(): Promise<void> {
    return this.enqueue(async () => {
      await this.flushThinking()
      await this.flushAnswer(true)
      if (!this.emittedAnswer && this.fullAnswer) {
        const projected = await this.projectFinalText(this.fullAnswer)
        if (projected) {
          await this.append(splitMarkdown(projected))
          this.emittedAnswer = true
        }
      }
      await this.append([
        {
          type: 'task_update',
          id: this.taskId,
          title: this.title,
          status: 'complete',
        },
      ])
      await stopSlackAgentStream(this.token, this.channel!, this.ts!, 'processing', this.signal)
    })
  }

  sendSettledOutput(text: string): Promise<void> {
    return this.enqueue(async () => {
      await this.ensureStarted()
      await this.append(splitMarkdown(text))
      await this.append([
        {
          type: 'task_update',
          id: this.taskId,
          title: this.title,
          status: 'complete',
        },
      ])
      await stopSlackAgentStream(this.token, this.channel!, this.ts!, 'processing', this.signal)
    })
  }
}

export class SlackExecutionStreamController {
  readonly selectedOutputs: string[]
  readonly callbacks: ExecutionCallbacks

  private failure?: Error
  private readonly target: SlackReplyTarget
  private readonly token: string
  private readonly invocations = new Map<string, SlackInvocationStream>()

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

  private async projectFinalText(
    text: string,
    provenance: StreamingExecution['displayResolvedSecretTraceProvenance']
  ): Promise<string | null> {
    const display = await this.options.loggingSession.projectDisplayContent({ text }, provenance)
    return typeof display.text === 'string' ? display.text : null
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
        (text) => this.projectFinalText(text, stream.displayResolvedSecretTraceProvenance),
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
        await invocation.complete()
      } finally {
        unsubscribe?.()
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
      if (this.invocations.has(key)) return

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
      const invocation = new SlackInvocationStream(
        this.token,
        this.target,
        this.options.config,
        this.taskId(data.executionOrder, data.childWorkflowInstanceId),
        this.options.config.taskTitle,
        async (value) => value,
        async (value) => value,
        this.options.abortSignal
      )
      this.invocations.set(key, invocation)
      await invocation.sendSettledOutput(text)
    } catch (error) {
      this.recordFailure(error)
    }
  }

  async finalize(result: ExecutionResult): Promise<void> {
    const status =
      result.status === 'cancelled' || (result.success && result.status !== 'paused')
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
  }

  assertSucceeded(): void {
    if (this.failure) {
      throw new Error(getErrorMessage(this.failure, 'Slack response streaming failed'))
    }
  }
}
