/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  DirectUploadErrorMock,
  executionStoreState,
  mockExecute,
  mockFetch,
  mockRunUploadStrategy,
  terminalStoreState,
  workflowBlocks,
  workflowStoreState,
} = vi.hoisted(() => {
  class DirectUploadErrorMock extends Error {
    constructor(
      message: string,
      public code: string
    ) {
      super(message)
      this.name = 'DirectUploadError'
    }
  }

  const workflowBlocks = {
    start: {
      id: 'start',
      type: 'starter',
      name: 'Start',
      enabled: true,
      subBlocks: {},
    },
  }
  const idleExecution = {
    status: 'idle',
    isExecuting: false,
    isDebugging: false,
    activeBlockIds: new Set<string>(),
    pendingBlocks: [],
    executor: null,
    debugContext: null,
    lastRunPath: new Map(),
    lastRunEdges: new Map(),
    currentExecutionId: null,
  }
  const executionStoreState = {
    workflowExecutions: new Map([['workflow-1', idleExecution]]),
    getWorkflowExecution: vi.fn(() => idleExecution),
    getCurrentExecutionId: vi.fn(() => null),
    getLastExecutionSnapshot: vi.fn(() => null),
    setCurrentExecutionId: vi.fn(),
    setIsExecuting: vi.fn(),
    setIsDebugging: vi.fn(),
    setPendingBlocks: vi.fn(),
    setExecutor: vi.fn(),
    setDebugContext: vi.fn(),
    setActiveBlocks: vi.fn(),
    setBlockRunStatus: vi.fn(),
    setEdgeRunStatus: vi.fn(),
    setLastExecutionSnapshot: vi.fn(),
    clearLastExecutionSnapshot: vi.fn(),
  }
  const terminalStoreState = {
    _hasHydrated: false,
    toggleConsole: vi.fn(),
    addConsole: vi.fn(),
    updateConsole: vi.fn(),
    cancelRunningEntries: vi.fn(),
    finishRunningEntries: vi.fn(),
    clearExecutionEntries: vi.fn(),
  }
  const workflowStoreState = {
    blocks: workflowBlocks,
    edges: [],
    getWorkflowState: vi.fn(() => ({
      blocks: workflowBlocks,
      edges: [],
      loops: {},
      parallels: {},
    })),
  }

  return {
    DirectUploadErrorMock,
    executionStoreState,
    mockExecute: vi.fn(),
    mockFetch: vi.fn(),
    mockRunUploadStrategy: vi.fn(),
    terminalStoreState,
    workflowBlocks,
    workflowStoreState,
  }
})

vi.mock('@sim/emcn', () => ({
  toast: { error: vi.fn() },
}))

vi.mock('next/navigation', () => ({
  useParams: () => ({ workspaceId: 'workspace-1' }),
}))

vi.mock('@/lib/api/client/request', () => ({
  requestJson: vi.fn(),
}))

vi.mock('@/lib/api/contracts/workflows', () => ({
  cancelWorkflowExecutionContract: {},
  workflowLogContract: {},
}))

vi.mock('@/lib/logs/execution/trace-spans/trace-spans', () => ({
  buildTraceSpans: () => ({ traceSpans: [], totalDuration: 0 }),
}))

vi.mock('@/lib/tokenization', () => ({
  processStreamingBlockLogs: () => 0,
}))

vi.mock('@/lib/uploads/client/direct-upload', () => ({
  DirectUploadError: DirectUploadErrorMock,
  runUploadStrategy: mockRunUploadStrategy,
}))

vi.mock('@/lib/workflows/input-format', () => ({
  collectInputFormatFiles: () => [],
  isFileFieldType: () => false,
}))

vi.mock('@/lib/workflows/triggers/trigger-utils', () => ({
  extractTriggerMockPayload: () => ({}),
  selectBestTrigger: () => [],
  triggerNeedsMockPayload: () => false,
}))

vi.mock('@/lib/workflows/triggers/triggers', () => ({
  resolveStartCandidates: () => [],
  StartBlockPath: {
    SPLIT_API: 'split-api',
    SPLIT_INPUT: 'split-input',
    UNIFIED: 'unified',
    LEGACY_STARTER: 'legacy-starter',
    EXTERNAL_TRIGGER: 'external-trigger',
  },
  TriggerUtils: {
    findStartBlock: () => ({ blockId: 'start' }),
    getTriggerValidationMessage: () => 'Missing trigger',
  },
}))

