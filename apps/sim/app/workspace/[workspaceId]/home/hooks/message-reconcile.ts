/**
 * Persisted/live message reconciliation (revamp M6 extraction, behavior-preserving): the
 * pure helpers that map streamed content blocks onto persisted message shapes, decide
 * which persisted assistant row owns a live stream, and select replay state on reconnect —
 * moved verbatim out of use-chat.ts.
 */

import { isBrowserToolName } from '@sim/browser-protocol'
import type { PersistedMessage } from '@/lib/mothership/chat/persisted-message'
import { normalizeMessage, withBlockTiming } from '@/lib/mothership/chat/persisted-message'
import {
  MothershipStreamV1CompletionStatus,
  MothershipStreamV1EventType,
  MothershipStreamV1SpanLifecycleEvent,
  MothershipStreamV1SpanPayloadKind,
  MothershipStreamV1TextChannel,
  MothershipStreamV1ToolPhase,
} from '@/lib/mothership/generated/mothership-stream-v1'
import type { StreamBatchEvent } from '@/lib/mothership/request/session/types'
import { isWorkflowToolName } from '@/lib/mothership/tools/workflow-tools'
import type { MothershipChatHistory } from '@/hooks/queries/mothership-chats'
import type { ContentBlock } from '../types'
import { isZeroStreamCursor } from './stream-protocol'

export function toRawPersistedContentBlock(block: ContentBlock): Record<string, unknown> | null {
  const persisted = toRawPersistedContentBlockBody(block)
  if (!persisted) return null
  if (block.parentToolCallId) persisted.parentToolCallId = block.parentToolCallId
  // Carry deterministic span identity onto the live streaming snapshot so the
  // rendered live message nests subagents via the span tree. Without this the
  // live blocks lose spanId and parseBlocks falls back to legacy flat grouping,
  // rendering nested subagents (e.g. deploy) at the top level mid-stream until
  // the persisted message (which keeps spanId) replaces it.
  if (block.spanId) persisted.spanId = block.spanId
  if (block.parentSpanId) persisted.parentSpanId = block.parentSpanId
  return withBlockTiming(persisted, block)
}

function toRawPersistedContentBlockBody(block: ContentBlock): Record<string, unknown> | null {
  switch (block.type) {
    case 'text':
      return {
        type: MothershipStreamV1EventType.text,
        ...(block.subagent ? { lane: 'subagent' } : {}),
        channel: MothershipStreamV1TextChannel.assistant,
        content: block.content ?? '',
      }
    case 'thinking':
      return {
        type: MothershipStreamV1EventType.text,
        channel: MothershipStreamV1TextChannel.thinking,
        content: block.content ?? '',
      }
    case 'subagent_thinking':
      return {
        type: MothershipStreamV1EventType.text,
        lane: 'subagent',
        channel: MothershipStreamV1TextChannel.thinking,
        content: block.content ?? '',
        ...(block.subagent ? { agent: block.subagent } : {}),
      }
    case 'subagent_text':
      return {
        type: MothershipStreamV1EventType.text,
        lane: 'subagent',
        channel: MothershipStreamV1TextChannel.assistant,
        content: block.content ?? '',
        ...(block.subagent ? { agent: block.subagent } : {}),
      }
    case 'tool_call':
      if (!block.toolCall) {
        return null
      }
      return {
        type: MothershipStreamV1EventType.tool,
        phase: MothershipStreamV1ToolPhase.call,
        toolCall: {
          id: block.toolCall.id,
          name: block.toolCall.name,
          state: block.toolCall.status,
          ...(block.toolCall.params ? { params: block.toolCall.params } : {}),
          ...(block.toolCall.result ? { result: block.toolCall.result } : {}),
          ...(block.toolCall.calledBy ? { calledBy: block.toolCall.calledBy } : {}),
          ...(block.toolCall.displayTitle
            ? {
                display: {
                  title: block.toolCall.displayTitle,
                },
              }
            : {}),
        },
      }
    case 'subagent':
      return {
        type: MothershipStreamV1EventType.span,
        kind: MothershipStreamV1SpanPayloadKind.subagent,
        lifecycle: MothershipStreamV1SpanLifecycleEvent.start,
        content: block.content ?? '',
      }
    case 'subagent_end':
      return {
        type: MothershipStreamV1EventType.span,
        kind: MothershipStreamV1SpanPayloadKind.subagent,
        lifecycle: MothershipStreamV1SpanLifecycleEvent.end,
      }
    case 'stopped':
      return {
        type: MothershipStreamV1EventType.complete,
        status: MothershipStreamV1CompletionStatus.cancelled,
      }
    case 'task':
      return block.task ? { type: 'task', task: block.task } : null
    default:
      return null
  }
}

