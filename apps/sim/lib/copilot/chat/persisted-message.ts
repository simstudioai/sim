import { generateId } from '@sim/utils/id'
import {
  MothershipStreamV1CompletionStatus,
  MothershipStreamV1EventType,
  MothershipStreamV1SpanLifecycleEvent,
  MothershipStreamV1SpanPayloadKind,
  type MothershipStreamV1StreamScope,
  MothershipStreamV1TextChannel,
  MothershipStreamV1ToolOutcome,
  MothershipStreamV1ToolPhase,
} from '@/lib/copilot/generated/mothership-stream-v1'
import type {
  ContentBlock,
  LocalToolCallStatus,
  OrchestratorResult,
} from '@/lib/copilot/request/types'

export type PersistedToolState = LocalToolCallStatus | MothershipStreamV1ToolOutcome

export interface PersistedToolCall {
  id: string
  name: string
  state: PersistedToolState
  params?: Record<string, unknown>
  result?: { success: boolean; output?: unknown; error?: string }
  error?: string
  calledBy?: string
  durationMs?: number
  display?: { title?: string }
}

export interface PersistedContentBlock {
  type: MothershipStreamV1EventType
  lane?: MothershipStreamV1StreamScope['lane']
  channel?: MothershipStreamV1TextChannel
  phase?: MothershipStreamV1ToolPhase
  kind?: MothershipStreamV1SpanPayloadKind
  lifecycle?: MothershipStreamV1SpanLifecycleEvent
  status?: MothershipStreamV1CompletionStatus
  content?: string
  toolCall?: PersistedToolCall
  timestamp?: number
  endedAt?: number
  parentToolCallId?: string
}

export interface PersistedFileAttachment {
  id: string
  key: string
  filename: string
  media_type: string
  size: number
}

export interface PersistedMessageContext {
  kind: string
  label: string
  workflowId?: string
  knowledgeId?: string
  tableId?: string
  fileId?: string
  folderId?: string
  chatId?: string
}

export interface PersistedMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
  requestId?: string
  contentBlocks?: PersistedContentBlock[]
  fileAttachments?: PersistedFileAttachment[]
  contexts?: PersistedMessageContext[]
}

// ---------------------------------------------------------------------------
// Write: OrchestratorResult → PersistedMessage
// ---------------------------------------------------------------------------

function resolveToolState(block: ContentBlock): PersistedToolState {
  const tc = block.toolCall
  if (!tc) return 'pending'
  if (tc.result?.success !== undefined) {
    return tc.result.success
      ? MothershipStreamV1ToolOutcome.success
      : MothershipStreamV1ToolOutcome.error
  }
  return tc.status as PersistedToolState
}

/**
 * Copy `timestamp` / `endedAt` from a source object onto a target object.
 * Shared by every block mapper (persist, display, snapshot) so the timing
 * metadata that drives the `Thought for Ns` chip survives the full
 * persist → normalize → display round-trip — and one rule lives in one place.
 */
export function withBlockTiming<T>(target: T, src: { timestamp?: number; endedAt?: number }): T {
  const writable = target as { timestamp?: number; endedAt?: number }
  if (typeof src.timestamp === 'number') writable.timestamp = src.timestamp
  if (typeof src.endedAt === 'number') writable.endedAt = src.endedAt
  return target
}

function withBlockParent<T>(target: T, src: { parentToolCallId?: string }): T {
  if (src.parentToolCallId) {
    ;(target as { parentToolCallId?: string }).parentToolCallId = src.parentToolCallId
  }
  return target
}

function mapContentBlock(block: ContentBlock): PersistedContentBlock {
  const persisted = mapContentBlockBody(block)
  return withBlockParent(withBlockTiming(persisted, block), block)
}

