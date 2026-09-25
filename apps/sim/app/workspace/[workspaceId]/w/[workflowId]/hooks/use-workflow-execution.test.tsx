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
  mockFindStartBlock,
  mockFetch,
  mockHandleExecutionCancelledConsole,
  mockHandleExecutionErrorConsole,
  mockIsExecutionStreamHttpError,
  mockIsRunToolActiveForWorkflow,
  mockLoadExecutionPointer,
  mockReconnect,
  mockRequestJson,
  mockResolveStartCandidates,
  mockSelectBestTrigger,
  mockUploadInternalFileSession,
  runToolReleaseListeners,
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
    mockFindStartBlock: vi.fn(() => ({ blockId: 'start' })),
    mockFetch: vi.fn(),
    mockHandleExecutionCancelledConsole: vi.fn(),
    mockHandleExecutionErrorConsole: vi.fn(),
    mockIsExecutionStreamHttpError: vi.fn(() => false),
    mockIsRunToolActiveForWorkflow: vi.fn(() => false),
    mockLoadExecutionPointer: vi.fn(),
    mockReconnect: vi.fn(),
    mockRequestJson: vi.fn(),
    mockResolveStartCandidates: vi.fn(),
    mockSelectBestTrigger: vi.fn(),
    mockUploadInternalFileSession: vi.fn(),
    runToolReleaseListeners: new Set<(workflowId: string) => void>(),
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

