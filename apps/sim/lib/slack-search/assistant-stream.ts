import { toError } from '@sim/utils/errors'
import { truncate } from '@sim/utils/string'
import { collectRetrievalCitationEvidence } from '@/lib/copilot/chat/citation-evidence'
import { redactSensitiveContent } from '@/lib/copilot/chat/sim-key-redaction'
import type { StreamEvent } from '@/lib/copilot/request/session/contract'
import type { OrchestratorResult } from '@/lib/copilot/request/types'
import { SLACK_SEARCH_FAILED_ANSWER } from '@/lib/slack-search/constants'
import {
  appendSlackAgentStream,
  setSlackAgentSessionStatus,
  startSlackAgentStream,
  stopSlackAgentStream,
} from '@/lib/webhooks/slack-agent-api'
import { projectResolvedSecretDiagnosticContent } from '@/executor/utils/resolved-secret-content-projection'
import type { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

/** Withholds incomplete inline markup so split citation tags and URLs never leak into a stream. */
export function publicSlackAnswer(text: string, complete: boolean): string {
  let value = text.replace(
    /<(source|options|question|thinking|usage_upgrade|credential|workspace_resource)>[\s\S]*?(?:<\/\1>|$)/g,
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
  return value
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]*>/g, '')
    .replace(/(?:https?:\/\/|www\.)[^\s<>]+/gi, '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

interface AssistantStreamOptions {
  token: string
  channel: string
  threadTs: string
  slackUserId: string
  controller: AbortController
  registry: ResolvedSecretTraceRegistry
  beforeDelivery: () => Promise<void>
}

/** Serial delivery through the same provider primitives as Slack blocks; ambiguous sends are terminal. */
export class SlackSearchAssistantStream {
  private stream?: { channel: string; ts: string }
  private text = ''
  private sent = ''
  private lastSentAt = 0
  private failure?: Error
  private closed = false
  private separateNextText = false
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
    if (event.type === 'tool' && !event.scope) this.separateNextText = true
    if (event.type !== 'text' || event.payload.channel !== 'assistant' || event.scope) return
    if (this.separateNextText && this.text) this.text += '\n\n'
    this.separateNextText = false
    this.text += event.payload.text
    if (this.text.length > 128_000) throw new Error('Slack answer exceeds the supported size')
    if (Date.now() - this.lastSentAt >= 750) await this.flush(false)
  }

  private async flush(complete: boolean) {
    const { registry, token, controller } = this.options
    if (!registry.isComplete()) throw new Error('Answer secret provenance is unavailable')
    /** Active secret literals can straddle deltas; project their complete answer instead. */
    if (!complete && registry.getActiveMatches().length) return
    const projection = projectResolvedSecretDiagnosticContent(this.text, registry, 512_000)
    if (!projection.safe || typeof projection.value !== 'string')
      throw new Error('Answer could not be safely projected')
    const text = publicSlackAnswer(redactSensitiveContent(projection.value), complete)
    if (!text.startsWith(this.sent)) throw new Error('The safe answer changed after delivery')
    let pending = text.slice(this.sent.length)
    while (pending.length) {
      const chunk = pending.slice(0, 4000)
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
    await this.flush(true)
    const evidence = collectRetrievalCitationEvidence(result.contentBlocks)
    const blocks: Record<string, unknown>[] = []
    const seen = new Set<string>()
    for (const source of evidence.values()) {
      if (typeof source.url !== 'string' || seen.has(source.url) || source.url.length > 3000)
        continue
      const projection = projectResolvedSecretDiagnosticContent(source, this.options.registry)
      if (!projection.safe || JSON.stringify(projection.value) !== JSON.stringify(source)) continue
      seen.add(source.url)
      blocks.push({
        type: 'section',
        text: {
          type: 'plain_text',
          text: truncate(typeof source.title === 'string' ? source.title : 'Source', 150),
        },
        accessory: {
          type: 'button',
          text: { type: 'plain_text', text: 'Open source' },
          url: source.url,
          action_id: `slack_search_source_${blocks.length}`,
        },
      })
      if (blocks.length === 5) break
    }
    await this.close(blocks)
  }

  /** A confirmed Assistant failure closes the established stream without exposing backend errors. */
  async finishWithError() {
    await this.close([
      {
        type: 'section',
        text: { type: 'plain_text', text: SLACK_SEARCH_FAILED_ANSWER },
      },
    ])
  }

  private async close(blocks: Record<string, unknown>[]) {
    await this.deliver(async () => {
      if (!this.stream || this.closed) throw new Error('Slack stream is not active')
      await stopSlackAgentStream(
        this.options.token,
        this.stream.channel,
        this.stream.ts,
        'active',
        this.options.controller.signal,
        blocks
      )
      this.closed = true
    })
  }

  assertHealthy() {
    if (this.failure) throw this.failure
  }
}
