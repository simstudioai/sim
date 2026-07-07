import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type { QueryClient } from '@tanstack/react-query'
import type { PersistedMessage } from '@/lib/copilot/chat/persisted-message'
import type { RevealedSimKeysByMessage } from '@/lib/copilot/chat/sim-key-redaction'
import { captureRevealedSimKeys } from '@/lib/copilot/chat/sim-key-redaction'
import type { SyntheticFilePreviewPayload } from '@/lib/copilot/request/session'
import type { FilePreviewSession } from '@/lib/copilot/request/session/file-preview-session-contract'
import {
  createTurnModel,
  type TurnModel,
} from '@/app/workspace/[workspaceId]/home/hooks/stream/turn-model'
import {
  contentBlocksToModel,
  modelMainText,
  modelToContentBlocks,
} from '@/app/workspace/[workspaceId]/home/hooks/stream/turn-model-serialize'
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
  /**
   * The normalized turn model — the single source of truth for streamed state.
   * `reduceEvent` folds every event into it; `flush` serializes it to the
   * persisted/rendered `contentBlocks` shape. The handlers carry no block state.
   */
  model: TurnModel
  streamRequestId: string | undefined
  sawStreamError: boolean
  sawCompleteEvent: boolean
  scheduledTextFlushFrame: number | null
}

export interface StreamEventScope {
  scopedParentToolCallId: string | undefined
  scopedAgentId: string | undefined
  scopedSpanId: string | undefined
}

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
    // On a reconnect that preserves state, rebuild the model from the last
    // serialized snapshot so live events fold into the identical model.
    model: preserveState
      ? contentBlocksToModel(deps.streamingBlocksRef.current)
      : createTurnModel(),
    streamRequestId: undefined,
    sawStreamError: false,
    sawCompleteEvent: false,
    scheduledTextFlushFrame: null,
  }

  const isStale = () =>
    (deps.expectedGen !== undefined && deps.streamGenRef.current !== deps.expectedGen) ||
    deps.options.shouldContinue?.() === false

  if (!preserveState && !isStale()) {
    deps.streamingContentRef.current = ''
    deps.streamingBlocksRef.current = []
  }

  const flush = () => {
    if (isStale()) return
    // The model is authoritative: serialize it to the persisted/rendered block
    // shape and main-lane content for every snapshot write.
    const modelBlocks = modelToContentBlocks(state.model)
    const modelContent = modelMainText(state.model)
    deps.streamingBlocksRef.current = modelBlocks
    deps.streamingContentRef.current = modelContent
    captureRevealedSimKeys(
      deps.revealedSimKeysRef.current,
      [deps.assistantId, state.streamRequestId],
      modelContent,
      modelBlocks
    )
    const activeChatId = deps.options.targetChatId ?? deps.chatIdRef.current
    if (!activeChatId) {
      const snapshot: Partial<ChatMessage> = {
        content: modelContent,
        contentBlocks: modelBlocks,
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
      content: modelContent,
      contentBlocks: modelBlocks,
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

  const ops: StreamLoopOps = {
    isStale,
    flush,
    flushText,
  }

  return { state, ops, deps }
}