function mapContentBlockBody(block: ContentBlock): PersistedContentBlock {
  switch (block.type) {
    case 'text':
      return {
        type: MothershipStreamV1EventType.text,
        channel: MothershipStreamV1TextChannel.assistant,
        content: block.content,
      }
    case 'thinking':
      return {
        type: MothershipStreamV1EventType.text,
        channel: MothershipStreamV1TextChannel.thinking,
        content: block.content,
      }
    case 'subagent':
      return {
        type: MothershipStreamV1EventType.span,
        kind: MothershipStreamV1SpanPayloadKind.subagent,
        lifecycle: MothershipStreamV1SpanLifecycleEvent.start,
        content: block.content,
      }
    case 'subagent_text':
      return {
        type: MothershipStreamV1EventType.text,
        lane: 'subagent',
        channel: MothershipStreamV1TextChannel.assistant,
        content: block.content,
      }
    case 'subagent_thinking':
      return {
        type: MothershipStreamV1EventType.text,
        lane: 'subagent',
        channel: MothershipStreamV1TextChannel.thinking,
        content: block.content,
      }
    case 'tool_call': {
      if (!block.toolCall) {
        return {
          type: MothershipStreamV1EventType.tool,
          phase: MothershipStreamV1ToolPhase.call,
          content: block.content,
        }
      }
      const state = resolveToolState(block)
      const isSubagentTool = !!block.calledBy
      const isNonTerminal =
        state === MothershipStreamV1ToolOutcome.cancelled ||
        state === 'pending' ||
        state === 'executing'

      const toolCall: PersistedToolCall = {
        id: block.toolCall.id,
        name: block.toolCall.name,
        state,
        ...(isSubagentTool && isNonTerminal ? {} : { result: block.toolCall.result }),
        ...(isSubagentTool && isNonTerminal
          ? {}
          : block.toolCall.params
            ? { params: block.toolCall.params }
            : {}),
        ...(block.calledBy ? { calledBy: block.calledBy } : {}),
        ...(block.toolCall.displayTitle
          ? {
              display: {
                title: block.toolCall.displayTitle,
              },
            }
          : {}),
      }

      return {
        type: MothershipStreamV1EventType.tool,
        phase: MothershipStreamV1ToolPhase.call,
        toolCall,
      }
    }
    default:
      return { type: MothershipStreamV1EventType.text, content: block.content }
  }
}

export function buildPersistedAssistantMessage(
  result: OrchestratorResult,
  requestId?: string
): PersistedMessage {
  const message: PersistedMessage = {
    id: generateId(),
    role: 'assistant',
    content: result.content,
    timestamp: new Date().toISOString(),
  }

  if (requestId || result.requestId) {
    message.requestId = requestId || result.requestId
  }

  if (result.contentBlocks.length > 0) {
    message.contentBlocks = result.contentBlocks.map(mapContentBlock)
  }

  return message
}

export interface UserMessageParams {
  id: string
  content: string
  fileAttachments?: PersistedFileAttachment[]
  contexts?: PersistedMessageContext[]
}

export function buildPersistedUserMessage(params: UserMessageParams): PersistedMessage {
  const message: PersistedMessage = {
    id: params.id,
    role: 'user',
    content: params.content,
    timestamp: new Date().toISOString(),
  }

  if (params.fileAttachments && params.fileAttachments.length > 0) {
    message.fileAttachments = params.fileAttachments
  }

  if (params.contexts && params.contexts.length > 0) {
    message.contexts = params.contexts.map((c) => ({
      kind: c.kind,
      label: c.label,
      ...(c.workflowId ? { workflowId: c.workflowId } : {}),
      ...(c.knowledgeId ? { knowledgeId: c.knowledgeId } : {}),
      ...(c.tableId ? { tableId: c.tableId } : {}),
      ...(c.fileId ? { fileId: c.fileId } : {}),
      ...(c.folderId ? { folderId: c.folderId } : {}),
      ...(c.chatId ? { chatId: c.chatId } : {}),
    }))
  }

  return message
}

// ---------------------------------------------------------------------------
// Read: raw JSONB → PersistedMessage
// Handles both canonical (type: 'tool', 'text', 'span', 'complete') and
// legacy (type: 'tool_call', 'thinking', 'subagent', 'stopped') blocks.
// ---------------------------------------------------------------------------

const CANONICAL_BLOCK_TYPES: Set<string> = new Set(Object.values(MothershipStreamV1EventType))

interface RawBlock {
  type: string
  lane?: string
  content?: string
  /** Go persists text blocks with key "text" instead of "content" */
  text?: string
  channel?: string
  phase?: string
  kind?: string
  lifecycle?: string
  status?: string
  timestamp?: number
  endedAt?: number
  parentToolCallId?: string
  toolCall?: {
    id?: string
    name?: string
    state?: string
    params?: Record<string, unknown>
    result?: { success: boolean; output?: unknown; error?: string }
    display?: { text?: string; title?: string; phaseLabel?: string }
    calledBy?: string
    durationMs?: number
    error?: string
  } | null
}

interface LegacyToolCall {
  id: string
  name: string
  status: string
  params?: Record<string, unknown>
  result?: unknown
  error?: string
  durationMs?: number
}

const OUTCOME_NORMALIZATION: Record<string, PersistedToolState> = {
  [MothershipStreamV1ToolOutcome.success]: MothershipStreamV1ToolOutcome.success,
  [MothershipStreamV1ToolOutcome.error]: MothershipStreamV1ToolOutcome.error,
  [MothershipStreamV1ToolOutcome.cancelled]: MothershipStreamV1ToolOutcome.cancelled,
  [MothershipStreamV1ToolOutcome.skipped]: MothershipStreamV1ToolOutcome.skipped,
  [MothershipStreamV1ToolOutcome.rejected]: MothershipStreamV1ToolOutcome.rejected,
  pending: 'pending',
  executing: 'executing',
}

