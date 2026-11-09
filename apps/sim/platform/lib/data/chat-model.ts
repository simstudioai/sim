import { isPlainRecord } from '@sim/utils/object'
import { truncate } from '@sim/utils/string'
import type { AgentGroupItem } from '@/components/mothership-chat/message-content/components/agent-group/agent-group-view'
import { splitMainLane } from '@/components/mothership-chat/message-content/components/agent-group/lane-activity'
import {
  getActivityHeaderTool,
  getActivityStatusTool,
  getCompletedActivityLabel,
  getInProgressActivityLabel,
  withoutRetriedSearchFailures,
} from '@/components/mothership-chat/message-content/components/agent-group/tool-activity-labels'
import { parseQuestionAnswerMessage } from '@/components/mothership-chat/message-content/components/question/answers'
import {
  type AgentGroupSegment,
  deriveThinkingLabel,
  getOrchestratorMessageText,
  type MessageSegment,
  parseBlocks,
} from '@/components/mothership-chat/message-content/parse-blocks'
import { resolveMessageCitations } from '@/components/mothership-chat/message-content/resolve-citations'
import { isToolDone } from '@/components/mothership-chat/message-content/tool-status'
import { isSafeHttpUrl } from '@/lib/core/utils/urls'
import { searchConnectionTargetSchema } from '@/lib/knowledge/search/connection-target'
import { isChatContext } from '@/lib/mothership/chat/context'
import { linkSiteName } from '@/lib/mothership/chat/source-link'
import {
  type ContentSegment,
  type CredentialItemData,
  parseCredentialSubmissionProgress,
  parseLastCredentialTag,
  parseLastQuestionTag,
  parseSpecialTags,
  type SourceTagData,
} from '@/lib/mothership/chat/special-tags'
import type { ChatMessage, ChatMessageContext, ToolCallData } from '@/lib/mothership/chat/types'
import {
  Terminal as TerminalTool,
  Wait as WaitTool,
} from '@/lib/mothership/generated/tool-catalog-v1'
import { readCallActivity } from '@/lib/mothership/tools/activity'
import {
  getToolInProgressTitle,
  getToolStatusDisplayTitle,
  getWaitCountdownTitle,
} from '@/lib/mothership/tools/display'
import type {
  ChatSource,
  PlatformCredentialRequest,
  PlatformLane,
  PlatformLaneItem,
  PlatformPart,
  PlatformSegment,
  PlatformTool,
  PlatformTurn,
} from '@/app/(product)/_components/chat/model'
import type { ChatAttachment } from '@/app/(product)/_components/composer/model'
import { attachmentKind } from '@/platform/shared/attachment-kind'
import { formatInstantDate } from '@/platform/shared/time'
import { getAssistantToolEffect } from '@/tools/assistant-effects'

/** Tool payloads are diagnostic text, never the whole of a file a tool wrote. */
const MAX_PAYLOAD_CHARS = 6_000

/** A live turn re-projects per chunk, and a large result need only serialize once. */
const PAYLOAD_TEXT = new WeakMap<object, string>()

function payloadText(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'object') return truncate(String(value), MAX_PAYLOAD_CHARS, '…')
  const cached = PAYLOAD_TEXT.get(value)
  if (cached !== undefined) return cached
  try {
    const text = truncate(JSON.stringify(value, null, 2), MAX_PAYLOAD_CHARS, '…')
    PAYLOAD_TEXT.set(value, text)
    return text
  } catch {
    return undefined
  }
}

function stringArg(params: Record<string, unknown> | undefined, key: string): string {
  const value = params?.[key]
  return typeof value === 'string' ? value : ''
}

/** A waiting `wait` counts down from its start; everything else takes the row's parsed title. */
function toolTitle(tool: ToolCallData, now: number): string {
  if (tool.toolName === WaitTool.id && tool.status === 'executing') {
    const elapsed = tool.startedAt ? now - tool.startedAt : 0
    return getToolStatusDisplayTitle(
      getWaitCountdownTitle(tool.params, elapsed),
      tool.status,
      tool.toolName
    )
  }
  return getToolStatusDisplayTitle(
    tool.displayTitle,
    tool.status,
    tool.toolName,
    tool.activityDescription
  )
}

function terminalHandoff(tool: ToolCallData): PlatformTool['handoff'] {
  if (
    tool.toolName !== TerminalTool.id ||
    tool.status !== 'executing' ||
    tool.params?.operation !== 'handoff'
  )
    return undefined
  const args = isPlainRecord(tool.params.args) ? tool.params.args : undefined
  return { terminalId: stringArg(args, 'terminalId'), reason: stringArg(args, 'reason') }
}

