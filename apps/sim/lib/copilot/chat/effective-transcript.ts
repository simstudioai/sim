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
  MothershipStreamV1ToolOutcome,
  MothershipStreamV1ToolPhase,
} from '@/lib/copilot/generated/mothership-stream-v1'
import type { FilePreviewSession } from '@/lib/copilot/request/session/file-preview-session-contract'
import type { StreamBatchEvent } from '@/lib/copilot/request/session/types'

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function asPayloadRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined
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

function resolveToolDisplayTitle(ui: unknown): string | undefined {
  if (!isRecord(ui)) return undefined
  return typeof ui.title === 'string'
    ? ui.title
    : typeof ui.phaseLabel === 'string'
      ? ui.phaseLabel
      : undefined
}

function appendTextBlock(
  blocks: RawPersistedBlock[],
  content: string,
  options: {
    lane?: 'subagent'
  }
): void {
  if (!content) return
  const last = blocks[blocks.length - 1]
  if (last?.type === MothershipStreamV1EventType.text && last.lane === options.lane) {
    last.content = `${typeof last.content === 'string' ? last.content : ''}${content}`
    return
  }

  blocks.push({
    type: MothershipStreamV1EventType.text,
    ...(options.lane ? { lane: options.lane } : {}),
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
  let activeSubagent: string | undefined
  let activeSubagentParentToolCallId: string | undefined
  let activeCompactionId: string | undefined
  let runningText = ''
  let lastContentSource: 'main' | 'subagent' | null = null
  let requestId: string | undefined
  let lastTimestamp: string | undefined

  const resolveScopedSubagent = (
    agentId: string | undefined,
    parentToolCallId: string | undefined
  ): string | undefined => {
    if (agentId) return agentId
    if (parentToolCallId) {
      const scoped = subagentByParentToolCallId.get(parentToolCallId)
      if (scoped) return scoped
    }
    return activeSubagent
  }

  const ensureToolBlock = (input: {
    toolCallId: string
    toolName: string
    calledBy?: string
    displayTitle?: string
    params?: Record<string, unknown>
    result?: { success: boolean; output?: unknown; error?: string }
    state?: string
  }): RawPersistedBlock => {
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
        ...(input.calledBy ? { calledBy: input.calledBy } : {}),
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
    const scopedSubagent = resolveScopedSubagent(scopedAgentId, scopedParentToolCallId)

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
        const contentSource: 'main' | 'subagent' = scopedSubagent ? 'subagent' : 'main'
        const needsBoundaryNewline =
          lastContentSource !== null &&
          lastContentSource !== contentSource &&
          runningText.length > 0 &&
          !runningText.endsWith('\n')
        const normalizedChunk = needsBoundaryNewline ? `\n${chunk}` : chunk
        appendTextBlock(blocks, normalizedChunk, {
          ...(scopedSubagent ? { lane: 'subagent' as const } : {}),
        })
        runningText += normalizedChunk
        lastContentSource = contentSource
        continue
      }
      case MothershipStreamV1EventType.tool: {
        const payload = parsed.payload
        const toolCallId = payload.toolCallId
        const displayTitle = resolveToolDisplayTitle('ui' in payload ? payload.ui : undefined)

        if ('previewPhase' in payload) {
          continue
        }

        if (payload.phase === MothershipStreamV1ToolPhase.args_delta) {
          continue
        }

        if (payload.phase === MothershipStreamV1ToolPhase.result) {
          ensureToolBlock({
            toolCallId,
            toolName: payload.toolName,
            calledBy: scopedSubagent,
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
          displayTitle,
          params: isRecord(payload.arguments) ? payload.arguments : undefined,
          state: typeof payload.status === 'string' ? payload.status : 'executing',
        })
        continue
      }
      case MothershipStreamV1EventType.span: {
        if (parsed.payload.kind !== MothershipStreamV1SpanPayloadKind.subagent) {
          continue
        }

        const spanData = asPayloadRecord(parsed.payload.data)
        const parentToolCallId =
          scopedParentToolCallId ??
          (typeof spanData?.tool_call_id === 'string' ? spanData.tool_call_id : undefined)
        const name = typeof parsed.payload.agent === 'string' ? parsed.payload.agent : scopedAgentId
        if (parsed.payload.event === MothershipStreamV1SpanLifecycleEvent.start && name) {
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
          })
          continue
        }

        if (parsed.payload.event === MothershipStreamV1SpanLifecycleEvent.end) {
          if (spanData?.pending === true) {
            continue
          }
          if (parentToolCallId) {
            subagentByParentToolCallId.delete(parentToolCallId)
          }
          if (
            !parentToolCallId ||
            parentToolCallId === activeSubagentParentToolCallId ||
            name === activeSubagent
          ) {
            activeSubagent = undefined
            activeSubagentParentToolCallId = undefined
          }
          blocks.push({
            type: MothershipStreamV1EventType.span,
            kind: MothershipStreamV1SpanPayloadKind.subagent,
            lifecycle: MothershipStreamV1SpanLifecycleEvent.end,
          })
        }
        continue
      }
      case MothershipStreamV1EventType.run: {
        if (parsed.payload.kind === MothershipStreamV1RunKind.compaction_start) {
          activeCompactionId = `compaction_${entry.eventId}`
          ensureToolBlock({
            toolCallId: activeCompactionId,
            toolName: 'context_compaction',
            displayTitle: 'Compacting context...',
            state: 'executing',
          })
          continue
        }

        if (parsed.payload.kind === MothershipStreamV1RunKind.compaction_done) {
          const compactionId = activeCompactionId ?? `compaction_${entry.eventId}`
          activeCompactionId = undefined
          ensureToolBlock({
            toolCallId: compactionId,
            toolName: 'context_compaction',
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
        appendTextBlock(blocks, content, {
          ...(scopedSubagent ? { lane: 'subagent' as const } : {}),
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