vi.mock('@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-current-workflow', () => ({
  useCurrentWorkflow: () => ({
    blocks: workflowBlocks,
    edges: [],
    loops: {},
    parallels: {},
    isDiffMode: false,
  }),
}))

vi.mock('@/app/workspace/[workspaceId]/w/[workflowId]/utils/workflow-execution-utils', () => ({
  addHttpErrorConsoleEntry: vi.fn(),
  createBlockEventHandlers: () => ({
    onBlockStarted: vi.fn(),
    onBlockCompleted: vi.fn(),
    onBlockError: vi.fn(),
    onBlockChildWorkflowStarted: vi.fn(),
  }),
  reconcileFinalBlockLogs: vi.fn(),
  addExecutionErrorConsoleEntry: vi.fn(),
  handleExecutionCancelledConsole: vi.fn(),
  handleExecutionErrorConsole: vi.fn(),
}))

vi.mock('@/blocks', () => ({
  getBlock: vi.fn(),
}))

vi.mock('@/executor/utils/errors', () => ({
  hasExecutionResult: () => false,
}))

vi.mock('@/executor/utils/start-block', () => ({
  coerceValue: (_type: string, value: unknown) => value,
}))

vi.mock('@/hooks/queries/subscription', () => ({
  subscriptionKeys: { users: () => ['subscription', 'users'] },
}))

vi.mock('@/hooks/queries/utils/workflow-cache', () => ({
  getWorkflows: () => [],
}))

vi.mock('@/hooks/use-execution-stream', () => {
  class SSEEventHandlerError extends Error {}
  class SSEStreamInterruptedError extends Error {}

  return {
    isExecutionStreamHttpError: () => false,
    SSEEventHandlerError,
    SSEStreamInterruptedError,
    useExecutionStream: () => ({
      execute: mockExecute,
      executeFromBlock: vi.fn(),
      reconnect: vi.fn(),
      cancel: vi.fn(),
      cancelExecute: vi.fn(),
      cancelReconnect: vi.fn(),
    }),
  }
})

vi.mock('@/serializer', () => ({
  WorkflowValidationError: class WorkflowValidationError extends Error {},
}))

vi.mock('@/stores/chat/store', () => ({
  useChatStore: {
    getState: () => ({
      getSelectedWorkflowOutput: () => [],
    }),
  },
}))

vi.mock('@/stores/execution', () => ({
  defaultWorkflowExecutionState: executionStoreState.getWorkflowExecution('workflow-1'),
  useExecutionStore: Object.assign(
    (selector: (state: typeof executionStoreState) => unknown) => selector(executionStoreState),
    { getState: () => executionStoreState }
  ),
}))

vi.mock('@/stores/terminal', () => ({
  clearExecutionPointer: vi.fn(),
  consolePersistence: {
    executionStarted: vi.fn(),
    executionEnded: vi.fn(),
    persist: vi.fn(),
  },
  loadExecutionPointer: vi.fn(),
  saveExecutionPointer: vi.fn(),
  useTerminalConsoleStore: Object.assign(
    (selector: (state: typeof terminalStoreState) => unknown) => selector(terminalStoreState),
    { getState: () => terminalStoreState }
  ),
}))

vi.mock('@/stores/variables/store', () => ({
  useVariablesStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      getVariablesByWorkflowId: () => [],
      variables: [],
    }),
}))

vi.mock('@/stores/workflow-diff', () => ({
  useWorkflowDiffStore: (selector: (state: { isShowingDiff: boolean }) => unknown) =>
    selector({ isShowingDiff: false }),
}))

vi.mock('@/stores/workflows/registry/store', () => ({
  useWorkflowRegistry: (
    selector: (state: {
      activeWorkflowId: string
      hydration: { workspaceId: string; phase: string }
    }) => unknown
  ) =>
    selector({
      activeWorkflowId: 'workflow-1',
      hydration: { workspaceId: 'workspace-1', phase: 'ready' },
    }),
}))

vi.mock('@/stores/workflows/utils', () => ({
  mergeSubblockState: () => workflowBlocks,
}))

vi.mock('@/stores/workflows/workflow/store', () => ({
  useWorkflowStore: Object.assign(
    (selector: (state: typeof workflowStoreState) => unknown) => selector(workflowStoreState),
    { getState: () => workflowStoreState }
  ),
}))

