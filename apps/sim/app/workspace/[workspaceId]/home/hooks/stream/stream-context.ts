import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type { QueryClient } from '@tanstack/react-query'
import type { PersistedMessage } from '@/lib/copilot/chat/persisted-message'
import type { RevealedSimKeysByMessage } from '@/lib/copilot/chat/sim-key-redaction'
import { captureRevealedSimKeys } from '@/lib/copilot/chat/sim-key-redaction'
import type { MothershipStreamV1ErrorPayload } from '@/lib/copilot/generated/mothership-stream-v1'
import type { SyntheticFilePreviewPayload } from '@/lib/copilot/request/session'
import type { FilePreviewSession } from '@/lib/copilot/request/session/file-preview-session-contract'
import type { ToolResultPhasePayload } from '@/app/workspace/[workspaceId]/home/hooks/stream/stream-helpers'
import type {
  ChatMessage,
  ContentBlock,
  MothershipResource,
  MothershipResourceType,
} from '@/app/workspace/[workspaceId]/home/types'
import type { MothershipChatHistory } from '@/hooks/queries/mothership-chats'

export type ActiveTurn = {
  userMessageId: string
  assistantMessageId: string
  optimisticUserMessage: ChatMessage
  optimisticAssistantMessage: ChatMessage
}

export interface StreamLoopOptions {
  preserveExistingState?: boolean
  suppressedWorkflowToolStartIds?: ReadonlySet<string>
  targetChatId?: string
  shouldContinue?: () => boolean
}

export interface StreamLoopState {
  blocks: ContentBlock[]
  toolMap: Map<string, number>
  toolArgsMap: Map<string, Record<string, unknown>>
  subagentByParentToolCallId: Map<string, string>
  subagentBySpanId: Map<string, string>
  pendingToolResults: Map<string, ToolResultPhasePayload>
  runningText: string
  lastContentSource: 'main' | 'subagent' | null
  streamRequestId: string | undefined
  activeSubagent: string | undefined
  activeSubagentParentToolCallId: string | undefined
  activeCompactionId: string | undefined
  sawStreamError: boolean
  sawCompleteEvent: boolean
  scheduledTextFlushFrame: number | null
}

export interface StreamEventScope {
  scopedSubagent: string | undefined
  scopedParentToolCallId: string | undefined
  scopedAgentId: string | undefined
  scopedSpanId: string | undefined
  scopedParentSpanId: string | undefined
  spanIdentity: { spanId?: string; parentSpanId?: string }
}

type SpanIdentity = { spanId?: string; parentSpanId?: string }

export interface StreamLoopDeps {
  workspaceId: string
  queryClient: QueryClient
  assistantId: string
  expectedGen: number | undefined
  options: StreamLoopOptions

  setError: Dispatch<SetStateAction<string | null>>
  setPendingMessages: Dispatch<SetStateAction<ChatMessage[]>>
  setResolvedChatId: Dispatch<SetStateAction<string | undefined>>
  setResources: Dispatch<SetStateAction<MothershipResource[]>>
  setActiveResourceId: Dispatch<SetStateAction<string | null>>

  addResource: (resource: MothershipResource) => boolean
  removeResource: (resourceType: MothershipResourceType, resourceId: string) => void
  startClientWorkflowTool: (id: string, name: string, args: Record<string, unknown>) => void
  upsertMothershipChatHistory: (
    chatId: string,
    updater: (current: MothershipChatHistory) => MothershipChatHistory
  ) => void
  ensureWorkflowInRegistry: (resourceId: string, title: string, workspaceId: string) => boolean

  onPreviewPhase: (payload: SyntheticFilePreviewPayload, streamId: string | undefined) => void
  applyPreviewSessionUpdate: (
    session: FilePreviewSession,
    options?: { activate?: boolean }
  ) => unknown
  removePreviewSessionImmediate: (sessionId: string) => unknown
  promoteFileResource: (fileId: string, title: string) => void
  shouldAutoActivatePreviewSession: (session: FilePreviewSession) => boolean