function normalizeToolState(state: string | undefined): PersistedToolState {
  if (!state) return 'pending'
  return OUTCOME_NORMALIZATION[state] ?? MothershipStreamV1ToolOutcome.error
}

function isCanonicalBlock(block: RawBlock): boolean {
  return CANONICAL_BLOCK_TYPES.has(block.type)
}

function normalizeCanonicalBlock(block: RawBlock): PersistedContentBlock {
  const result: PersistedContentBlock = {
    type: block.type as MothershipStreamV1EventType,
  }
  if (block.lane === 'subagent') {
    result.lane = block.lane
  }
  const blockContent = block.content ?? block.text
  if (blockContent !== undefined) result.content = blockContent
  if (block.channel) result.channel = block.channel as MothershipStreamV1TextChannel
  if (block.phase) result.phase = block.phase as MothershipStreamV1ToolPhase
  if (block.kind) result.kind = block.kind as MothershipStreamV1SpanPayloadKind
  if (block.lifecycle) result.lifecycle = block.lifecycle as MothershipStreamV1SpanLifecycleEvent
  if (block.status) result.status = block.status as MothershipStreamV1CompletionStatus
  if (block.parentToolCallId) result.parentToolCallId = block.parentToolCallId
  if (block.toolCall) {
    result.toolCall = {
      id: block.toolCall.id ?? '',
      name: block.toolCall.name ?? '',
      state: normalizeToolState(block.toolCall.state),
      ...(block.toolCall.params ? { params: block.toolCall.params } : {}),
      ...(block.toolCall.result ? { result: block.toolCall.result } : {}),
      ...(block.toolCall.calledBy ? { calledBy: block.toolCall.calledBy } : {}),
      ...(block.toolCall.error ? { error: block.toolCall.error } : {}),
      ...(block.toolCall.durationMs ? { durationMs: block.toolCall.durationMs } : {}),
      ...(block.toolCall.display
        ? {
            display: {
              title:
                block.toolCall.display.title ??
                block.toolCall.display.text ??
                block.toolCall.display.phaseLabel,
            },
          }
        : {}),
    }
  }
  return result
}

function normalizeLegacyBlock(block: RawBlock): PersistedContentBlock {
  if (block.type === 'tool_call' && block.toolCall) {
    return {
      type: MothershipStreamV1EventType.tool,
      phase: MothershipStreamV1ToolPhase.call,
      toolCall: {
        id: block.toolCall.id ?? '',
        name: block.toolCall.name ?? '',
        state: normalizeToolState(block.toolCall.state),
        ...(block.toolCall.params ? { params: block.toolCall.params } : {}),
        ...(block.toolCall.result ? { result: block.toolCall.result } : {}),
        ...(block.toolCall.calledBy ? { calledBy: block.toolCall.calledBy } : {}),
        ...(block.toolCall.display
          ? {
              display: {
                title:
                  block.toolCall.display.title ??
                  block.toolCall.display.text ??
                  block.toolCall.display.phaseLabel,
              },
            }
          : {}),
      },
    }
  }

  if (block.type === 'thinking') {
    return {
      type: MothershipStreamV1EventType.text,
      channel: MothershipStreamV1TextChannel.thinking,
      content: block.content,
    }
  }

  if (block.type === 'subagent' || block.type === 'subagent_text') {
    if (block.type === 'subagent_text') {
      return {
        type: MothershipStreamV1EventType.text,
        lane: 'subagent',
        channel: MothershipStreamV1TextChannel.assistant,
        content: block.content,
      }
    }
    return {
      type: MothershipStreamV1EventType.span,
      kind: MothershipStreamV1SpanPayloadKind.subagent,
      lifecycle: MothershipStreamV1SpanLifecycleEvent.start,
      content: block.content,
    }
  }

  if (block.type === 'subagent_thinking') {
    return {
      type: MothershipStreamV1EventType.text,
      lane: 'subagent',
      channel: MothershipStreamV1TextChannel.thinking,
      content: block.content,
    }
  }

  if (block.type === 'subagent_end') {
    return {
      type: MothershipStreamV1EventType.span,
      kind: MothershipStreamV1SpanPayloadKind.subagent,
      lifecycle: MothershipStreamV1SpanLifecycleEvent.end,
    }
  }

  if (block.type === 'stopped') {
    return {
      type: MothershipStreamV1EventType.complete,
      status: MothershipStreamV1CompletionStatus.cancelled,
    }
  }

  return {
    type: MothershipStreamV1EventType.text,
    channel: MothershipStreamV1TextChannel.assistant,
    content: block.content ?? block.text,
  }
}

