import { isRecordLike } from '@sim/utils/object'
import { normalizeMessage, type PersistedMessage } from '@/lib/copilot/chat/persisted-message'
import { resolveStreamToolOutcome } from '@/lib/copilot/chat/stream-tool-outcome'
import {
  MothershipStreamV1CompletionStatus,
  type MothershipStreamV1ErrorPayload,
  MothershipStreamV1EventType,
  MothershipStreamV1RunKind,
  MothershipStreamV1SessionKind,
  MothershipStreamV1SpanLifecycleEvent,
  MothershipStreamV1SpanPayloadKind,
  MothershipStreamV1TextChannel,
  MothershipStreamV1ToolOutcome,
  MothershipStreamV1ToolPhase,
} from '@/lib/copilot/generated/mothership-stream-v1'
import type { FilePreviewSession } from '@/lib/copilot/request/session/file-preview-session-contract'
import type { StreamBatchEvent } from '@/lib/copilot/request/session/types'
import { getToolDisplayTitle } from '@/lib/copilot/tools/tool-display'

interface StreamSnapshotLike {
  events: StreamBatchEvent[]
  previewSessions: FilePreviewSession[]
  status: string
}

interface BuildEffectiveChatTranscriptParams {
  messages: PersistedMessage[]
  activeStreamId: string | null
  streamSnapshot?: StreamSnapshotLike | null
}

type RawPersistedBlock = Record<string, unknown>

export function getLiveAssistantMessageId(streamId: string): string {
  return `live-assistant:${streamId}`
}

/**
 * True for the synthetic id of a streaming/just-streamed assistant message.
 * These ids exist only in the client's effective transcript — never in the
 * persisted one — so message-scoped server actions (e.g. fork) must not be
 * offered until the transcript refetch swaps in the persisted message id.
 */
export function isLiveAssistantMessageId(messageId: string): boolean {
  return messageId.startsWith('live-assistant:')
}

function asPayloadRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecordLike(value) ? value : undefined
}

function isTerminalStreamStatus(status: string | null | undefined): boolean {
  return (
    status === MothershipStreamV1CompletionStatus.complete ||
    status === MothershipStreamV1CompletionStatus.error ||
    status === MothershipStreamV1CompletionStatus.cancelled
  )
}

function buildInlineErrorTag(payload: MothershipStreamV1ErrorPayload): string {
  const message =
    (typeof payload.displayMessage === 'string' ? payload.displayMessage : undefined) ||
    (typeof payload.message === 'string' ? payload.message : undefined) ||
    (typeof payload.error === 'string' ? payload.error : undefined) ||
    'An unexpected error occurred'
  const provider = typeof payload.provider === 'string' ? payload.provider : undefined
  const code = typeof payload.code === 'string' ? payload.code : undefined
  return `<mothership-error>${JSON.stringify({
    message,
    ...(code ? { code } : {}),
    ...(provider ? { provider } : {}),
  })}</mothership-error>`
}

function appendTextBlock(
  blocks: RawPersistedBlock[],
  content: string,
  options: {
    lane?: 'subagent'
    parentToolCallId?: string
    spanId?: string
    parentSpanId?: string
  }
): void {
  if (!content) return
  const last = blocks[blocks.length - 1]
  if (
    last?.type === MothershipStreamV1EventType.text &&
    last.lane === options.lane &&
    last.parentToolCallId === options.parentToolCallId &&
    last.spanId === options.spanId
  ) {
    last.content = `${typeof last.content === 'string' ? last.content : ''}${content}`
    return
  }

  blocks.push({
    type: MothershipStreamV1EventType.text,
    ...(options.lane ? { lane: options.lane } : {}),
    ...(options.parentToolCallId ? { parentToolCallId: options.parentToolCallId } : {}),
    ...(options.spanId ? { spanId: options.spanId } : {}),
    ...(options.parentSpanId ? { parentSpanId: options.parentSpanId } : {}),
    content,
  })
}