function toPlatformTool(tool: ToolCallData, now: number): PlatformTool {
  return {
    id: tool.id,
    name: tool.toolName,
    title: toolTitle(tool, now),
    status: tool.status,
    input: payloadText(tool.params),
    output: payloadText(tool.result?.output),
    error: tool.result?.error,
    handoff: terminalHandoff(tool),
    reviewed: getAssistantToolEffect(tool.toolName) !== undefined,
  }
}

/** The legacy group header's rule: in progress names the live call, finished sums up the run. */
function activityLabel(tools: ToolCallData[], running: boolean): string {
  const shown = withoutRetriedSearchFailures(tools)
  const statusTool = getActivityStatusTool(shown)
  if (!statusTool) return ''
  const header = getActivityHeaderTool(shown, statusTool)
  const grouped = shown
    .map(readCallActivity)
    .reverse()
    .find((entry) => entry?.title || entry?.completedTitle)
  const working = running || shown.some((tool) => !isToolDone(tool.status))
  if (working) {
    const active = getToolInProgressTitle(
      header.displayTitle,
      header.status,
      header.toolName,
      header.activityDescription
    )
    return getInProgressActivityLabel(active, header, shown, grouped?.title)
  }
  return shown.length === 1
    ? getToolStatusDisplayTitle(
        shown[0].displayTitle,
        shown[0].status,
        shown[0].toolName,
        shown[0].activityDescription
      )
    : getCompletedActivityLabel(shown, grouped)
}

function parseSearchTarget(item: CredentialItemData) {
  const target = searchConnectionTargetSchema.safeParse(item)
  return target.success ? target.data : undefined
}

function toCredentialRequest(item: CredentialItemData): PlatformCredentialRequest {
  return {
    type: item.type,
    name: item.name,
    provider: item.provider,
    value: item.value,
    description: item.description,
    scope: item.scope,
    workspaceId: item.workspaceId,
    source: item,
    safeUrl: item.value && isSafeHttpUrl(item.value) ? item.value : undefined,
    searchTarget: item.connectorType ? parseSearchTarget(item) : undefined,
  }
}

interface InteractionPairing {
  answers?: string[]
  submission?: { saved: string[]; skipped: string[] }
  abandoned?: boolean
}

function toSegments(
  content: string,
  streaming: boolean,
  pairing: InteractionPairing | undefined
): PlatformSegment[] {
  const parsed = parseSpecialTags(content, streaming)
  const segments: PlatformSegment[] = []
  /** A citation reads inline, so it joins the prose around it as a link. */
  function appendMarkdown(text: string) {
    const last = segments.at(-1)
    if (last?.kind === 'markdown') last.text += text
    else if (text.trim()) segments.push({ kind: 'markdown', text })
  }
  for (const segment of parsed.segments as ContentSegment[]) {
    switch (segment.type) {
      case 'text':
        appendMarkdown(segment.content)
        break
      case 'source':
        appendMarkdown(
          ` [${segment.data.title || segment.data.siteName || segment.data.url}](${segment.data.url})`
        )
        break
      case 'options':
        segments.push({
          kind: 'options',
          options: Object.entries(segment.data).map(([id, option]) => ({
            id,
            label: option.title,
            description: option.description,
          })),
        })
        break
      case 'question':
        segments.push({
          kind: 'question',
          questions: segment.data.map((question) => ({
            prompt: question.prompt,
            type: question.type,
            options: question.options,
          })),
          answers: pairing?.answers,
        })
        break
      case 'credential':
        segments.push({
          kind: 'credential',
          items: segment.data.map(toCredentialRequest),
          submission: pairing?.submission,
          abandoned: pairing?.abandoned,
        })
        break
      case 'workspace_resource':
        segments.push({
          kind: 'resource',
          type: segment.data.type,
          id: segment.data.id ?? segment.data.path ?? '',
          title: segment.data.title ?? 'Resource',
          workspaceId: segment.data.workspaceId,
        })
        break
      case 'usage_upgrade':
        segments.push({
          kind: 'usage',
          action: segment.data.action,
          reason: segment.data.reason,
          message: segment.data.message,
        })
        break
      case 'mothership-error':
        segments.push({ kind: 'failure', message: segment.data.message })
        break
      case 'thinking':
        // Reasoning text is not part of the transcript.
        break
    }
  }
  if (parsed.hasPendingTag) segments.push({ kind: 'pending', label: 'Thinking' })
  return segments
}