vi.mock('@/lib/mothership/tools/client/run-tool-execution', () => ({
  isRunToolActiveForWorkflow: mockIsRunToolActiveForWorkflow,
  subscribeToRunToolRelease: (listener: (workflowId: string) => void) => {
    runToolReleaseListeners.add(listener)
    return () => {
      runToolReleaseListeners.delete(listener)
    }
  },
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
    findStartBlock: mockFindStartBlock,
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
    isExecutionStreamHttpError: mockIsExecutionStreamHttpError,
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
})

function resetWorkflowExecutionTestState() {
  vi.clearAllMocks()
  mockBeginScopedExecution.mockReset().mockReturnValue({})
  mockAdoptScopedExecution.mockReset().mockReturnValue(undefined)
  mockEndScopedExecution.mockReset().mockReturnValue(true)
  mockIsExecutionStreamHttpError.mockReset().mockReturnValue(false)
  mockIsRunToolActiveForWorkflow.mockReset().mockReturnValue(false)
  mockLoadExecutionPointer.mockReset().mockResolvedValue(null)
  mockReconnect.mockReset().mockResolvedValue(undefined)
  mockResolveStartCandidates.mockReset().mockReturnValue([])
  mockSelectBestTrigger.mockReset().mockReturnValue([])
  mockExecute.mockReset().mockResolvedValue(undefined)
  mockExecuteFromBlock.mockReset().mockResolvedValue(undefined)
  terminalStoreState._hasHydrated = false
  executionStoreState.workflowExecutions.set('workflow-1', idleExecution)
  executionStoreState.getWorkflowExecution.mockReturnValue(idleExecution)
  executionStoreState.getCurrentExecutionId.mockReturnValue(null)
  workflowStoreState.edges.length = 0
  runToolReleaseListeners.clear()
}

/**
 * The store and pointer state a Sim run tool leaves behind the moment it starts
 * a run, before the server has acknowledged it: this is what the reconnect
 * flow reads as an orphaned run.
 */
function primeRunToolOwnedExecution() {
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
}

describe('useWorkflowExecution lifecycle ownership', () => {
  beforeEach(resetWorkflowExecutionTestState)

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

  it('releases unavailable reconnect state without recording a false execution failure', async () => {
    terminalStoreState._hasHydrated = true
    executionStoreState.getWorkflowExecution.mockReturnValue({
      ...idleExecution,
      status: 'running',
      isExecuting: true,
      currentExecutionId: 'execution-1',
    })
    executionStoreState.getCurrentExecutionId.mockReturnValue('execution-1')
    mockLoadExecutionPointer.mockResolvedValue({
      workflowId: 'workflow-1',
      executionId: 'execution-1',
      lastEventId: 3,
    })
    mockReconnect.mockRejectedValueOnce(
      new Error('Execution events pruned before requested event id')
    )
    const { unmount } = renderWorkflowExecutionHook()
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(mockReconnect).toHaveBeenCalledOnce()
    expect(mockHandleExecutionErrorConsole).not.toHaveBeenCalled()
    expect(mockHandleExecutionCancelledConsole).not.toHaveBeenCalled()
    expect(executionStoreState.setCurrentExecutionId).toHaveBeenCalledWith('workflow-1', null)
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

  it('reconnects once the client run tool releases a run whose stream dropped', async () => {
    primeRunToolOwnedExecution()
    mockIsRunToolActiveForWorkflow.mockReturnValue(true)

    const { unmount } = renderWorkflowExecutionHook()
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(mockReconnect).not.toHaveBeenCalled()
    expect(runToolReleaseListeners.size).toBeGreaterThan(0)

    /*
     * What the run tool leaves behind when it gives the run up: no current
     * execution, not executing, ownership released, and the pointer still
     * carrying the last event it persisted.
     */
    executionStoreState.getWorkflowExecution.mockReturnValue({
      ...executionStoreState.getWorkflowExecution(),
      status: 'idle',
      isExecuting: false,
      currentExecutionId: null,
    })
    executionStoreState.getCurrentExecutionId.mockReturnValue(null)
    mockLoadExecutionPointer.mockResolvedValue({
      workflowId: 'workflow-1',
      executionId: 'execution-1',
      lastEventId: 5,
    })
    mockIsRunToolActiveForWorkflow.mockReturnValue(false)
    await act(async () => {
      for (const listener of runToolReleaseListeners) listener('workflow-2')
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(mockReconnect).not.toHaveBeenCalled()

    await act(async () => {
      for (const listener of runToolReleaseListeners) listener('workflow-1')
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mockReconnect).toHaveBeenCalledTimes(1)
    expect(mockReconnect).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: 'workflow-1',
        executionId: 'execution-1',
        fromEventId: 5,
      })
    )
    expect(mockClearExecutionPointer).not.toHaveBeenCalled()

    unmount()
    expect(runToolReleaseListeners.size).toBe(0)
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
})

describe('useWorkflowExecution attachment uploads', () => {
  beforeEach(() => {
    resetWorkflowExecutionTestState()
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
    workflowStoreState.edges.push({ source: 'function-1', target: 'disabledBranch' } as never)
    const currentBlocks = {
      ...workflowBlocks,
      'function-1': {
        id: 'function-1',
        type: 'function',
        name: 'Function 1',
        enabled: true,
        subBlocks: { code: { value: 'return "current editor state"' } },
      },
      disabledBranch: {
        id: 'disabledBranch',
        type: 'slack',
        name: 'Disabled Branch',
        enabled: false,
        subBlocks: {},
      },
      disabledTrigger: {
        ...workflowBlocks.start,
        id: 'disabledTrigger',
        enabled: false,
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

describe('useWorkflowExecution workflow state override', () => {
  beforeEach(() => {
    resetWorkflowExecutionTestState()
    vi.stubGlobal('fetch', mockFetch)
    const startCandidate = {
      blockId: 'start',
      block: workflowBlocks.start,
      path: 'legacy-starter',
    }
    mockResolveStartCandidates.mockReturnValue([startCandidate])
    mockSelectBestTrigger.mockReturnValue([startCandidate])
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.each(['manual', 'chat', 'run-until'] as const)(
    'keeps disabled blocks and edges in %s payloads while excluding disabled triggers',
    async (triggerType) => {
      const blocks = {
        ...workflowBlocks,
        condition1: {
          id: 'condition1',
          type: 'condition',
          name: 'Check',
          enabled: true,
          subBlocks: {},
        },
        disabledBranch: {
          id: 'disabledBranch',
          type: 'slack',
          name: 'Send Empty',
          enabled: false,
          subBlocks: {},
        },
        disabledTrigger: {
          ...workflowBlocks.start,
          id: 'disabledTrigger',
          enabled: false,
        },
      }
      const edges = [
        {
          id: 'edge-1',
          source: 'condition1',
          target: 'disabledBranch',
          sourceHandle: 'condition-else1',
        },
      ]
      workflowStoreState.getWorkflowState.mockReturnValueOnce({
        blocks: { ...blocks, layout: { id: 'layout' } },
        edges,
        loops: {},
        parallels: {},
      })
      const { result, unmount } = renderWorkflowExecutionHook()

      await act(async () => {
        if (triggerType === 'run-until') {
          await result().handleRunUntilBlock('condition1', 'workflow-1')
          return
        }
        const runResult = await result().handleRunWorkflow(
          triggerType === 'chat'
            ? {
                input: 'go',
                conversationId: 'conversation-1',
              }
            : undefined
        )
        await drainStream(runResult)
      })

      expect(mockExecute).toHaveBeenCalledTimes(1)
      const { workflowStateOverride } = mockExecute.mock.calls[0][0]
      const sentBlockIds = new Set(Object.keys(workflowStateOverride.blocks))

      expect(workflowStateOverride.blocks).toEqual(blocks)
      expect(workflowStateOverride.edges).toEqual(edges)
      expect(sentBlockIds.has('disabledBranch')).toBe(true)
      for (const edge of workflowStateOverride.edges) {
        expect(sentBlockIds.has(edge.source)).toBe(true)
        expect(sentBlockIds.has(edge.target)).toBe(true)
      }
      const enabledBlocks = { start: blocks.start, condition1: blocks.condition1 }
      if (triggerType === 'chat') {
        expect(mockFindStartBlock).toHaveBeenCalledWith(enabledBlocks, 'chat')
      } else {
        expect(mockResolveStartCandidates).toHaveBeenCalledWith(enabledBlocks, {
          execution: 'manual',
        })
      }

      unmount()
    }
  )
})