function normalizeBlock(block: RawBlock): PersistedContentBlock {
  const result = isCanonicalBlock(block)
    ? normalizeCanonicalBlock(block)
    : normalizeLegacyBlock(block)
  if (typeof block.timestamp === 'number' && result.timestamp === undefined) {
    result.timestamp = block.timestamp
  }
  if (typeof block.endedAt === 'number' && result.endedAt === undefined) {
    result.endedAt = block.endedAt
  }
  if (block.parentToolCallId && result.parentToolCallId === undefined) {
    result.parentToolCallId = block.parentToolCallId
  }
  return result
}

function normalizeLegacyToolCall(tc: LegacyToolCall): PersistedContentBlock {
  const state = normalizeToolState(tc.status)
  return {
    type: MothershipStreamV1EventType.tool,
    phase: MothershipStreamV1ToolPhase.call,
    toolCall: {
      id: tc.id,
      name: tc.name,
      state,
      ...(tc.params ? { params: tc.params } : {}),
      ...(tc.result != null
        ? {
            result: {
              success: tc.status === MothershipStreamV1ToolOutcome.success,
              output: tc.result,
              ...(tc.error ? { error: tc.error } : {}),
            },
          }
        : {}),
      ...(tc.durationMs ? { durationMs: tc.durationMs } : {}),
    },
  }
}

function blocksContainTools(blocks: RawBlock[]): boolean {
  return blocks.some((b) => b.type === 'tool_call' || b.type === MothershipStreamV1EventType.tool)
}

function normalizeBlocks(rawBlocks: RawBlock[], messageContent: string): PersistedContentBlock[] {
  const blocks = rawBlocks.map(normalizeBlock)
  const hasAssistantText = blocks.some(
    (b) =>
      b.type === MothershipStreamV1EventType.text &&
      b.channel !== MothershipStreamV1TextChannel.thinking &&
      b.content?.trim()
  )
  if (!hasAssistantText && messageContent.trim()) {
    blocks.push({
      type: MothershipStreamV1EventType.text,
      channel: MothershipStreamV1TextChannel.assistant,
      content: messageContent,
    })
  }
  return blocks
}

export function normalizeMessage(raw: Record<string, unknown>): PersistedMessage {
  const msg: PersistedMessage = {
    id: (raw.id as string) ?? generateId(),
    role: (raw.role as 'user' | 'assistant') ?? 'assistant',
    content: (raw.content as string) ?? '',
    timestamp: (raw.timestamp as string) ?? new Date().toISOString(),
  }

  if (raw.requestId && typeof raw.requestId === 'string') {
    msg.requestId = raw.requestId
  }

  const rawBlocks = raw.contentBlocks as RawBlock[] | undefined
  const rawToolCalls = raw.toolCalls as LegacyToolCall[] | undefined
  const hasBlocks = Array.isArray(rawBlocks) && rawBlocks.length > 0
  const hasToolCalls = Array.isArray(rawToolCalls) && rawToolCalls.length > 0

  if (hasBlocks) {
    msg.contentBlocks = normalizeBlocks(rawBlocks!, msg.content)
    const contentBlocksAlreadyContainTools = blocksContainTools(rawBlocks!)
    if (hasToolCalls && !contentBlocksAlreadyContainTools) {
      msg.contentBlocks.push(...rawToolCalls!.map(normalizeLegacyToolCall))
    }
  } else if (hasToolCalls) {
    msg.contentBlocks = rawToolCalls!.map(normalizeLegacyToolCall)
    if (msg.content.trim()) {
      msg.contentBlocks.push({
        type: MothershipStreamV1EventType.text,
        channel: MothershipStreamV1TextChannel.assistant,
        content: msg.content,
      })
    }
  }

  const rawAttachments = raw.fileAttachments as PersistedFileAttachment[] | undefined
  if (Array.isArray(rawAttachments) && rawAttachments.length > 0) {
    msg.fileAttachments = rawAttachments
  }

  const rawContexts = raw.contexts as PersistedMessageContext[] | undefined
  if (Array.isArray(rawContexts) && rawContexts.length > 0) {
    msg.contexts = rawContexts.map((c) => ({
      kind: c.kind,
      label: c.label,
      ...(c.workflowId ? { workflowId: c.workflowId } : {}),
      ...(c.knowledgeId ? { knowledgeId: c.knowledgeId } : {}),
      ...(c.tableId ? { tableId: c.tableId } : {}),
      ...(c.fileId ? { fileId: c.fileId } : {}),
      ...(c.folderId ? { folderId: c.folderId } : {}),
      ...(c.chatId ? { chatId: c.chatId } : {}),
    }))
  }

  return msg
}