  buildAssistantSnapshotMessage: (params: {
    id: string
    content: string
    contentBlocks: ContentBlock[]
    requestId?: string
  }) => PersistedMessage
  hasTerminalPersistedAssistantForStream: (
    messages: PersistedMessage[],
    streamId: string,
    liveAssistantId: string
  ) => boolean
  reconcileLiveAssistantTurn: (params: {
    messages: PersistedMessage[]
    streamId: string
    liveAssistant: PersistedMessage
    activeStreamId: string | null
  }) => PersistedMessage[]

  streamGenRef: MutableRefObject<number>
  streamingBlocksRef: MutableRefObject<ContentBlock[]>
  streamingContentRef: MutableRefObject<string>
  chatIdRef: MutableRefObject<string | undefined>
  selectedChatIdRef: MutableRefObject<string | undefined>
  streamIdRef: MutableRefObject<string | undefined>
  revealedSimKeysRef: MutableRefObject<RevealedSimKeysByMessage>
  pendingUserMsgRef: MutableRefObject<PersistedMessage | null>
  activeTurnRef: MutableRefObject<ActiveTurn | null>
  resourcesRef: MutableRefObject<MothershipResource[]>
  workflowIdRef: MutableRefObject<string | undefined>
  activeResourceIdRef: MutableRefObject<string | null>
  onTitleUpdateRef: MutableRefObject<(() => void) | undefined>
  onToolResultRef: MutableRefObject<
    ((toolName: string, success: boolean, result: unknown) => void) | undefined
  >
  onResourceEventRef: MutableRefObject<(() => void) | undefined>
  previewSessionRef: MutableRefObject<FilePreviewSession | null>
  previewSessionsRef: MutableRefObject<Record<string, FilePreviewSession>>
  latestPreviewTargetToolCallIdRef: MutableRefObject<string | null>
  activePreviewSessionIdRef: MutableRefObject<string | null>
  completedPreviewResourceHandoffRef: MutableRefObject<
    Map<string, { sessionId: string; suppressActivation: boolean }>
  >
  previewActivationOwnerRef: MutableRefObject<Map<string, string | null>>
}

export interface StreamLoopOps {
  isStale: () => boolean
  toEventMs: (ts: string | undefined) => number
  stampBlockEnd: (block: ContentBlock | undefined, ts?: string) => void
  ensureTextBlock: (
    subagentName: string | undefined,
    parentToolCallId: string | undefined,
    ts?: string,
    identity?: SpanIdentity
  ) => ContentBlock
  ensureThinkingBlock: (
    subagentName: string | undefined,
    parentToolCallId: string | undefined,
    ts?: string,
    identity?: SpanIdentity
  ) => ContentBlock
  resolveScopedSubagent: (
    agentId: string | undefined,
    parentToolCallId: string | undefined,
    spanId?: string
  ) => string | undefined
  resolveParentForSubagentBlock: (
    subagent: string | undefined,
    scopedParent: string | undefined
  ) => string | undefined
  appendInlineErrorTag: (
    tag: string,
    subagentName?: string,
    parentToolCallId?: string,
    ts?: string
  ) => void
  buildInlineErrorTag: (payload: MothershipStreamV1ErrorPayload) => string
  flush: () => void
  flushText: () => void
}

export interface StreamLoopContext {
  state: StreamLoopState
  ops: StreamLoopOps
  deps: StreamLoopDeps
}

/**
 * Builds the per-stream context for `processSSEStream`: the mutable accumulation
 * state, the bound operations the event handlers share (block builders, `flush`,
 * staleness), and the injected hook dependencies. A fresh context is created per
 * stream invocation so overlapping/superseded streams never cross-write state;
 * `isStale` carries the exact generation + `shouldContinue` guard, and the
 * `preserveExistingState` reconnect path rehydrates blocks, the tool index, and
 * the subagent indexes from the supplied refs.
 */
