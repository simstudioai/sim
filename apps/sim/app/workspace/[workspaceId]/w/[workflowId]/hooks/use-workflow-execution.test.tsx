/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  executionStoreState,
  idleExecution,
  mockCancel,
  mockAdoptScopedExecution,
  mockBeginScopedExecution,
  mockClearExecutionPointer,
  mockEndScopedExecution,
  mockExecute,
  mockExecuteFromBlock,
  mockFetch,
  mockHandleExecutionCancelledConsole,
  mockHandleExecutionErrorConsole,
  mockLoadExecutionPointer,
  mockReconnect,
  mockRequestJson,
  mockResolveStartCandidates,
  mockSelectBestTrigger,
  mockUploadInternalFileSession,
  terminalStoreState,
  workflowBlocks,
  workflowStoreState,
} = vi.hoisted(() => {
  const workflowBlocks = {
    start: {
      id: 'start',
      type: 'starter',
      name: 'Start',
      enabled: true,
      subBlocks: { inputFormat: { value: 'persisted-state' } },
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
    getCurrentExecutionId: vi.fn<() => string | null>(() => null),
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
  const workflowEdges: Array<{ source: string; target: string }> = []
  const workflowStoreState = {
    blocks: workflowBlocks,
    edges: workflowEdges,
    getWorkflowState: vi.fn(() => ({
      blocks: workflowBlocks,
      edges: workflowEdges,
      loops: {},
      parallels: {},
    })),
  }

  return {
    executionStoreState,
    idleExecution,
    mockCancel: vi.fn(),
    mockAdoptScopedExecution: vi.fn(),
    mockBeginScopedExecution: vi.fn(() => ({})),
    mockClearExecutionPointer: vi.fn(),
    mockEndScopedExecution: vi.fn(() => true),
    mockExecute: vi.fn(),
    mockExecuteFromBlock: vi.fn(),
    mockFetch: vi.fn(),
    mockHandleExecutionCancelledConsole: vi.fn(),
    mockHandleExecutionErrorConsole: vi.fn(),
    mockLoadExecutionPointer: vi.fn(),
    mockReconnect: vi.fn(),
    mockRequestJson: vi.fn(),
    mockResolveStartCandidates: vi.fn(),
    mockSelectBestTrigger: vi.fn(),
    mockUploadInternalFileSession: vi.fn(),
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
  requestJson: mockRequestJson,
}))

vi.mock('@/lib/api/contracts/workflows', () => ({
  cancelWorkflowExecutionContract: {},
  workflowLogContract: {},
  workflowStateSchema: { parse: (value: unknown) => value },
}))

vi.mock('@/lib/logs/execution/trace-spans/trace-spans', () => ({
  buildTraceSpans: () => ({ traceSpans: [], totalDuration: 0 }),
}))

vi.mock('@/lib/tokenization', () => ({
  processStreamingBlockLogs: () => 0,
}))

vi.mock('@/lib/uploads/client/session-upload', () => ({
  uploadInternalFileSession: mockUploadInternalFileSession,
}))

vi.mock('@/lib/workflows/input-format', () => ({
  collectInputFormatFiles: () => [],
  isFileFieldType: () => false,
}))

vi.mock('@/lib/workflows/triggers/trigger-utils', () => ({
  extractTriggerMockPayload: () => ({}),
  selectBestTrigger: mockSelectBestTrigger,
  triggerNeedsMockPayload: () => false,
}))

vi.mock('@/lib/workflows/triggers/triggers', () => ({
  resolveStartCandidates: mockResolveStartCandidates,
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
  handleExecutionCancelledConsole: mockHandleExecutionCancelledConsole,
  handleExecutionErrorConsole: mockHandleExecutionErrorConsole,
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
      executeFromBlock: mockExecuteFromBlock,
      reconnect: mockReconnect,
      cancel: mockCancel,
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
  clearExecutionPointer: mockClearExecutionPointer,
  consolePersistence: {
    adoptScopedExecution: mockAdoptScopedExecution,
    beginScopedExecution: mockBeginScopedExecution,
    endScopedExecution: mockEndScopedExecution,
    persist: vi.fn(),
  },
  loadExecutionPointer: mockLoadExecutionPointer,
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
  mergeSubblockState: (blocks: Record<string, unknown>) => blocks,
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

describe('useWorkflowExecution cancellation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    executionStoreState.getCurrentExecutionId.mockReturnValue('execution-1')
    mockRequestJson.mockResolvedValue({ success: true })
  })

  afterEach(() => {
    executionStoreState.getCurrentExecutionId.mockReturnValue(null)
  })

  it('leaves the run intact until the server confirms, when there is one to cancel', () => {
    /*
     * The server's terminal event owns teardown. Tearing down here instead
     * would (a) show the run as stopped even when the cancel request fails,
     * while it keeps executing and billing server-side, with the execution id
     * already discarded so it cannot be retried, and (b) abort the stream
     * before `onExecutionCancelled` can settle the agent-stream chrome, so a
     * pending thinking-flush revives a console entry nothing will settle again.
     */
    const { result, unmount } = renderWorkflowExecutionHook()

    act(() => {
      result().handleCancelExecution()
    })

    expect(mockRequestJson).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        params: { id: 'workflow-1', executionId: 'execution-1' },
      })
    )
    expect(mockCancel).not.toHaveBeenCalled()
    expect(executionStoreState.setCurrentExecutionId).not.toHaveBeenCalled()
    expect(executionStoreState.setIsExecuting).not.toHaveBeenCalled()
    expect(executionStoreState.setActiveBlocks).not.toHaveBeenCalled()
    expect(mockHandleExecutionCancelledConsole).not.toHaveBeenCalled()

    unmount()
  })

  it('tears down locally when there is no server execution to cancel', () => {
    executionStoreState.getCurrentExecutionId.mockReturnValue(null)
    const { result, unmount } = renderWorkflowExecutionHook()

    act(() => {
      result().handleCancelExecution()
    })

    expect(mockRequestJson).not.toHaveBeenCalled()
    expect(mockCancel).toHaveBeenCalledWith('workflow-1')
    expect(executionStoreState.setIsExecuting).toHaveBeenCalledWith('workflow-1', false)
    expect(executionStoreState.setIsDebugging).toHaveBeenCalledWith('workflow-1', false)
    expect(executionStoreState.setActiveBlocks).toHaveBeenCalledWith('workflow-1', expect.any(Set))

    unmount()
  })
})