function toLaneItem(
  item: AgentGroupItem,
  id: string,
  now: number,
  streaming: boolean
): PlatformLaneItem {
  if (item.type === 'text')
    return { kind: 'text', id, segments: toSegments(item.content, streaming, undefined) }
  if (item.type === 'tool') return { kind: 'tool', tool: toPlatformTool(item.data, now) }
  return { kind: 'lane', lane: toLane(item.group, now, streaming) }
}

function laneTools(items: readonly AgentGroupItem[]): ToolCallData[] {
  return items.flatMap((item) =>
    item.type === 'tool'
      ? [item.data]
      : item.type === 'agent_group'
        ? laneTools(item.group.items)
        : []
  )
}

function toLane(
  group: Pick<
    AgentGroupSegment,
    'id' | 'agentLabel' | 'items' | 'error' | 'isOpen' | 'isDelegating'
  >,
  now: number,
  streaming: boolean
): PlatformLane {
  const tools = laneTools(group.items)
  const running = group.isOpen || group.isDelegating
  return {
    id: group.id,
    label: group.agentLabel,
    running,
    error: group.error,
    status: tools.length ? activityLabel(tools, running) : running ? 'Starting' : '',
    items: group.items.map((item, index) =>
      toLaneItem(item, `${group.id}:${index}`, now, streaming)
    ),
  }
}

/** Where a source lives, who wrote it and when it changed, in the order a result row reads them. */
function sourceMeta(source: SourceTagData): string {
  const updatedAt = source.updatedAt ? new Date(source.updatedAt) : null
  return [
    linkSiteName(source.url, source.siteName),
    source.author?.trim(),
    updatedAt && !Number.isNaN(updatedAt.getTime()) ? formatInstantDate(updatedAt) : undefined,
  ]
    .filter(Boolean)
    .join(' · ')
}

/**
 * Each document the answer's own prose cites, once by URL in first-cited order. Text a lane folds
 * into its agent group is scratch work, so only the top-level text segments count.
 */
function citedSources(segments: readonly MessageSegment[]): ChatSource[] {
  const byUrl = new Map<string, ChatSource>()
  for (const segment of segments) {
    if (segment.type !== 'text') continue
    for (const part of parseSpecialTags(segment.content, false).segments) {
      if (part.type !== 'source' || byUrl.has(part.data.url)) continue
      const source = part.data
      byUrl.set(source.url, {
        id: source.url,
        url: source.url,
        title: source.title?.trim() || linkSiteName(source.url, source.siteName),
        meta: sourceMeta(source),
      })
    }
  }
  return [...byUrl.values()]
}

/** A settled message never changes, so a long transcript re-parses only the turn in progress. */
const SETTLED_TURNS = new WeakMap<
  ChatMessage,
  { pairing: string; parts: PlatformPart[]; copyText: string; sources: ChatSource[] }
>()

function toParts(
  segments: MessageSegment[],
  message: ChatMessage,
  streaming: boolean,
  now: number,
  pairing: InteractionPairing | undefined
): PlatformPart[] {
  const parts: PlatformPart[] = []
  segments.forEach((segment, index) => {
    const id = `${message.id}:${index}`
    switch (segment.type) {
      case 'text':
        parts.push({
          kind: 'prose',
          id,
          segments: toSegments(segment.content, streaming, pairing),
        })
        return
      case 'options':
        parts.push({ kind: 'prose', id, segments: [{ kind: 'options', options: segment.items }] })
        return
      case 'stopped':
        parts.push({ kind: 'stopped', id })
        return
      case 'task':
        parts.push({ kind: 'task', id, title: segment.task.summary || segment.task.note })
        return
      case 'agent_group':
        break
    }
    if (segment.agentName !== 'mothership') {
      parts.push({ kind: 'lane', id, lane: toLane(segment, now, streaming) })
      return
    }
    splitMainLane(segment.items).forEach((entry, entryIndex) => {
      const entryId = `${id}:${entryIndex}`
      if (entry.type === 'run') {
        const running = streaming && entry.run.tools.some((tool) => !isToolDone(tool.status))
        parts.push({
          kind: 'activity',
          id: entryId,
          label: activityLabel(entry.run.tools, running),
          initiallyOpen: false,
          tools: withoutRetriedSearchFailures(entry.run.tools).map((tool) =>
            toPlatformTool(tool, now)
          ),
        })
        return
      }
      const { item } = entry
      if (item.type === 'tool')
        parts.push({ kind: 'approval', id: entryId, tool: toPlatformTool(item.data, now) })
      else if (item.type === 'text')
        parts.push({
          kind: 'prose',
          id: entryId,
          segments: toSegments(item.content, streaming, pairing),
        })
      else parts.push({ kind: 'lane', id: entryId, lane: toLane(item.group, now, streaming) })
    })
  })
  return parts
}