import {
  isChatWorkflowRunResult,
  useWorkflowExecution,
  WorkflowAttachmentUploadError,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-workflow-execution'

interface HookHarness {
  result: () => ReturnType<typeof useWorkflowExecution>
  unmount: () => void
}

function renderWorkflowExecutionHook(): HookHarness {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  const container = document.createElement('div')
  const root: Root = createRoot(container)
  let latest: ReturnType<typeof useWorkflowExecution>

  function Probe() {
    latest = useWorkflowExecution()
    return null
  }

  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }

  act(() => {
    root.render(
      <Wrapper>
        <Probe />
      </Wrapper>
    )
  })

  return {
    result: () => latest,
    unmount: () => act(() => root.unmount()),
  }
}

async function drainStream(value: unknown): Promise<void> {
  if (!value || typeof value !== 'object' || !('stream' in value)) return
  if (!(value.stream instanceof ReadableStream)) return

  const reader = value.stream.getReader()
  while (!(await reader.read()).done) {}
}

describe('useWorkflowExecution attachment uploads', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mockFetch)
    mockRunUploadStrategy.mockRejectedValue(
      new DirectUploadErrorMock('Server signaled fallback to API upload', 'FALLBACK_REQUIRED')
    )
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ error: 'Workspace file storage limit exceeded' }), {
        status: 413,
        headers: { 'Content-Type': 'application/json' },
      })
    )
    mockExecute.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('does not execute and reports the exact server error when an explicit attachment fails', async () => {
    const { result, unmount } = renderWorkflowExecutionHook()
    const contextFile = new File(['context'], 'context.txt', { type: 'text/plain' })
    const file = new File(['report'], 'report.pdf', { type: 'application/pdf' })
    let uploadError: unknown

    mockRunUploadStrategy.mockResolvedValueOnce({
      key: 'executions/context.txt',
      path: '/uploads/context.txt',
      name: contextFile.name,
      size: contextFile.size,
      contentType: contextFile.type,
    })

    await act(async () => {
      try {
        await result().handleRunWorkflow({
          input: 'Summarize this report',
          conversationId: 'conversation-1',
          files: [
            {
              name: contextFile.name,
              size: contextFile.size,
              type: contextFile.type,
              file: contextFile,
            },
            {
              name: file.name,
              size: file.size,
              type: file.type,
              file,
            },
          ],
        })
      } catch (error) {
        uploadError = error
      }
    })

    expect(uploadError).toBeInstanceOf(WorkflowAttachmentUploadError)
    expect((uploadError as Error).message).toBe(
      'Failed to upload report.pdf: Workspace file storage limit exceeded'
    )
    expect(mockExecute).not.toHaveBeenCalled()

    unmount()
  })

  it('returns uploaded metadata without mutating or leaking local input into execution', async () => {
    const { result, unmount } = renderWorkflowExecutionHook()
    const file = new File(['diagram'], 'diagram.png', { type: 'image/png' })
    const workflowInput = {
      input: 'Describe this diagram',
      conversationId: 'conversation-1',
      files: [
        {
          name: file.name,
          size: file.size,
          type: file.type,
          file,
        },
      ],
    }
    let runResult: unknown

    mockRunUploadStrategy.mockResolvedValueOnce({
      key: 'execution/diagram.png',
      path: '/api/files/serve/execution%2Fdiagram.png',
      name: file.name,
      size: file.size,
      contentType: file.type,
    })

    await act(async () => {
      runResult = await result().handleRunWorkflow(workflowInput)
      await drainStream(runResult)
    })

    expect(isChatWorkflowRunResult(runResult)).toBe(true)
    if (!isChatWorkflowRunResult(runResult)) {
      throw new Error('Expected a chat workflow run result')
    }
    expect(runResult.uploadedAttachments).toEqual([
      expect.objectContaining({
        name: 'diagram.png',
        url: '/api/files/serve/execution%2Fdiagram.png',
        size: file.size,
        type: 'image/png',
        key: 'execution/diagram.png',
      }),
    ])
    expect(workflowInput.files[0].file).toBe(file)
    expect(mockExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          input: 'Describe this diagram',
          conversationId: 'conversation-1',
          files: [
            expect.objectContaining({
              name: 'diagram.png',
              url: '/api/files/serve/execution%2Fdiagram.png',
            }),
          ],
        }),
      })
    )

    unmount()
  })
})
