import type { MutableRefObject } from 'react'
import type { QueryClient } from '@tanstack/react-query'
import { vi } from 'vitest'
import type { PersistedMessage } from '@/lib/copilot/chat/persisted-message'
import type { RevealedSimKeysByMessage } from '@/lib/copilot/chat/sim-key-redaction'
import type { FilePreviewSession } from '@/lib/copilot/request/session/file-preview-session-contract'
import type {
  ActiveTurn,
  StreamLoopDeps,
} from '@/app/workspace/[workspaceId]/home/hooks/stream/stream-context'
import type { ContentBlock, MothershipResource } from '@/app/workspace/[workspaceId]/home/types'

/** Minimal {@link MutableRefObject} factory for stream-loop unit fixtures. */
export function ref<T>(current: T): MutableRefObject<T> {
  return { current }
}

/**
 * Builds a fully-stubbed {@link StreamLoopDeps} for stream-loop unit tests.
 * Every function is a `vi.fn` and every ref is seeded with an empty value;
 * tests override only the fields relevant to the behavior under test.
 */
export function makeStreamLoopDeps(overrides: Partial<StreamLoopDeps> = {}): StreamLoopDeps {
  return {
    workspaceId: 'ws-1',
    queryClient: {
      invalidateQueries: vi.fn(),
      setQueryData: vi.fn(),
      // double-cast-allowed: minimal QueryClient stub for stream-loop unit fixtures
    } as unknown as QueryClient,
    assistantId: 'assistant-1',
    expectedGen: 1,
    options: {},
    setError: vi.fn(),
    setPendingMessages: vi.fn(),
    setResolvedChatId: vi.fn(),
    setResources: vi.fn(),
    setActiveResourceId: vi.fn(),
    addResource: vi.fn(() => true),
    removeResource: vi.fn(),
    startClientWorkflowTool: vi.fn(),
    startClientLocalFilesystemTool: vi.fn(),
    startClientBrowserTool: vi.fn(),
    upsertMothershipChatHistory: vi.fn(),
    ensureWorkflowInRegistry: vi.fn(() => false),
    onPreviewPhase: vi.fn(),
    applyPreviewSessionUpdate: vi.fn(),
    removePreviewSessionImmediate: vi.fn(),
    promoteFileResource: vi.fn(),
    shouldAutoActivatePreviewSession: vi.fn(() => true),
    buildAssistantSnapshotMessage: vi.fn(({ id, content, contentBlocks, requestId }) => ({
      id,
      role: 'assistant',
      content,
      contentBlocks,
      ...(requestId ? { requestId } : {}),
      // double-cast-allowed: vi.fn wrapper loses the exact snapshot-builder signature in this test fixture
    })) as unknown as StreamLoopDeps['buildAssistantSnapshotMessage'],
    hasTerminalPersistedAssistantForStream: vi.fn(() => false),
    reconcileLiveAssistantTurn: vi.fn(
      (params: { messages: PersistedMessage[] }) => params.messages
    ),
    streamGenRef: ref(1),
    streamingBlocksRef: ref<ContentBlock[]>([]),
    streamingContentRef: ref(''),
    chatIdRef: ref<string | undefined>(undefined),
    selectedChatIdRef: ref<string | undefined>(undefined),
    streamIdRef: ref<string | undefined>(undefined),
    revealedSimKeysRef: ref<RevealedSimKeysByMessage>(new Map()),
    pendingUserMsgRef: ref<PersistedMessage | null>(null),
    activeTurnRef: ref<ActiveTurn | null>(null),
    resourcesRef: ref<MothershipResource[]>([]),
    workflowIdRef: ref<string | undefined>(undefined),
    activeResourceIdRef: ref<string | null>(null),
    onTitleUpdateRef: ref<(() => void) | undefined>(undefined),
    onToolResultRef: ref<
      ((toolName: string, success: boolean, result: unknown) => void) | undefined
    >(undefined),
    onResourceEventRef: ref<(() => void) | undefined>(undefined),
    previewSessionRef: ref<FilePreviewSession | null>(null),
    previewSessionsRef: ref<Record<string, FilePreviewSession>>({}),
    latestPreviewTargetToolCallIdRef: ref<string | null>(null),
    activePreviewSessionIdRef: ref<string | null>(null),
    completedPreviewResourceHandoffRef: ref<
      Map<string, { sessionId: string; suppressActivation: boolean }>
    >(new Map()),
    previewActivationOwnerRef: ref<Map<string, string | null>>(new Map()),
    ...overrides,
  }
}