export function buildAssistantSnapshotMessage(params: {
  id: string
  content: string
  contentBlocks: ContentBlock[]
  requestId?: string
}): PersistedMessage {
  const rawContentBlocks = params.contentBlocks
    .map(toRawPersistedContentBlock)
    .filter((block): block is Record<string, unknown> => block !== null)

  return normalizeMessage({
    id: params.id,
    role: 'assistant',
    content: params.content,
    timestamp: new Date().toISOString(),
    ...(params.requestId ? { requestId: params.requestId } : {}),
    ...(rawContentBlocks.length > 0 ? { contentBlocks: rawContentBlocks } : {}),
  })
}

export function markMessageStopped(message: PersistedMessage): PersistedMessage {
  const hasExecutingTool = message.contentBlocks?.some(
    (block) => block.toolCall?.state === 'executing'
  )
  const hasOpenBlock = message.contentBlocks?.some((block) => block.endedAt === undefined)
  if (!hasExecutingTool && !hasOpenBlock) {
    return message
  }

  const stopTs = Date.now()
  const nextBlocks = (message.contentBlocks ?? []).map((block) => {
    const stamped = block.endedAt === undefined ? { ...block, endedAt: stopTs } : block
    if (stamped.toolCall?.state !== 'executing') {
      return stamped
    }
    return {
      ...stamped,
      toolCall: {
        ...stamped.toolCall,
        state: 'cancelled' as const,
        display: {
          ...(stamped.toolCall.display ?? {}),
          title: 'Stopped by user',
        },
      },
    }
  })

  if (
    !nextBlocks.some(
      (block) =>
        block.type === MothershipStreamV1EventType.complete &&
        block.status === MothershipStreamV1CompletionStatus.cancelled
    )
  ) {
    nextBlocks.push({
      type: MothershipStreamV1EventType.complete,
      status: MothershipStreamV1CompletionStatus.cancelled,
    })
  }

  return normalizeMessage({
    ...message,
    contentBlocks: nextBlocks,
  })
}

export function buildChatHistoryHydrationKey(chatHistory: MothershipChatHistory): string {
  const resourceKey = chatHistory.resources
    .map((resource) => `${resource.type}:${resource.id}:${resource.title}`)
    .join('|')
  const messageKey = chatHistory.messages.map((message) => message.id).join('|')
  const streamSnapshot = chatHistory.streamSnapshot
  const snapshotKey = streamSnapshot
    ? [
        streamSnapshot.status,
        streamSnapshot.events.length,
        streamSnapshot.events[streamSnapshot.events.length - 1]?.eventId ?? '',
        streamSnapshot.previewSessions
          .map(
            (session) =>
              `${session.id}:${session.previewVersion}:${session.status}:${session.updatedAt}`
          )
          .join('|'),
      ].join('~')
    : 'none'

  return [
    chatHistory.id,
    chatHistory.activeStreamId ?? '',
    messageKey,
    resourceKey,
    snapshotKey,
  ].join('::')
}

export function isPersistedAssistantMessage(
  message: PersistedMessage,
  liveAssistantId: string
): boolean {
  return (
    message.role === 'assistant' &&
    message.id !== liveAssistantId &&
    !message.id.startsWith('live-assistant:')
  )
}

export function findStreamOwnerIndex(messages: PersistedMessage[], streamId: string): number {
  return messages.findIndex((message) => message.role === 'user' && message.id === streamId)
}

export function findAssistantAfterOwner(messages: PersistedMessage[], ownerIndex: number): number {
  for (let index = ownerIndex + 1; index < messages.length; index++) {
    const message = messages[index]
    if (message.role === 'user') return -1
    if (message.role === 'assistant') return index
  }
  return -1
}

export function hasTerminalPersistedAssistantForStream(
  messages: PersistedMessage[],
  streamId: string,
  liveAssistantId: string
): boolean {
  const ownerIndex = findStreamOwnerIndex(messages, streamId)
  if (ownerIndex === -1) return false

  const assistantIndex = findAssistantAfterOwner(messages, ownerIndex)
  if (assistantIndex === -1) return false

  return isPersistedAssistantMessage(messages[assistantIndex], liveAssistantId)
}