/** A saved context restores only with its resource identity, which prompt recall sends again. */
function contextReference(context: ChatMessageContext, index: number): ChatAttachment {
  return {
    id: `context:${index}`,
    kind: 'reference',
    name: context.label,
    metadata: context.kind,
    ...(isChatContext(context) ? { context } : {}),
  }
}

function toUserAttachments(message: ChatMessage): ChatAttachment[] {
  const uploads = new Map(message.fileAttachments?.map((upload) => [upload.id, upload]))
  return [
    ...(message.attachments ?? []).map((file) => ({
      id: file.id,
      name: file.filename,
      metadata: file.media_type,
      kind: attachmentKind(file.media_type),
      source: file.previewUrl,
      upload: uploads.get(file.id),
    })),
    ...(message.contexts ?? []).map(contextReference),
  ]
}

function automatedTurn(message: ChatMessage): PlatformTurn {
  const lines = message.content.split('\n').filter((line) => line.length > 0)
  const task = message.origin === 'task'
  return {
    role: 'automated',
    id: message.id,
    label: task ? 'Background task' : 'Scheduled job',
    summary: task
      ? (lines.find((line) => line.startsWith('Task ')) ?? lines.at(-1) ?? '').replace(
          /^Task [0-9a-f-]+ /,
          ''
        )
      : (lines[0] ?? '').replace(/^Job: /, ''),
  }
}

/**
 * Pairs each question or credential card with the user message that answered it. That message is
 * hidden: the answered card is the turn, on reload as well as live. A credential card the person
 * talked past is abandoned, since the turn it asked for is over.
 */
function pairInteractions(messages: readonly ChatMessage[]) {
  const byIndex = new Map<number, InteractionPairing>()
  const hidden = new Set<number>()
  /** Only the tail changes per chunk, and only a tagged message pairs, so most skip the parsers. */
  const mayPair = (message: ChatMessage) =>
    message.content?.includes('</question>') || message.content?.includes('</credential>')
  let lastUser = -1
  messages.forEach((message, index) => {
    if (message.role === 'user') lastUser = index
  })
  messages.forEach((message, index) => {
    if (message.role !== 'assistant') return
    const next = messages[index + 1]
    const answer = next?.role === 'user' && next.content ? next.content : null
    const superseded = index < lastUser
    if ((!answer && !superseded) || !mayPair(message)) return
    if (answer && message.content?.includes('</question>')) {
      const questions = parseLastQuestionTag(message.content)
      const answers = questions ? parseQuestionAnswerMessage(questions, answer) : null
      if (answers) {
        byIndex.set(index, { answers })
        hidden.add(index + 1)
        return
      }
    }
    if (message.content?.includes('</credential>')) {
      const credentials = parseLastCredentialTag(message.content)
      const submission =
        answer && credentials ? parseCredentialSubmissionProgress(credentials, answer) : null
      if (submission) {
        const named = [...submission.integrations, ...submission.secrets]
        byIndex.set(index, {
          submission: {
            saved: named.filter((item) => item.status !== 'skipped').map((item) => item.name),
            skipped: named.filter((item) => item.status === 'skipped').map((item) => item.name),
          },
        })
        hidden.add(index + 1)
      } else if (superseded) {
        byIndex.set(index, { abandoned: true })
      }
    }
  })
  return { byIndex, hidden }
}

function endsWithInteraction(parts: readonly PlatformPart[]): boolean {
  const last = parts.at(-1)
  if (last?.kind === 'approval') return true
  if (last?.kind !== 'prose') return false
  const segment = last.segments?.at(-1)
  return segment?.kind === 'question' || segment?.kind === 'credential'
}

interface ProjectionOptions {
  streaming: boolean
  /** When each message was first seen, from history or from this session. */
  sentAt: (message: ChatMessage) => number | undefined
  /** Current instant, so a running `wait` counts down. */
  now: number
  isPersisted: (messageId: string) => boolean
}

/** The last turn built for each message, so one that did not change keeps its identity. */
const LAST_TURNS = new WeakMap<ChatMessage, PlatformTurn>()