function buildLiveAssistantMessage(params: {
  streamId: string
  events: StreamBatchEvent[]
  status: string | null | undefined
}): PersistedMessage | null {
  const { streamId, events, status } = params
  const blocks: RawPersistedBlock[] = []
  const toolIndexById = new Map<string, number>()
  const subagentByParentToolCallId = new Map<string, string>()
  const subagentBySpanId = new Map<string, string>()
  let activeSubagent: string | undefined
  let activeSubagentParentToolCallId: string | undefined
  const activeCompactionIdByLane = new Map<string, string>()
  let runningText = ''
  let lastContentSource: 'main' | 'subagent' | null = null
  let requestId: string | undefined
  let lastTimestamp: string | undefined

  // Scope-only resolution (mirrors the live browser stream loop): with
  // concurrent subagents the legacy activeSubagent fallback / name-match scan
  // would mis-attribute interleaved replayed events to the wrong lane.
  const resolveScopedSubagent = (
    agentId: string | undefined,
    parentToolCallId: string | undefined,
    spanId?: string
  ): string | undefined => {
    if (spanId) {
      const scoped = subagentBySpanId.get(spanId)
      if (scoped) return scoped
    }
    if (parentToolCallId) {
      const scoped = subagentByParentToolCallId.get(parentToolCallId)
      if (scoped) return scoped
    }
    return agentId
  }

  const resolveParentForSubagentBlock = (
    subagent: string | undefined,
    scopedParent: string | undefined
  ): string | undefined => {
    if (!subagent) return undefined
    return scopedParent
  }

  // Tool ownership (calledBy / parent / span identity) is CALL-FRAME
  // authoritative: once a call frame for a tool id has been reduced, later
  // scoped results or replayed duplicates must not re-parent the tool. Before
  // a call frame arrives, ownership stays provisional (result-first replay
  // arrival is legal) and the call frame settles it — including CLEARING
  // stale subagent attribution when the call is main-lane (unscoped). Without
  // the clear, one mis-scoped replayed event pinned main tools under a
  // subagent (observed: Sim's reads rendered under Superagent) with no later
  // event able to correct it.
  const toolOwnershipSettled = new Set<string>()

  const ensureToolBlock = (input: {
    toolCallId: string
    toolName: string
    calledBy?: string
    parentToolCallId?: string
    spanId?: string
    parentSpanId?: string
    displayTitle?: string
    params?: Record<string, unknown>
    result?: { success: boolean; output?: unknown; error?: string }
    state?: string
    isCallFrame?: boolean
  }): RawPersistedBlock => {
    const ownershipWritable = input.isCallFrame === true || !toolOwnershipSettled.has(input.toolCallId)
    if (input.isCallFrame) toolOwnershipSettled.add(input.toolCallId)
    const existingIndex = toolIndexById.get(input.toolCallId)
    if (existingIndex !== undefined) {
      const existing = blocks[existingIndex]
      const existingToolCall = asPayloadRecord(existing.toolCall)
      existing.toolCall = {
        ...(existingToolCall ?? {}),
        id: input.toolCallId,
        name: input.toolName,
        state:
          input.state ??
          (typeof existingToolCall?.state === 'string' ? existingToolCall.state : 'executing'),
        ...(ownershipWritable && input.calledBy ? { calledBy: input.calledBy } : {}),
        ...(input.params ? { params: input.params } : {}),
        ...(input.result ? { result: input.result } : {}),
        ...(input.displayTitle
          ? {
              display: {
                title: input.displayTitle,
              },
            }
          : existingToolCall?.display
            ? { display: existingToolCall.display }
            : {}),
      }
      if (ownershipWritable) {
        if (input.parentToolCallId) existing.parentToolCallId = input.parentToolCallId
        if (input.spanId) existing.spanId = input.spanId
        if (input.parentSpanId) existing.parentSpanId = input.parentSpanId
        if (input.isCallFrame && !input.calledBy) {
          // Authoritative main-lane call: clear any provisionally-seeded
          // subagent attribution so the tool renders under Sim, not the
          // forwarding caller.
          const tc = asPayloadRecord(existing.toolCall)
          if (tc) delete tc.calledBy
          delete existing.parentToolCallId
          delete existing.spanId
          delete existing.parentSpanId
        }
      }
      return existing
    }

    const nextBlock: RawPersistedBlock = {
      type: MothershipStreamV1EventType.tool,
      phase: MothershipStreamV1ToolPhase.call,
      toolCall: {
        id: input.toolCallId,
        name: input.toolName,
        state: input.state ?? 'executing',
        ...(input.calledBy ? { calledBy: input.calledBy } : {}),
        ...(input.params ? { params: input.params } : {}),
        ...(input.result ? { result: input.result } : {}),
        ...(input.displayTitle
          ? {
              display: {
                title: input.displayTitle,
              },
            }
          : {}),
      },
      ...(input.parentToolCallId ? { parentToolCallId: input.parentToolCallId } : {}),
      ...(input.spanId ? { spanId: input.spanId } : {}),
      ...(input.parentSpanId ? { parentSpanId: input.parentSpanId } : {}),
    }
    toolIndexById.set(input.toolCallId, blocks.length)
    blocks.push(nextBlock)
    return nextBlock
  }

  for (const entry of events) {
    const parsed = entry.event
    lastTimestamp = parsed.ts
    if (typeof parsed.trace?.requestId === 'string') {
      requestId = parsed.trace.requestId
    }
    const scopedParentToolCallId =
      typeof parsed.scope?.parentToolCallId === 'string' ? parsed.scope.parentToolCallId : undefined
    const scopedAgentId =
      typeof parsed.scope?.agentId === 'string' ? parsed.scope.agentId : undefined
    const scopedSpanId = typeof parsed.scope?.spanId === 'string' ? parsed.scope.spanId : undefined
    const scopedParentSpanId =
      typeof parsed.scope?.parentSpanId === 'string' ? parsed.scope.parentSpanId : undefined
    const scopedSubagent = resolveScopedSubagent(
      scopedAgentId,
      scopedParentToolCallId,
      scopedSpanId
    )
    const spanIdentity: { spanId?: string; parentSpanId?: string } = {
      ...(scopedSpanId ? { spanId: scopedSpanId } : {}),
      ...(scopedParentSpanId ? { parentSpanId: scopedParentSpanId } : {}),
    }
    const compactionLaneKey = scopedSpanId
      ? `span:${scopedSpanId}`
      : scopedParentToolCallId
        ? `parent:${scopedParentToolCallId}`
        : 'main'

    switch (parsed.type) {
      case MothershipStreamV1EventType.session: {
        if (parsed.payload.kind === MothershipStreamV1SessionKind.chat) {
          continue
        }
        if (parsed.payload.kind === MothershipStreamV1SessionKind.start) {
          continue
        }
        if (parsed.payload.kind === MothershipStreamV1SessionKind.trace) {
          requestId = parsed.payload.requestId
        }
        continue
      }
      case MothershipStreamV1EventType.text: {
        const chunk = parsed.payload.text
        if (!chunk) {
          continue
        }
        // Reasoning is never rendered or persisted (the stream reducer and the
        // turn model both key on the channel; buildPersistedAssistantMessage
        // strips it). This snapshot-derived converter must not resurrect it as
        // visible prose — skip before block append AND runningText so thinking
        // never leaks into the live-assistant message's content either.
        if (parsed.payload.channel === MothershipStreamV1TextChannel.thinking) {
          continue
        }
        const contentSource: 'main' | 'subagent' = scopedSubagent ? 'subagent' : 'main'
        const needsBoundaryNewline =
          lastContentSource !== null &&
          lastContentSource !== contentSource &&
          runningText.length > 0 &&
          !runningText.endsWith('\n')
        const normalizedChunk = needsBoundaryNewline ? `\n${chunk}` : chunk
        const parentForBlock = resolveParentForSubagentBlock(scopedSubagent, scopedParentToolCallId)
        appendTextBlock(blocks, normalizedChunk, {
          ...(scopedSubagent ? { lane: 'subagent' as const } : {}),
          ...(parentForBlock ? { parentToolCallId: parentForBlock } : {}),
          ...spanIdentity,
        })
        runningText += normalizedChunk
        lastContentSource = contentSource
        continue
      }
      case MothershipStreamV1EventType.tool: {
        const payload = parsed.payload
        const toolCallId = payload.toolCallId

        if ('previewPhase' in payload) {
          continue
        }

        if (payload.phase === MothershipStreamV1ToolPhase.args_delta) {
          continue
        }

        const parentForBlock = resolveParentForSubagentBlock(scopedSubagent, scopedParentToolCallId)

        if (payload.phase === MothershipStreamV1ToolPhase.result) {
          ensureToolBlock({
            toolCallId,
            toolName: payload.toolName,
            calledBy: scopedSubagent,
            ...(parentForBlock ? { parentToolCallId: parentForBlock } : {}),
            ...spanIdentity,
            state: resolveStreamToolOutcome(payload),
            result: {
              success: payload.success,
              ...(payload.output !== undefined ? { output: payload.output } : {}),
              ...(typeof payload.error === 'string' ? { error: payload.error } : {}),
            },
          })
          continue
        }

        ensureToolBlock({
          toolCallId,
          toolName: payload.toolName,
          calledBy: scopedSubagent,
          ...(parentForBlock ? { parentToolCallId: parentForBlock } : {}),
          ...spanIdentity,
          displayTitle: getToolDisplayTitle(
            payload.toolName,
            isRecordLike(payload.arguments) ? payload.arguments : undefined
          ),
          params: isRecordLike(payload.arguments) ? payload.arguments : undefined,
          state: typeof payload.status === 'string' ? payload.status : 'executing',
          isCallFrame: payload.phase === MothershipStreamV1ToolPhase.call,
        })
        continue
      }
      case MothershipStreamV1EventType.span: {
        if (parsed.payload.kind !== MothershipStreamV1SpanPayloadKind.subagent) {
          continue
        }

        const spanData = asPayloadRecord(parsed.payload.data)
        const parentToolCallIdFromData =
          typeof spanData?.tool_call_id === 'string'
            ? spanData.tool_call_id
            : typeof spanData?.toolCallId === 'string'
              ? spanData.toolCallId
              : undefined
        const parentToolCallId = scopedParentToolCallId ?? parentToolCallIdFromData
        const name = typeof parsed.payload.agent === 'string' ? parsed.payload.agent : scopedAgentId
        if (parsed.payload.event === MothershipStreamV1SpanLifecycleEvent.start && name) {
          if (scopedSpanId) {
            subagentBySpanId.set(scopedSpanId, name)
          }
          if (parentToolCallId) {
            subagentByParentToolCallId.set(parentToolCallId, name)
          }
          activeSubagent = name
          activeSubagentParentToolCallId = parentToolCallId
          blocks.push({
            type: MothershipStreamV1EventType.span,
            kind: MothershipStreamV1SpanPayloadKind.subagent,
            lifecycle: MothershipStreamV1SpanLifecycleEvent.start,
            content: name,
            ...(parentToolCallId ? { parentToolCallId } : {}),
            ...spanIdentity,
          })
          continue
        }

        if (parsed.payload.event === MothershipStreamV1SpanLifecycleEvent.end) {
          if (spanData?.pending === true) {
            continue
          }
          if (scopedSpanId) {
            subagentBySpanId.delete(scopedSpanId)
          }
          if (parentToolCallId) {
            subagentByParentToolCallId.delete(parentToolCallId)
          }
          // Clear the legacy pointer only for THIS lane (by parent tool call id)
          // or an unscoped end — never by agent name, which would tear down a
          // concurrent same-name sibling that is still open.
          if (!parentToolCallId || parentToolCallId === activeSubagentParentToolCallId) {
            activeSubagent = undefined
            activeSubagentParentToolCallId = undefined
          }
          blocks.push({
            type: MothershipStreamV1EventType.span,
            kind: MothershipStreamV1SpanPayloadKind.subagent,
            lifecycle: MothershipStreamV1SpanLifecycleEvent.end,
            ...(parentToolCallId ? { parentToolCallId } : {}),
            ...spanIdentity,
          })
        }
        continue
      }
      case MothershipStreamV1EventType.run: {
        if (parsed.payload.kind === MothershipStreamV1RunKind.compaction_start) {
          const compactionId = `compaction_${entry.eventId}`
          activeCompactionIdByLane.set(compactionLaneKey, compactionId)
          const parentForBlock = resolveParentForSubagentBlock(
            scopedSubagent,
            scopedParentToolCallId
          )
          ensureToolBlock({
            toolCallId: compactionId,
            toolName: 'context_compaction',
            calledBy: scopedSubagent,
            ...(parentForBlock ? { parentToolCallId: parentForBlock } : {}),
            ...spanIdentity,
            displayTitle: 'Compacting context...',
            state: 'executing',
          })
          continue
        }

        if (parsed.payload.kind === MothershipStreamV1RunKind.compaction_done) {
          const compactionId =
            activeCompactionIdByLane.get(compactionLaneKey) ?? `compaction_${entry.eventId}`
          activeCompactionIdByLane.delete(compactionLaneKey)
          const parentForBlock = resolveParentForSubagentBlock(
            scopedSubagent,
            scopedParentToolCallId
          )
          ensureToolBlock({
            toolCallId: compactionId,
            toolName: 'context_compaction',
            calledBy: scopedSubagent,
            ...(parentForBlock ? { parentToolCallId: parentForBlock } : {}),
            ...spanIdentity,
            displayTitle: 'Compacted context',
            state: MothershipStreamV1ToolOutcome.success,
          })
        }
        continue
      }
      case MothershipStreamV1EventType.error: {
        const tag = buildInlineErrorTag(parsed.payload)
        if (runningText.includes(tag)) {
          continue
        }
        const prefix = runningText.length > 0 && !runningText.endsWith('\n') ? '\n' : ''
        const content = `${prefix}${tag}`
        const errorParent = resolveParentForSubagentBlock(scopedSubagent, scopedParentToolCallId)
        appendTextBlock(blocks, content, {
          ...(scopedSubagent ? { lane: 'subagent' as const } : {}),
          ...(errorParent ? { parentToolCallId: errorParent } : {}),
          ...spanIdentity,
        })
        runningText += content
        continue
      }
      case MothershipStreamV1EventType.complete: {
        if (parsed.payload.status === MothershipStreamV1CompletionStatus.cancelled) {
          blocks.push({
            type: MothershipStreamV1EventType.complete,
            status: parsed.payload.status,
          })
        }
        continue
      }
      case MothershipStreamV1EventType.resource: {
        continue
      }
      default: {
        continue
      }
    }
  }

  if (blocks.length === 0 && !runningText && isTerminalStreamStatus(status)) {
    return null
  }

  return normalizeMessage({
    id: getLiveAssistantMessageId(streamId),
    role: 'assistant',
    content: runningText,
    timestamp: lastTimestamp ?? new Date().toISOString(),
    ...(requestId ? { requestId } : {}),
    ...(blocks.length > 0 ? { contentBlocks: blocks } : {}),
  })
}

export function buildEffectiveChatTranscript({
  messages,
  activeStreamId,
  streamSnapshot,
}: BuildEffectiveChatTranscriptParams): PersistedMessage[] {
  if (!activeStreamId || !streamSnapshot) {
    return messages
  }

  const trailingMessage = messages[messages.length - 1]
  if (
    !trailingMessage ||
    trailingMessage.role !== 'user' ||
    trailingMessage.id !== activeStreamId
  ) {
    return messages
  }

  const liveAssistant = buildLiveAssistantMessage({
    streamId: activeStreamId,
    events: streamSnapshot.events,
    status: streamSnapshot.status,
  })
  if (!liveAssistant) {
    return messages
  }

  return [...messages, liveAssistant]
}