export function reconcileLiveAssistantTurn(params: {
  messages: PersistedMessage[]
  streamId: string
  liveAssistant: PersistedMessage
  activeStreamId: string | null
}): PersistedMessage[] {
  const { messages, streamId, liveAssistant, activeStreamId } = params
  const ownerIndex = findStreamOwnerIndex(messages, streamId)
  if (ownerIndex === -1) {
    return [...messages.filter((message) => message.id !== liveAssistant.id), liveAssistant]
  }

  const assistantIndex = findAssistantAfterOwner(messages, ownerIndex)
  const existingAssistant = assistantIndex >= 0 ? messages[assistantIndex] : undefined
  if (
    activeStreamId !== streamId &&
    existingAssistant &&
    isPersistedAssistantMessage(existingAssistant, liveAssistant.id)
  ) {
    const withoutStaleLiveAssistant = messages.filter((message) => message.id !== liveAssistant.id)
    return withoutStaleLiveAssistant.length === messages.length
      ? messages
      : withoutStaleLiveAssistant
  }

  const withoutDuplicateLiveAssistant = messages.filter(
    (message, index) => index === assistantIndex || message.id !== liveAssistant.id
  )
  const adjustedOwnerIndex = withoutDuplicateLiveAssistant.findIndex(
    (message) => message.role === 'user' && message.id === streamId
  )
  const adjustedAssistantIndex =
    adjustedOwnerIndex >= 0
      ? findAssistantAfterOwner(withoutDuplicateLiveAssistant, adjustedOwnerIndex)
      : -1

  if (adjustedAssistantIndex >= 0) {
    return withoutDuplicateLiveAssistant.map((message, index) =>
      index === adjustedAssistantIndex ? liveAssistant : message
    )
  }

  if (adjustedOwnerIndex >= 0) {
    return [
      ...withoutDuplicateLiveAssistant.slice(0, adjustedOwnerIndex + 1),
      liveAssistant,
      ...withoutDuplicateLiveAssistant.slice(adjustedOwnerIndex + 1),
    ]
  }

  return [...withoutDuplicateLiveAssistant, liveAssistant]
}

export interface ReconnectReplaySelection {
  afterCursor: string
  preserveExistingState: boolean
  source: 'live' | 'reset'
}

/**
 * Decides how a reconnect replay starts. The only state a resumed stream may
 * continue from is the live in-memory pair (streaming refs + lastCursorRef)
 * maintained together by this mount's stream loop — those are coherent by
 * construction. Anything else (fresh mount, cleared refs, cache-derived
 * transcripts) replays the Redis buffer from seq 0 into a fresh model: the
 * buffer is the source of truth for an in-flight turn and replay is
 * idempotent, so a full rebuild is always safe. Seeding the model from a
 * cached transcript paired stale content with a newer cursor, which dropped
 * replayed events and rendered empty or suffix-only messages.
 */
export function selectReconnectReplayState(params: {
  afterCursor: string
  currentContent: string
  currentBlocks: ContentBlock[]
}): ReconnectReplaySelection {
  const { afterCursor, currentContent, currentBlocks } = params
  const hasLiveState = currentContent.length > 0 || currentBlocks.length > 0
  if (!isZeroStreamCursor(afterCursor) && hasLiveState) {
    return { afterCursor, preserveExistingState: true, source: 'live' }
  }
  return { afterCursor: '0', preserveExistingState: false, source: 'reset' }
}

export function getReplayCompletedWorkflowToolCallIds(events: StreamBatchEvent[]): Set<string> {
  const completedToolCallIds = new Set<string>()
  for (const entry of events) {
    const event = entry.event
    if (event.type !== MothershipStreamV1EventType.tool) continue
    const payload = event.payload
    if (!('phase' in payload)) continue
    if (payload.phase !== MothershipStreamV1ToolPhase.result) continue
    // Client-executed tools (workflow runs, browser actions) must never
    // re-fire when their completed call replays after reconnect/reload.
    if (
      typeof payload.toolCallId === 'string' &&
      (isWorkflowToolName(payload.toolName) || isBrowserToolName(payload.toolName))
    ) {
      completedToolCallIds.add(payload.toolCallId)
    }
  }
  return completedToolCallIds
}
