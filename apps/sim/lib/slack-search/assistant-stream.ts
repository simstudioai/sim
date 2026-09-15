import { toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { truncate } from '@sim/utils/string'
import {
  parseSearchConnectionTargets,
  type SearchConnectionTarget,
} from '@/lib/knowledge/search/connection-target'
import {
  collectRetrievalCitationEvidence,
  parseCitationRecord,
  type RetrievalCitationBlock,
} from '@/lib/mothership/chat/citation-evidence'
import { redactSensitiveContent } from '@/lib/mothership/chat/sim-key-redaction'
import type {
  StreamEvent,
  ToolCallStreamEvent,
  ToolResultStreamEvent,
} from '@/lib/mothership/request/session/contract'
import type { OrchestratorResult } from '@/lib/mothership/request/types'
import { SLACK_SEARCH_FAILED_ANSWER } from '@/lib/slack-search/constants'
import {
  appendSlackAgentStream,
  type SlackStreamChunk,
  setSlackAgentSessionStatus,
  startSlackAgentStream,
  stopSlackAgentStream,
} from '@/lib/webhooks/slack-agent-api'
import { projectResolvedSecretDiagnosticContent } from '@/executor/utils/resolved-secret-content-projection'
import type { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

/** Resolves inline citations while withholding incomplete tags and unverified destinations. */
export function publicSlackAnswer(
  text: string,
  complete: boolean,
  sources: ReadonlyMap<string, string> = new Map()
): string {
  let value = text.replace(
    /<(options|question|thinking|usage_upgrade|credential|workspace_resource)>[\s\S]*?(?:<\/\1>|$)/g,
    ''
  )
  if (!complete) {
    let end = Math.max(value.lastIndexOf(' '), value.lastIndexOf('\n')) + 1
    const sourceStart = value.lastIndexOf('<')
    if (sourceStart > value.lastIndexOf('>')) end = Math.min(end, sourceStart)
    const linkStart = value.lastIndexOf('[')
    if (linkStart > value.lastIndexOf(')')) end = Math.min(end, linkStart)
    value = value.slice(0, end)
  }
  let answer = ''
  let offset = 0
  for (const match of value.matchAll(/<source>([\s\S]*?)(<\/source>|$)/g)) {
    answer += publicSlackText(value.slice(offset, match.index))
    const source = match[2] ? parseCitationRecord(match[1]) : null
    const id = typeof source?.id === 'string' ? source.id : undefined
    /** A result may arrive after its citation; keep subsequent text pending until it resolves. */
    if (!complete && (!match[2] || (id !== undefined && !sources.has(id)))) return answer
    const link = id === undefined ? undefined : sources.get(id)
    if (link) answer += `${answer && !/\s$/.test(answer) ? ' ' : ''}${link}`
    offset = match.index + match[0].length
  }
  return answer + publicSlackText(value.slice(offset))
}

function publicSlackText(value: string): string {
  return value
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]*(?:>|$)/g, '')
    .replace(/(?:https?:\/\/|www\.)[^\s<>]+/gi, '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function sourceLink(source: Record<string, unknown>): string {
  if (typeof source.url !== 'string' || source.url.length > 3000) return ''
  const url = new URL(source.url)
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.href.length > 3000
  )
    return ''
  const title = typeof source.title === 'string' ? source.title.replace(/\s+/g, ' ').trim() : ''
  const label = truncate(title || 'Source', 60)
    .replace(/[\\`*_[\]~!]/g, '\\$&')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
  return `[${label}](<${url.href.replaceAll('>', '%3E')}>)`
}

interface AssistantStreamOptions {
  token: string
  channel: string
  threadTs: string
  slackUserId: string
  controller: AbortController
  registry: ResolvedSecretTraceRegistry
  beforeDelivery: () => Promise<void>
  beforeCleanup: (signal: AbortSignal) => Promise<void>
  deliverConnections?: (targets: SearchConnectionTarget[]) => Promise<void>
}

const FAILURE_BLOCKS: Record<string, unknown>[] = [
  { type: 'section', text: { type: 'plain_text', text: SLACK_SEARCH_FAILED_ANSWER } },
]

const TOOL_PROGRESS_TITLES = new Map([
  ['search_workspace', 'Searching documents…'],
  ['read_document', 'Reading documents…'],
])

type ToolProgress = Extract<SlackStreamChunk, { type: 'task_update' }>

/** Serial delivery through the same provider primitives as Slack blocks; ambiguous sends are terminal. */
export class SlackSearchAssistantStream {
  private stream?: { channel: string; ts: string }
  private sessionStarted = false
  private streamStartAttempted = false
  private leadingChunks: SlackStreamChunk[] = []
  private text = ''
  /** Safe text already delivered or buffered ahead of the first visible chunk. */
  private sent = ''
  private lastSentAt = 0
  private failure?: Error
  private closed = false
  private closeAttempted = false
  private cleanupAttempted = false
  private pendingEvents: Promise<void> = Promise.resolve()
  private evidence = new Map<string, Record<string, unknown>>()
  private toolProgress = new Map<string, { toolName: string; chunk: ToolProgress }>()
  private pendingProgress: { textEnd: number; chunk: ToolProgress }[] = []
  private deliveredProgress = new Map<string, ToolProgress>()
  constructor(private readonly options: AssistantStreamOptions) {}

  private async deliver(action: () => Promise<void>) {
    if (this.failure) throw this.failure
    try {
      this.options.controller.signal.throwIfAborted()
      await this.options.beforeDelivery()
      await action()
    } catch (error) {
      this.failure = toError(error)
      this.options.controller.abort(this.failure)
      throw this.failure
    }
  }

  async start() {
    const { token, channel, threadTs, slackUserId, controller } = this.options
    await this.deliver(async () => {
      await setSlackAgentSessionStatus(
        token,
        { channel, threadTs, initiatorUserId: slackUserId },
        'processing',
        controller.signal
      )
      this.sessionStarted = true
    })
  }

  onEvent(event: StreamEvent): Promise<void> {
    this.pendingEvents = this.pendingEvents.then(() => this.handleEvent(event))
    return this.pendingEvents
  }

  private async handleEvent(event: StreamEvent) {
    if (this.failure) throw this.failure
    this.options.controller.signal.throwIfAborted()
    if (event.type === 'tool' && 'phase' in event.payload && event.payload.phase === 'result') {
      const { toolName, success, status, output } = event.payload
      this.collectSources([
        {
          toolCall: {
            name: toolName,
            status: status ?? (success ? 'success' : 'error'),
            result: { success, output },
          },
        },
      ])
    }
    if (event.type === 'tool' && !event.scope) {
      if (
        'phase' in event.payload &&
        (event.payload.phase === 'call' || event.payload.phase === 'result')
      ) {
        this.queueToolProgress(event.payload)
      }
    }
    if (event.type === 'tool' && this.pendingProgress.length) await this.flush(false)
    if (event.type !== 'text' || event.payload.channel !== 'assistant' || event.scope) return
    this.text += event.payload.text
    if (this.text.length > 128_000) throw new Error('Slack answer exceeds the supported size')
    if (!this.stream || Date.now() - this.lastSentAt >= 750) await this.flush(false)
  }

  /** Only static labels reach Slack; arguments, account details, and backend errors stay private. */
  private queueToolProgress(
    payload: ToolCallStreamEvent['payload'] | ToolResultStreamEvent['payload']
  ) {
    const title = TOOL_PROGRESS_TITLES.get(payload.toolName)
    if (!title) return
    const existing = this.toolProgress.get(payload.toolCallId)
    let chunk: ToolProgress
    if (payload.phase === 'call') {
      if (
        existing ||
        payload.partial ||
        payload.ui?.hidden ||
        payload.ui?.internal ||
        (payload.status !== undefined && payload.status !== 'executing')
      )
        return
      /** Close the preceding text segment so batching cannot place its tail after the task. */
      if (this.text && !this.text.endsWith('\n\n')) this.text += '\n\n'
      chunk = { type: 'task_update', id: generateId(), title, status: 'in_progress' }
    } else {
      if (!existing || existing.chunk.status !== 'in_progress') return
      if (existing.toolName !== payload.toolName)
        throw new Error('Slack tool progress identity changed')
      chunk = {
        ...existing.chunk,
        status:
          payload.success && (!payload.status || payload.status === 'success')
            ? 'complete'
            : 'error',
      }
    }
    this.toolProgress.set(payload.toolCallId, { toolName: payload.toolName, chunk })
    /** Updating an existing task does not introduce a new position in Slack's timeline. */
    this.pendingProgress.push({ textEnd: payload.phase === 'call' ? this.text.length : 0, chunk })
  }

  /** Finalize interrupted tasks in the single stop request, including ambiguous progress sends. */
  private interruptedToolProgress(): ToolProgress[] {
    return [...this.deliveredProgress.values()]
      .filter((chunk) => chunk.status === 'in_progress')
      .map((chunk) => ({ ...chunk, status: 'error' }))
  }

  private collectSources(blocks: readonly RetrievalCitationBlock[]) {
    for (const [id, source] of collectRetrievalCitationEvidence(blocks)) {
      if (!this.evidence.has(id)) this.evidence.set(id, source)
    }
  }

  private async flush(complete: boolean) {
    const { registry } = this.options
    if (!registry.isComplete()) throw new Error('Answer secret provenance is unavailable')
    /** Active secret literals can straddle deltas; project their complete answer instead. */
    if (!complete && registry.getActiveMatches().length) return
    const sources = new Map<string, string>()
    for (const [id, source] of this.evidence) {
      const projected = projectResolvedSecretDiagnosticContent(source, registry)
      sources.set(
        id,
        projected.safe && JSON.stringify(projected.value) === JSON.stringify(source)
          ? sourceLink(source)
          : ''
      )
    }
    const text = this.projectAnswer(this.text, complete, sources)
    if (!text.startsWith(this.sent)) throw new Error('The safe answer changed after delivery')
    while (this.pendingProgress.length) {
      const { textEnd, chunk } = this.pendingProgress[0]!
      const preceding = this.text.slice(0, textEnd)
      const prefix = this.projectAnswer(preceding, complete, sources)
      /** A prefix must remain safe when projected as part of the complete answer. */
      if (!text.startsWith(prefix)) throw new Error('The safe answer changed at a tool boundary')
      await this.appendText(prefix)
      /** Unresolved citations and partial markup must not let a task overtake withheld text. */
      if (!complete && prefix !== this.projectAnswer(preceding, true, sources)) return
      await this.deliver(async () => {
        /** Include an ambiguously started task in failure cleanup, but never an unsent task. */
        if (!this.deliveredProgress.has(chunk.id)) this.deliveredProgress.set(chunk.id, chunk)
        await this.writeChunk(chunk, this.options.controller.signal)
      })
      this.deliveredProgress.set(chunk.id, chunk)
      this.pendingProgress.shift()
    }
    await this.appendText(text)
  }

  private projectAnswer(text: string, complete: boolean, sources: ReadonlyMap<string, string>) {
    const projection = projectResolvedSecretDiagnosticContent(text, this.options.registry, 512_000)
    if (!projection.safe || typeof projection.value !== 'string')
      throw new Error('Answer could not be safely projected')
    return publicSlackAnswer(redactSensitiveContent(projection.value), complete, sources)
  }

  private async appendText(text: string) {
    if (this.sent.startsWith(text)) return
    if (!text.startsWith(this.sent)) throw new Error('The safe answer changed after delivery')
    const { controller } = this.options
    let pending = text.slice(this.sent.length)
    while (pending.length) {
      let end = Math.min(4000, pending.length)
      /** Keep each verified link in one append so Slack never briefly displays a partial URL. */
      for (const match of pending.matchAll(/\[(?:\\.|[^[\]\\])*\]\(<[^>]*>\)/g)) {
        if (match.index >= end) break
        if (match.index + match[0].length > end) {
          end = match.index
          break
        }
      }
      if (end === 0) throw new Error('Slack citation exceeds the supported chunk size')
      const chunk = pending.slice(0, end)
      await this.deliver(async () => {
        await this.writeChunk({ type: 'markdown_text', text: chunk }, controller.signal)
      })
      this.sent += chunk
      pending = pending.slice(chunk.length)
      if (this.stream) this.lastSentAt = Date.now()
    }
  }

  /** Start with visible content, preserving buffered whitespace and tool positions in that request. */
  private async writeChunk(chunk: SlackStreamChunk, signal: AbortSignal) {
    if (!this.sessionStarted || this.closed) throw new Error('Slack session is not active')
    const { token, channel, threadTs } = this.options
    if (this.stream) {
      await appendSlackAgentStream(token, this.stream.channel, this.stream.ts, [chunk], signal)
      return
    }
    if (this.streamStartAttempted) throw new Error('Slack stream start was not confirmed')
    if (chunk.type === 'markdown_text' && !chunk.text.trim()) {
      this.leadingChunks.push(chunk)
      return
    }
    this.streamStartAttempted = true
    this.stream = await startSlackAgentStream(
      token,
      { channel, threadTs },
      [...this.leadingChunks, chunk],
      'timeline',
      signal
    )
    this.leadingChunks = []
  }

  async finish(result: OrchestratorResult) {
    await this.pendingEvents
    if (this.failure) throw this.failure
    this.collectSources(result.contentBlocks)
    const projection = projectResolvedSecretDiagnosticContent(
      this.text,
      this.options.registry,
      512_000
    )
    if (!projection.safe || typeof projection.value !== 'string')
      throw new Error('Connection controls could not be safely projected')
    const targets = parseSearchConnectionTargets(redactSensitiveContent(projection.value))
    if (targets.length) {
      if (!this.options.deliverConnections)
        throw new Error('Search connection delivery is unavailable')
      await this.deliver(() => this.options.deliverConnections!(targets))
      this.text +=
        '\n\nUse the connection buttons in our DM, then reply here when you’re ready to continue.'
    }
    await this.flush(true)
    await this.deliver(() => this.close(false, this.options.controller.signal))
  }

  /** A confirmed Assistant failure is visible even if no answer stream has started. */
  async finishWithError() {
    await this.pendingEvents
    await this.deliver(() => this.close(true, this.options.controller.signal))
  }

  /** Settle once after abort, with fresh authority and no replay of ambiguous sends. */
  async terminateAfterFailure() {
    if (
      !this.sessionStarted ||
      this.closed ||
      this.cleanupAttempted ||
      (this.stream && this.closeAttempted)
    )
      return
    this.cleanupAttempted = true
    const signal = AbortSignal.timeout(5000)
    await this.options.beforeCleanup(signal)
    signal.throwIfAborted()
    if (this.closeAttempted) {
      /** Only the idempotent status reset can repeat; never replay an unconfirmed message send. */
      const { token, channel, threadTs } = this.options
      await setSlackAgentSessionStatus(token, { channel, threadTs }, 'active', signal)
      this.closed = true
      return
    }
    await this.close(true, signal)
  }

  private async close(failed: boolean, signal: AbortSignal) {
    if (!this.sessionStarted || this.closed || this.closeAttempted)
      throw new Error('Slack session is not active')
    const { token, channel, threadTs } = this.options
    let blocks = failed ? FAILURE_BLOCKS : []
    try {
      if (!this.stream && failed && !this.streamStartAttempted) {
        await this.writeChunk({ type: 'markdown_text', text: SLACK_SEARCH_FAILED_ANSWER }, signal)
        blocks = []
      }
    } finally {
      /** A failed notification must still settle the session, including during failure cleanup. */
      signal.throwIfAborted()
      this.closeAttempted = true
      if (this.stream) {
        await stopSlackAgentStream(
          token,
          this.stream.channel,
          this.stream.ts,
          'active',
          signal,
          blocks,
          this.interruptedToolProgress()
        )
      } else {
        /** Empty runs and unconfirmed starts still need to end the native loading state. */
        await setSlackAgentSessionStatus(token, { channel, threadTs }, 'active', signal)
      }
      this.closed = true
    }
  }

  assertHealthy() {
    if (this.failure) throw this.failure
  }
}