/** A user or automated turn's other fields are the message's own, which this map is keyed by. */
function isUnchanged(previous: PlatformTurn, next: PlatformTurn): boolean {
  if (previous.role !== next.role) return false
  if (previous.role === 'automated') return true
  if (previous.sentAt !== (next as typeof previous).sentAt) return false
  if (previous.role === 'user' || next.role !== 'assistant') return true
  return (
    previous.parts === next.parts &&
    previous.state === next.state &&
    previous.waiting === next.waiting &&
    previous.userQuery === next.userQuery &&
    previous.forkable === next.forkable
  )
}

function keepIdentity(message: ChatMessage, next: PlatformTurn): PlatformTurn {
  const previous = LAST_TURNS.get(message)
  if (previous && isUnchanged(previous, next)) return previous
  LAST_TURNS.set(message, next)
  return next
}

/**
 * The response a running turn streams into: the last assistant, past messages on their way into it.
 * A turn's own message after it means this turn has no response yet (a reconnect before its first
 * event), so the one before belongs to a finished turn.
 */
function liveResponseIndex(messages: readonly ChatMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (message.role === 'assistant') return index
    if (!message.steering && !message.delivery) return -1
  }
  return -1
}

/** Whether the running response is paused in a `wait`, which counts down. */
export function isRunningWait(messages: readonly ChatMessage[]): boolean {
  return (messages[liveResponseIndex(messages)]?.contentBlocks ?? []).some(
    (block) => block.toolCall?.name === 'wait' && block.toolCall.status === 'executing'
  )
}

/**
 * The hook's transcript as Platform turns. A pure read of `messages`, so a replay, a reconnect or a
 * reload lands on the same turns, and it keeps the legacy parsers as the only readers of the wire.
 */
export function toPlatformTurns(
  messages: readonly ChatMessage[],
  { streaming, sentAt, now, isPersisted }: ProjectionOptions
): PlatformTurn[] {
  const { byIndex, hidden } = pairInteractions(messages)
  const liveIndex = liveResponseIndex(messages)
  let lastUserText = ''
  const turns: PlatformTurn[] = []
  messages.forEach((message, index) => {
    if (message.role === 'user') {
      lastUserText = message.content
      if (hidden.has(index)) return
      if (message.origin) {
        turns.push(keepIdentity(message, automatedTurn(message)))
        return
      }
      turns.push(
        keepIdentity(message, {
          role: 'user',
          id: message.id,
          prompt: { text: message.content, attachments: toUserAttachments(message) },
          sentAt: sentAt(message),
          ...(message.delivery ? { delivery: message.delivery } : {}),
        })
      )
      return
    }
    const live = streaming && index === liveIndex
    const blocks = message.contentBlocks ?? []
    const pairing = byIndex.get(index)
    const pairingKey = pairing ? JSON.stringify(pairing) : ''
    const settled = SETTLED_TURNS.get(message)
    let parts: PlatformPart[]
    let copyText = ''
    let sources: ChatSource[] = []
    if (!live && settled?.pairing === pairingKey) {
      parts = settled.parts
      copyText = settled.copyText
      sources = settled.sources
    } else {
      const cited = resolveMessageCitations(
        blocks,
        message.content,
        message.requestMode === 'assistant'
      )
      const segments: MessageSegment[] =
        cited.blocks.length > 0
          ? parseBlocks(cited.blocks, live)
          : cited.fallbackContent
            ? [{ type: 'text', id: `${message.id}:text`, content: cited.fallbackContent }]
            : []
      parts = toParts(segments, message, live, now, pairing)
      if (!live) {
        copyText = getOrchestratorMessageText(blocks, message.content)
        sources = citedSources(segments)
        SETTLED_TURNS.set(message, { pairing: pairingKey, parts, copyText, sources })
      }
    }
    const stopped = parts.some((part) => part.kind === 'stopped')
    turns.push(
      keepIdentity(message, {
        role: 'assistant',
        id: message.id,
        state: live ? 'running' : stopped ? 'stopped' : 'complete',
        parts,
        copyText,
        sentAt: sentAt(message),
        waiting: live ? deriveThinkingLabel(blocks) : undefined,
        requestId: message.requestId,
        userQuery: lastUserText,
        endsWithInteraction: endsWithInteraction(parts),
        forkable: isPersisted(message.id),
        ...(sources.length ? { sources } : {}),
      })
    )
  })
  return turns
}