describe('useWorkflowExecution attachment uploads', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEndScopedExecution.mockReset().mockReturnValue(true)
    terminalStoreState._hasHydrated = false
    executionStoreState.workflowExecutions.set('workflow-1', idleExecution)
    executionStoreState.getWorkflowExecution.mockReturnValue(idleExecution)
    executionStoreState.getCurrentExecutionId.mockReturnValue(null)
    mockAdoptScopedExecution.mockReturnValue(undefined)
    mockLoadExecutionPointer.mockResolvedValue(null)
    mockReconnect.mockResolvedValue(undefined)
    mockResolveStartCandidates.mockReturnValue([])
    mockSelectBestTrigger.mockReturnValue([])
    vi.stubGlobal('fetch', mockFetch)
    mockUploadInternalFileSession.mockRejectedValue(
      new Error('Workspace file storage limit exceeded')
    )
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ error: 'Workspace file storage limit exceeded' }), {
        status: 413,
        headers: { 'Content-Type': 'application/json' },
      })
    )
    mockExecute.mockResolvedValue(undefined)
    mockExecuteFromBlock.mockResolvedValue(undefined)
    workflowStoreState.edges.length = 0
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('does not execute and reports the exact server error when an explicit attachment fails', async () => {
    const { result, unmount } = renderWorkflowExecutionHook()
    const contextFile = new File(['context'], 'context.txt', { type: 'text/plain' })
    const file = new File(['report'], 'report.pdf', { type: 'application/pdf' })
    let uploadError: unknown

    mockUploadInternalFileSession.mockResolvedValueOnce({
      id: 'attachment-context',
      key: 'executions/context.txt',
      url: '/uploads/context.txt',
      name: contextFile.name,
      size: contextFile.size,
      type: contextFile.type,
      context: 'execution',
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

    mockUploadInternalFileSession.mockResolvedValueOnce({
      id: 'attachment-diagram',
      key: 'execution/diagram.png',
      url: '/api/files/serve/execution%2Fdiagram.png',
      name: file.name,
      size: file.size,
      type: file.type,
      context: 'execution',
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

  it('does not let an overlapping run without lifecycle ownership end the active run', async () => {
    const persistenceExecution = {}
    let resolveActiveRun: (() => void) | undefined
    let markExecutionStarted: (() => void) | undefined
    const executionStarted = new Promise<void>((resolve) => {
      markExecutionStarted = resolve
    })
    mockBeginScopedExecution.mockReturnValueOnce(persistenceExecution)
    mockExecute.mockImplementationOnce(() => {
      markExecutionStarted?.()
      return new Promise<void>((resolve) => {
        resolveActiveRun = resolve
      })
    })
    const { result, unmount } = renderWorkflowExecutionHook()

    let activeRun: unknown
    await act(async () => {
      activeRun = await result().handleRunWorkflow({ input: 'active run' })
      await executionStarted
    })

    executionStoreState.getWorkflowExecution.mockReturnValue({
      ...executionStoreState.getWorkflowExecution(),
      isExecuting: true,
    })

    await act(async () => {
      await result().handleRunWorkflow()
    })

    expect(mockBeginScopedExecution).toHaveBeenCalledTimes(1)
    expect(mockExecute).toHaveBeenCalledTimes(1)
    expect(mockEndScopedExecution).not.toHaveBeenCalled()
    expect(executionStoreState.setCurrentExecutionId).not.toHaveBeenCalled()
    expect(executionStoreState.setIsDebugging).not.toHaveBeenCalled()
    expect(executionStoreState.setActiveBlocks).not.toHaveBeenCalled()

    await act(async () => {
      resolveActiveRun?.()
      await drainStream(activeRun)
    })

    expect(mockEndScopedExecution).toHaveBeenCalledOnce()
    expect(mockEndScopedExecution).toHaveBeenCalledWith('workflow-1', persistenceExecution)

    unmount()
  })

  it('rejects overlapping block runs before starting another execution', async () => {
    executionStoreState.getWorkflowExecution.mockReturnValue({
      ...idleExecution,
      isExecuting: true,
    })
    const startCandidate = {
      blockId: 'start',
      block: workflowBlocks.start,
      path: 'legacy-starter',
    }
    mockResolveStartCandidates.mockReturnValue([startCandidate])

    const { result, unmount } = renderWorkflowExecutionHook()

    await act(async () => {
      await result().handleRunUntilBlock('start', 'workflow-1')
      await result().handleRunFromBlock('start', 'workflow-1')
    })

    expect(mockBeginScopedExecution).not.toHaveBeenCalled()
    expect(mockExecute).not.toHaveBeenCalled()
    expect(mockExecuteFromBlock).not.toHaveBeenCalled()
    expect(executionStoreState.setCurrentExecutionId).not.toHaveBeenCalled()
    expect(executionStoreState.setIsDebugging).not.toHaveBeenCalled()
    expect(executionStoreState.setActiveBlocks).not.toHaveBeenCalled()

    unmount()
  })

  it('adopts and finishes persistence ownership created before the hook mounted', async () => {
    const persistenceExecution = {}
    terminalStoreState._hasHydrated = true
    executionStoreState.getWorkflowExecution.mockReturnValue({
      ...executionStoreState.getWorkflowExecution(),
      status: 'running',
      isExecuting: true,
      currentExecutionId: 'execution-1',
    })
    executionStoreState.getCurrentExecutionId.mockReturnValue('execution-1')
    mockLoadExecutionPointer.mockResolvedValue({
      workflowId: 'workflow-1',
      executionId: 'execution-1',
      lastEventId: 0,
    })
    mockAdoptScopedExecution.mockReturnValue(persistenceExecution)
    mockReconnect.mockImplementationOnce(async ({ callbacks }) => {
      callbacks.onExecutionCompleted({ finalBlockLogs: [] })
    })

    const { unmount } = renderWorkflowExecutionHook()
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mockBeginScopedExecution).not.toHaveBeenCalled()
    expect(mockAdoptScopedExecution).toHaveBeenCalledWith('workflow-1')
    expect(mockEndScopedExecution).toHaveBeenCalledWith('workflow-1', persistenceExecution)

    unmount()
  })

  it('releases only its persistence ownership when a reconnect retry is superseded', async () => {
    const persistenceExecution = {}
    terminalStoreState._hasHydrated = true
    executionStoreState.getWorkflowExecution.mockReturnValue({
      ...executionStoreState.getWorkflowExecution(),
      status: 'running',
      isExecuting: true,
      currentExecutionId: 'execution-1',
    })
    executionStoreState.getCurrentExecutionId.mockReturnValue('execution-1')
    mockLoadExecutionPointer.mockResolvedValue({
      workflowId: 'workflow-1',
      executionId: 'execution-1',
      lastEventId: 0,
    })
    mockAdoptScopedExecution.mockReturnValue(persistenceExecution)
    mockReconnect.mockImplementationOnce(async ({ callbacks }) => {
      callbacks.onBlockStarted({
        blockId: 'start',
        blockName: 'Start',
        blockType: 'starter',
        executionOrder: 1,
      })
      executionStoreState.getWorkflowExecution.mockReturnValue({
        ...executionStoreState.getWorkflowExecution(),
        status: 'running',
        isExecuting: true,
        currentExecutionId: 'execution-2',
      })
      executionStoreState.getCurrentExecutionId.mockReturnValue('execution-2')
      throw new Error('Reconnect failed after replacement started')
    })

    const { unmount } = renderWorkflowExecutionHook()
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mockEndScopedExecution).toHaveBeenCalledWith('workflow-1', persistenceExecution)
    expect(executionStoreState.setCurrentExecutionId).not.toHaveBeenCalledWith('workflow-1', null)
    expect(executionStoreState.setIsExecuting).not.toHaveBeenCalledWith('workflow-1', false)
    expect(executionStoreState.setActiveBlocks).not.toHaveBeenCalled()
    expect(mockClearExecutionPointer).not.toHaveBeenCalled()

    unmount()
  })

  it('does not let delayed debug completion reset a replacement execution', async () => {
    const debugPersistenceExecution = {}
    const replacementPersistenceExecution = {}
    let currentPersistenceExecution: object | undefined = debugPersistenceExecution
    let resolveDebugStep: ((result: unknown) => void) | undefined
    const continueExecution = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveDebugStep = resolve
        })
    )
    const debugExecution = {
      ...idleExecution,
      status: 'running',
      isExecuting: true,
      isDebugging: true,
      pendingBlocks: ['start'],
      executor: { continueExecution },
      debugContext: { blockLogs: [] },
    }
    executionStoreState.workflowExecutions.set('workflow-1', debugExecution)
    executionStoreState.getWorkflowExecution.mockReturnValue(debugExecution)
    mockAdoptScopedExecution.mockImplementation(() => currentPersistenceExecution)
    mockEndScopedExecution.mockImplementation((_workflowId, persistenceExecution) => {
      if (persistenceExecution !== currentPersistenceExecution) return false
      currentPersistenceExecution = undefined
      return true
    })

    const { result, unmount } = renderWorkflowExecutionHook()
    let debugStep: Promise<void>
    act(() => {
      debugStep = result().handleStepDebug()
    })
    expect(continueExecution).toHaveBeenCalledOnce()

    currentPersistenceExecution = replacementPersistenceExecution
    resolveDebugStep?.({ success: true, output: {}, logs: [] })
    await act(async () => {
      await debugStep
    })

    expect(mockEndScopedExecution).not.toHaveBeenCalledWith(
      'workflow-1',
      replacementPersistenceExecution
    )
    expect(mockClearExecutionPointer).not.toHaveBeenCalled()
    expect(executionStoreState.setIsExecuting).not.toHaveBeenCalledWith('workflow-1', false)
    expect(executionStoreState.setIsDebugging).not.toHaveBeenCalledWith('workflow-1', false)
    expect(executionStoreState.setDebugContext).not.toHaveBeenCalledWith('workflow-1', null)
    expect(executionStoreState.setExecutor).not.toHaveBeenCalledWith('workflow-1', null)
    expect(executionStoreState.setPendingBlocks).not.toHaveBeenCalledWith('workflow-1', [])
    expect(executionStoreState.setActiveBlocks).not.toHaveBeenCalled()
    expect(mockRequestJson).not.toHaveBeenCalled()

    unmount()
  })

  it('uses only projected live thinking without changing normal settle behavior', async () => {
    mockExecute.mockImplementationOnce(async (options) => {
      options.onExecutionId?.('execution-1')
      await options.callbacks?.onStreamThinking?.({
        blockId: 'agent-1',
        text: 'sk-resolved-secret',
        display: { text: '{{OPENAI_API_KEY}}' },
      })
      await options.callbacks?.onStreamDone?.({ blockId: 'agent-1' })
      await options.callbacks?.onBlockCompleted?.({
        blockId: 'agent-1',
        blockName: 'Agent 1',
        blockType: 'agent',
        executionOrder: 1,
        output: { content: 'sk-resolved-secret' },
        display: { output: { content: '{{OPENAI_API_KEY}}' } },
        durationMs: 10,
        startedAt: '2026-07-31T00:00:00.000Z',
        endedAt: '2026-07-31T00:00:00.010Z',
      })
    })

    const { result, unmount } = renderWorkflowExecutionHook()

    await act(async () => {
      const runResult = await result().handleRunWorkflow({ input: 'chat input' })
      await drainStream(runResult)
    })

    expect(terminalStoreState.updateConsole).toHaveBeenCalledWith(
      'agent-1',
      expect.objectContaining({ agentStreamThinking: '{{OPENAI_API_KEY}}' }),
      'execution-1'
    )
    expect(terminalStoreState.updateConsole).not.toHaveBeenCalledWith(
      'agent-1',
      expect.objectContaining({ clearAgentStreamThinking: true }),
      'execution-1'
    )
    expect(JSON.stringify(terminalStoreState.updateConsole.mock.calls)).not.toContain(
      'sk-resolved-secret'
    )

    unmount()
  })

  it('preserves legacy live thinking when no display projection field is sent', async () => {
    mockExecute.mockImplementationOnce(async (options) => {
      options.onExecutionId?.('execution-1')
      await options.callbacks?.onStreamThinking?.({
        blockId: 'agent-1',
        text: 'sk-resolved-secret',
      })
      await options.callbacks?.onStreamDone?.({ blockId: 'agent-1' })
    })

    const { result, unmount } = renderWorkflowExecutionHook()

    await act(async () => {
      const runResult = await result().handleRunWorkflow({ input: 'chat input' })
      await drainStream(runResult)
    })

    expect(terminalStoreState.updateConsole).toHaveBeenCalledWith(
      'agent-1',
      expect.objectContaining({ agentStreamThinking: 'sk-resolved-secret' }),
      'execution-1'
    )

    unmount()
  })

  it('clears live thinking when the server sends an empty display projection', async () => {
    mockExecute.mockImplementationOnce(async (options) => {
      options.onExecutionId?.('execution-1')
      await options.callbacks?.onStreamThinking?.({
        blockId: 'agent-1',
        text: 'sk-resolved-secret',
        display: {},
      })
    })

    const { result, unmount } = renderWorkflowExecutionHook()

    await act(async () => {
      const runResult = await result().handleRunWorkflow({ input: 'chat input' })
      await drainStream(runResult)
    })

    expect(terminalStoreState.updateConsole).toHaveBeenCalledWith(
      'agent-1',
      { clearAgentStreamThinking: true },
      'execution-1'
    )
    expect(JSON.stringify(terminalStoreState.updateConsole.mock.calls)).not.toContain(
      'sk-resolved-secret'
    )

    unmount()
  })

  it('keeps the trusted execution ID when storing a run-until-block snapshot', async () => {
    const startCandidate = {
      blockId: 'start',
      block: workflowBlocks.start,
      path: 'legacy-starter',
    }
    mockResolveStartCandidates.mockReturnValue([startCandidate])
    mockSelectBestTrigger.mockReturnValue([startCandidate])
    mockExecute.mockImplementationOnce(async (options) => {
      const executionId = options.executionId as string
      executionStoreState.getCurrentExecutionId.mockReturnValue(executionId)
      options.onExecutionId?.(executionId)
      await options.callbacks?.onExecutionCompleted?.({
        success: true,
        output: {},
        duration: 10,
        startTime: '2026-07-31T00:00:00.000Z',
        endTime: '2026-07-31T00:00:00.010Z',
        finalBlockLogs: [],
      })
    })

    const { result, unmount } = renderWorkflowExecutionHook()

    await act(async () => {
      await result().handleRunUntilBlock('function-1', 'workflow-1')
    })

    const executionId = mockExecute.mock.calls[0]?.[0]?.executionId
    expect(executionId).toEqual(expect.any(String))
    expect(executionStoreState.setLastExecutionSnapshot).toHaveBeenCalledWith(
      'workflow-1',
      expect.objectContaining({ sourceExecutionId: executionId })
    )

    unmount()
  })

  it('sends the snapshot as a fallback with a trusted run-from-block execution ID', async () => {
    const sourceSnapshot = {
      blockStates: { start: { output: { value: 'ready' } } },
      executedBlocks: ['start'],
      blockLogs: [],
      decisions: { router: {}, condition: {} },
      completedLoops: [],
      activeExecutionPath: ['start'],
      sourceExecutionId: 'source-execution-1',
    }
    executionStoreState.getLastExecutionSnapshot.mockReturnValueOnce(sourceSnapshot)
    workflowStoreState.edges.push({ source: 'start', target: 'function-1' } as never)
    const currentBlocks = {
      ...workflowBlocks,
      'function-1': {
        id: 'function-1',
        type: 'function',
        name: 'Function 1',
        enabled: true,
        subBlocks: { code: { value: 'return "current editor state"' } },
      },
    }
    workflowStoreState.getWorkflowState.mockReturnValueOnce({
      blocks: currentBlocks,
      edges: workflowStoreState.edges,
      loops: {},
      parallels: {},
    })

    const { result, unmount } = renderWorkflowExecutionHook()

    await act(async () => {
      await result().handleRunFromBlock('function-1', 'workflow-1')
    })

    expect(mockExecuteFromBlock).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: 'workflow-1',
        startBlockId: 'function-1',
        sourceExecutionId: 'source-execution-1',
        sourceSnapshot,
        useDraftState: true,
        isClientSession: true,
        workflowStateOverride: {
          blocks: currentBlocks,
          edges: workflowStoreState.edges,
          loops: {},
          parallels: {},
        },
      })
    )

    unmount()
  })

  it('uses fresh execution for trigger block runs and stores their snapshot', async () => {
    const currentBlocks = {
      ...workflowBlocks,
      start: {
        ...workflowBlocks.start,
        subBlocks: { inputFormat: { value: 'current-editor-state' } },
      },
    }
    workflowStoreState.getWorkflowState.mockReturnValueOnce({
      blocks: currentBlocks,
      edges: [],
      loops: {},
      parallels: {},
    })
    mockExecute.mockImplementationOnce(async (options) => {
      executionStoreState.getCurrentExecutionId.mockReturnValue('execution-1')
      options.onExecutionId?.('execution-1')
      await options.callbacks?.onExecutionCompleted?.({
        success: true,
        output: {},
        duration: 10,
        startTime: '2026-08-04T00:00:00.000Z',
        endTime: '2026-08-04T00:00:00.010Z',
        finalBlockLogs: [],
      })
    })
    const { result, unmount } = renderWorkflowExecutionHook()

    await act(async () => {
      await result().handleRunFromBlock('start', 'workflow-1')
    })

    expect(mockExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: 'workflow-1',
        startBlockId: 'start',
        triggerType: 'manual',
        useDraftState: true,
        isClientSession: true,
        workflowStateOverride: {
          blocks: currentBlocks,
          edges: [],
          loops: {},
          parallels: {},
        },
      })
    )
    expect(mockExecute.mock.calls[0]?.[0]).not.toHaveProperty('sourceSnapshot')
    expect(mockExecuteFromBlock).not.toHaveBeenCalled()
    expect(executionStoreState.setLastExecutionSnapshot).toHaveBeenCalledWith(
      'workflow-1',
      expect.objectContaining({
        sourceExecutionId: 'execution-1',
        executedBlocks: ['start'],
      })
    )

    unmount()
  })

  it('fails closed when a legacy run-from-block error has no display projection', async () => {
    mockExecute.mockImplementationOnce(async (options) => {
      executionStoreState.getCurrentExecutionId.mockReturnValue('execution-1')
      options.onExecutionId?.('execution-1')
      await options.callbacks?.onExecutionError?.({
        error: 'raw-secret-value caused the failure',
        duration: 8,
        finalBlockLogs: [],
      })
    })

    const { result, unmount } = renderWorkflowExecutionHook()

    await act(async () => {
      await result().handleRunFromBlock('start', 'workflow-1')
    })

    expect(mockHandleExecutionErrorConsole).toHaveBeenCalledWith(
      expect.objectContaining({
        addConsole: terminalStoreState.addConsole,
      }),
      expect.objectContaining({
        workflowId: 'workflow-1',
        executionId: 'execution-1',
        error: 'raw-secret-value caused the failure',
        hasDisplayProjection: true,
        durationMs: 8,
      })
    )
    expect(mockHandleExecutionErrorConsole.mock.calls[0]?.[1]).not.toHaveProperty('displayError')

    unmount()
  })

  it('shows one safe error when run-from-block fails before receiving an execution ID', async () => {
    const sourceSnapshot = {
      blockStates: { start: { output: { value: 'ready' } } },
      executedBlocks: ['start'],
      blockLogs: [],
      decisions: { router: {}, condition: {} },
      completedLoops: [],
      activeExecutionPath: ['start'],
      sourceExecutionId: 'source-execution-1',
    }
    executionStoreState.getLastExecutionSnapshot.mockReturnValueOnce(sourceSnapshot)
    workflowStoreState.edges.push({ source: 'start', target: 'function-1' } as never)
    mockExecuteFromBlock.mockImplementationOnce(async (options) => {
      await options.callbacks?.onExecutionError?.({
        error: 'raw pre-execution failure',
        duration: 0,
      })
      throw new Error('raw pre-execution failure')
    })

    const { result, unmount } = renderWorkflowExecutionHook()

    await act(async () => {
      await result().handleRunFromBlock('function-1', 'workflow-1')
    })

    expect(mockHandleExecutionErrorConsole).toHaveBeenCalledTimes(1)
    expect(mockHandleExecutionErrorConsole).toHaveBeenCalledWith(
      expect.objectContaining({
        addConsole: terminalStoreState.addConsole,
      }),
      expect.objectContaining({
        workflowId: 'workflow-1',
        error: 'raw pre-execution failure',
        hasDisplayProjection: true,
        durationMs: 0,
        blockLogs: [],
      })
    )

    unmount()
  })
})