export function createStreamLoopContext(deps: StreamLoopDeps): StreamLoopContext {
  const preserveState = deps.options.preserveExistingState === true

  const state: StreamLoopState = {
    blocks: preserveState ? [...deps.streamingBlocksRef.current] : [],
    toolMap: new Map<string, number>(),
    toolArgsMap: new Map<string, Record<string, unknown>>(),
    subagentByParentToolCallId: new Map<string, string>(),
    subagentBySpanId: new Map<string, string>(),
    pendingToolResults: new Map<string, ToolResultPhasePayload>(),
    runningText: preserveState ? deps.streamingContentRef.current || '' : '',
    lastContentSource: null,
    streamRequestId: undefined,
    activeSubagent: undefined,
    activeSubagentParentToolCallId: undefined,
    activeCompactionId: undefined,
    sawStreamError: false,
    sawCompleteEvent: false,
    scheduledTextFlushFrame: null,
  }

  const isStale = () =>
    (deps.expectedGen !== undefined && deps.streamGenRef.current !== deps.expectedGen) ||
    deps.options.shouldContinue?.() === false

  if (preserveState) {
    for (let i = 0; i < state.blocks.length; i++) {
      const tc = state.blocks[i].toolCall
      if (tc) {
        state.toolMap.set(tc.id, i)
        if (tc.params) state.toolArgsMap.set(tc.id, tc.params)
      }
    }
    for (const block of state.blocks) {
      if (block.type === 'subagent' && block.spanId && block.content) {
        state.subagentBySpanId.set(block.spanId, block.content)
      }
    }
    for (let i = state.blocks.length - 1; i >= 0; i--) {
      if (state.blocks[i].type === 'subagent' && state.blocks[i].content) {
        state.activeSubagent = state.blocks[i].content
        state.activeSubagentParentToolCallId = state.blocks[i].parentToolCallId
        break
      }
      if (state.blocks[i].type === 'subagent_end') {
        break
      }
    }
  } else if (!isStale()) {
    deps.streamingContentRef.current = ''
    deps.streamingBlocksRef.current = []
  }

  const toEventMs = (ts: string | undefined): number => {
    if (ts) {
      const parsed = Date.parse(ts)
      if (Number.isFinite(parsed)) return parsed
    }
    return Date.now()
  }

  const stampBlockEnd = (block: ContentBlock | undefined, ts?: string) => {
    if (block && block.endedAt === undefined) block.endedAt = toEventMs(ts)
  }

  const ensureTextBlock = (
    subagentName: string | undefined,
    parentToolCallId: string | undefined,
    ts?: string,
    identity?: SpanIdentity
  ): ContentBlock => {
    const last = state.blocks[state.blocks.length - 1]
    if (
      last?.type === 'text' &&
      last.subagent === subagentName &&
      last.parentToolCallId === parentToolCallId &&
      last.spanId === identity?.spanId
    ) {
      return last
    }
    stampBlockEnd(last, ts)
    const b: ContentBlock = { type: 'text', content: '', timestamp: toEventMs(ts) }
    if (subagentName) b.subagent = subagentName
    if (parentToolCallId) b.parentToolCallId = parentToolCallId
    if (identity?.spanId) b.spanId = identity.spanId
    if (identity?.parentSpanId) b.parentSpanId = identity.parentSpanId
    state.blocks.push(b)
    return b
  }

  const ensureThinkingBlock = (
    subagentName: string | undefined,
    parentToolCallId: string | undefined,
    ts?: string,
    identity?: SpanIdentity
  ): ContentBlock => {
    const targetType = subagentName ? 'subagent_thinking' : 'thinking'
    const last = state.blocks[state.blocks.length - 1]
    if (
      last?.type === targetType &&
      last.subagent === subagentName &&
      last.parentToolCallId === parentToolCallId &&
      last.spanId === identity?.spanId
    ) {
      return last
    }
    stampBlockEnd(last, ts)
    const b: ContentBlock = { type: targetType, content: '', timestamp: toEventMs(ts) }
    if (subagentName) b.subagent = subagentName
    if (parentToolCallId) b.parentToolCallId = parentToolCallId
    if (identity?.spanId) b.spanId = identity.spanId
    if (identity?.parentSpanId) b.parentSpanId = identity.parentSpanId
    state.blocks.push(b)
    return b
  }

  const resolveScopedSubagent = (
    agentId: string | undefined,
    parentToolCallId: string | undefined,
    spanId?: string
  ): string | undefined => {
    if (agentId) return agentId
    if (spanId) {
      const scoped = state.subagentBySpanId.get(spanId)
      if (scoped) return scoped
    }
    if (parentToolCallId) {
      const scoped = state.subagentByParentToolCallId.get(parentToolCallId)
      if (scoped) return scoped
    }
    return state.activeSubagent
  }

  const resolveParentForSubagentBlock = (
    subagent: string | undefined,
    scopedParent: string | undefined
  ): string | undefined => {
    if (!subagent) return undefined
    if (scopedParent) return scopedParent
    if (state.activeSubagent === subagent) return state.activeSubagentParentToolCallId
    for (const [parent, name] of state.subagentByParentToolCallId) {
      if (name === subagent) return parent
    }
    return undefined
  }

  const flush = () => {
    if (isStale()) return
    deps.streamingBlocksRef.current = [...state.blocks]
    captureRevealedSimKeys(
      deps.revealedSimKeysRef.current,
      [deps.assistantId, state.streamRequestId],
      state.runningText
    )
    const activeChatId = deps.options.targetChatId ?? deps.chatIdRef.current
    if (!activeChatId) {
      const snapshot: Partial<ChatMessage> = {
        content: state.runningText,
        contentBlocks: [...state.blocks],
      }
      if (state.streamRequestId) snapshot.requestId = state.streamRequestId
      deps.setPendingMessages((prev) => {
        if (deps.expectedGen !== undefined && deps.streamGenRef.current !== deps.expectedGen) {
          return prev
        }
        const idx = prev.findIndex((m) => m.id === deps.assistantId)
        if (idx >= 0) {
          return prev.map((m) => (m.id === deps.assistantId ? { ...m, ...snapshot } : m))
        }
        return [
          ...prev,
          { id: deps.assistantId, role: 'assistant' as const, content: '', ...snapshot },
        ]
      })
      return
    }

    const assistantMessage = deps.buildAssistantSnapshotMessage({
      id: deps.assistantId,
      content: state.runningText,
      contentBlocks: state.blocks,
      ...(state.streamRequestId ? { requestId: state.streamRequestId } : {}),
    })
    deps.upsertMothershipChatHistory(activeChatId, (current) => {
      const streamId = deps.streamIdRef.current ?? current.activeStreamId ?? deps.assistantId
      const terminalPersistedAssistantExists =
        current.activeStreamId !== streamId &&
        deps.hasTerminalPersistedAssistantForStream(current.messages, streamId, assistantMessage.id)
      const reconciledMessages = deps.reconcileLiveAssistantTurn({
        messages: current.messages,
        streamId,
        liveAssistant: assistantMessage,
        activeStreamId: current.activeStreamId,
      })
      const skippedTerminalLiveWrite = reconciledMessages === current.messages
      return {
        ...current,
        messages: reconciledMessages,
        activeStreamId:
          skippedTerminalLiveWrite || terminalPersistedAssistantExists
            ? current.activeStreamId
            : (deps.streamIdRef.current ?? current.activeStreamId),
      }
    })
  }

  const flushText = () => {
    if (isStale()) return
    if (state.scheduledTextFlushFrame !== null) return
    if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
      flush()
      return
    }
    state.scheduledTextFlushFrame = window.requestAnimationFrame(() => {
      state.scheduledTextFlushFrame = null
      flush()
    })
  }

  const appendInlineErrorTag = (
    tag: string,
    subagentName?: string,
    parentToolCallId?: string,
    ts?: string
  ) => {
    if (state.runningText.includes(tag)) return
    const tb = ensureTextBlock(subagentName, parentToolCallId, ts)
    const prefix = state.runningText.length > 0 && !state.runningText.endsWith('\n') ? '\n' : ''
    tb.content = `${tb.content ?? ''}${prefix}${tag}`
    state.runningText += `${prefix}${tag}`
    deps.streamingContentRef.current = state.runningText
    flush()
  }

  const buildInlineErrorTag = (payload: MothershipStreamV1ErrorPayload) => {
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

  const ops: StreamLoopOps = {
    isStale,
    toEventMs,
    stampBlockEnd,
    ensureTextBlock,
    ensureThinkingBlock,
    resolveScopedSubagent,
    resolveParentForSubagentBlock,
    appendInlineErrorTag,
    buildInlineErrorTag,
    flush,
    flushText,
  }

  return { state, ops, deps }
}
