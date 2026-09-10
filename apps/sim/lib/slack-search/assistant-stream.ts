import { toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { truncate } from '@sim/utils/string'
import {
  collectRetrievalCitationEvidence,
  parseCitationRecord,
  type RetrievalCitationBlock,
} from '@/lib/copilot/chat/citation-evidence'
import { redactSensitiveContent } from '@/lib/copilot/chat/sim-key-redaction'
import type {
  StreamEvent,
  ToolCallStreamEvent,
  ToolResultStreamEvent,
} from '@/lib/copilot/request/session/contract'
import type { OrchestratorResult } from '@/lib/copilot/request/types'
import {
  parseSearchConnectionTargets,
  type SearchConnectionTarget,
} from '@/lib/knowledge/search/connection-target'
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
  ['list_integrations', 'Listing connected integrations…'],
  ['search_workspace', 'Searching documents…'],
  ['read_document', 'Reading documents…'],
])

type ToolProgress = Extract<SlackStreamChunk, { type: 'task_update' }>

/** Serial delivery through the same provider primitives as Slack blocks; ambiguous sends are terminal. */
export class SlackSearchAssistantStream {
  private stream?: { channel: string; ts: string }
  private text = ''
  private sent = ''
  private lastSentAt = 0
  private failure?: Error
  private closed = false
  private closeAttempted = false
  private separateNextText = false
  private evidence = new Map<string, Record<string, unknown>>()
  private toolProgress = new Map<string, { toolName: string; chunk: ToolProgress }>()
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
      this.stream = await startSlackAgentStream(
        token,
        { channel, threadTs },
        [],
        'timeline',
        controller.signal
      )
    })
  }

  async onEvent(event: StreamEvent) {
    if (this.failure) throw this.failure
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
      this.separateNextText = true
      if (
        'phase' in event.payload &&
        (event.payload.phase === 'call' || event.payload.phase === 'result')
      ) {
        await this.updateToolProgress(event.payload)
      }
    }
    if (event.type !== 'text' || event.payload.channel !== 'assistant' || event.scope) return
    if (this.separateNextText && this.text) this.text += '\n\n'
    this.separateNextText = false
    this.text += event.payload.text
    if (this.text.length > 128_000) throw new Error('Slack answer exceeds the supported size')
    if (Date.now() - this.lastSentAt >= 750) await this.flush(false)
  }

  /** Only static labels reach Slack; arguments, account details, and backend errors stay private. */
  private async updateToolProgress(
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
      chunk = { type: 'task_update', id: generateId(), title, status: 'in_progress' }
      this.toolProgress.set(payload.toolCallId, { toolName: payload.toolName, chunk })
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
    await this.deliver(async () => {
      if (!this.stream || this.closed) throw new Error('Slack stream is not active')
      await appendSlackAgentStream(
        this.options.token,
        this.stream.channel,
        this.stream.ts,
        [chunk],
        this.options.controller.signal
      )
    })
    this.toolProgress.set(payload.toolCallId, { toolName: payload.toolName, chunk })
  }

  /** Finalize interrupted tasks in the single stop request, including ambiguous progress sends. */
  private interruptedToolProgress(): ToolProgress[] {
    return [...this.toolProgress.values()]
      .filter(({ chunk }) => chunk.status === 'in_progress')
      .map(({ chunk }) => ({ ...chunk, status: 'error' }))
  }

  private collectSources(blocks: readonly RetrievalCitationBlock[]) {
    for (const [id, source] of collectRetrievalCitationEvidence(blocks)) {
      if (!this.evidence.has(id)) this.evidence.set(id, source)
    }
  }

  private async flush(complete: boolean) {
    const { registry, token, controller } = this.options
    if (!registry.isComplete()) throw new Error('Answer secret provenance is unavailable')
    /** Active secret literals can straddle deltas; project their complete answer instead. */
    if (!complete && registry.getActiveMatches().length) return
    const projection = projectResolvedSecretDiagnosticContent(this.text, registry, 512_000)
    if (!projection.safe || typeof projection.value !== 'string')
      throw new Error('Answer could not be safely projected')
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
    const text = publicSlackAnswer(redactSensitiveContent(projection.value), complete, sources)
    if (!text.startsWith(this.sent)) throw new Error('The safe answer changed after delivery')
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
        if (!this.stream || this.closed) throw new Error('Slack stream is not active')
        await appendSlackAgentStream(
          token,
          this.stream.channel,
          this.stream.ts,
          [{ type: 'markdown_text', text: chunk }],
          controller.signal
        )
      })
      this.sent += chunk
      pending = pending.slice(chunk.length)
      this.lastSentAt = Date.now()
    }
  }

  async finish(result: OrchestratorResult) {
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
    await this.close([])
  }

  /** A confirmed Assistant failure closes the established stream without exposing backend errors. */
  async finishWithError() {
    await this.close(FAILURE_BLOCKS)
  }

  /** Closes a known stream once after abort, with fresh authority and no replay of failed sends. */
  async terminateAfterFailure() {
    if (!this.stream || this.closed || this.closeAttempted) return
    const signal = AbortSignal.timeout(5000)
    await this.options.beforeCleanup(signal)
    signal.throwIfAborted()
    this.closeAttempted = true
    await stopSlackAgentStream(
      this.options.token,
      this.stream.channel,
      this.stream.ts,
      'active',
      signal,
      FAILURE_BLOCKS,
      this.interruptedToolProgress()
    )
    this.closed = true
  }

  private async close(blocks: Record<string, unknown>[]) {
    await this.deliver(async () => {
      if (!this.stream || this.closed) throw new Error('Slack stream is not active')
      this.closeAttempted = true
      await stopSlackAgentStream(
        this.options.token,
        this.stream.channel,
        this.stream.ts,
        'active',
        this.options.controller.signal,
        blocks,
        this.interruptedToolProgress()
      )
      this.closed = true
    })
  }

  assertHealthy() {
    if (this.failure) throw this.failure
  }
}
