/**
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  clearExecutionPointer,
  executeWorkflowWithFullLogging,
  getWorkflowEntries,
  loadExecutionPointer,
  MockSSEEventHandlerError,
  MockSSEStreamInterruptedError,
  saveExecutionPointer,
  setActiveWorkflow,
} = vi.hoisted(() => ({
  clearExecutionPointer: vi.fn(),
  executeWorkflowWithFullLogging: vi.fn(),
  getWorkflowEntries: vi.fn(() => []),
  loadExecutionPointer: vi.fn(),
  MockSSEEventHandlerError: class SSEEventHandlerError extends Error {
    executionId?: string

    constructor(message: string, executionId?: string) {
      super(message)
      this.name = 'SSEEventHandlerError'
      this.executionId = executionId
    }
  },
  MockSSEStreamInterruptedError: class SSEStreamInterruptedError extends Error {
    executionId?: string

    constructor(message: string, executionId?: string) {
      super(message)
      this.name = 'SSEStreamInterruptedError'
      this.executionId = executionId
    }
  },
  saveExecutionPointer: vi.fn(),
  setActiveWorkflow: vi.fn(),
}))

const setIsExecuting = vi.fn()
const setActiveBlocks = vi.fn()
const setCurrentExecutionId = vi.fn()
const getCurrentExecutionId = vi.fn()
const getWorkflowExecution = vi.fn(() => ({ isExecuting: false }))

vi.mock('@/app/workspace/[workspaceId]/w/[workflowId]/utils/workflow-execution-utils', () => ({
  executeWorkflowWithFullLogging,
}))

vi.mock('@/stores/execution/store', () => ({
  useExecutionStore: {
    getState: () => ({
      getCurrentExecutionId,
      getWorkflowExecution,
      setActiveBlocks,
      setIsExecuting,
      setCurrentExecutionId,
    }),
  },
}))

vi.mock('@/hooks/use-execution-stream', () => ({
  SSEEventHandlerError: MockSSEEventHandlerError,
  SSEStreamInterruptedError: MockSSEStreamInterruptedError,
}))

vi.mock('@/stores/workflows/registry/store', () => ({
  useWorkflowRegistry: {
    getState: () => ({
      activeWorkflowId: 'wf-1',
      setActiveWorkflow,
    }),
  },
}))

vi.mock('@/stores/terminal', () => ({
  consolePersistence: {
    executionStarted: vi.fn(),
    executionEnded: vi.fn(),
    persist: vi.fn(),
  },
  clearExecutionPointer,
  loadExecutionPointer,
  saveExecutionPointer,
  useTerminalConsoleStore: {
    getState: () => ({
      getWorkflowEntries,
    }),
  },
}))

import {
  bindRunToolToExecution,
  cancelRunToolExecution,
  executeRunToolOnClient,
  reportManualRunToolStop,
} from './run-tool-execution'

describe('run tool execution cancellation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getCurrentExecutionId.mockReturnValue(null)
    getWorkflowEntries.mockReturnValue([])
    loadExecutionPointer.mockResolvedValue(null)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
  })

  it('passes an abort signal into executeWorkflowWithFullLogging and aborts it', async () => {
    let capturedSignal: AbortSignal | undefined
    executeWorkflowWithFullLogging.mockImplementationOnce(async (options: any) => {
      capturedSignal = options.abortSignal
      await new Promise((_, reject) => {
        options.abortSignal.addEventListener(
          'abort',
          () => reject(new DOMException('Aborted', 'AbortError')),
          { once: true }
        )
      })
    })

    executeRunToolOnClient('tool-1', 'run_workflow', { workflowId: 'wf-1' })
    await Promise.resolve()

    cancelRunToolExecution('wf-1')
    await Promise.resolve()

    expect(capturedSignal?.aborted).toBe(true)
  })

  it('can report a manual stop using the explicit toolCallId override', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)

    await reportManualRunToolStop('wf-1', 'tool-override')

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/copilot/confirm',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"toolCallId":"tool-override"'),
      })
    )
  })

  it('prefers workflow_input, forwards triggerBlockId, and respects useDeployedState', async () => {
    executeWorkflowWithFullLogging.mockResolvedValueOnce({
      success: true,
      output: { ok: true },
      logs: [],
    })

    executeRunToolOnClient('tool-2', 'run_workflow', {
      workflowId: 'wf-1',
      workflow_input: { prompt: 'preferred' },
      input: { prompt: 'fallback' },
      triggerBlockId: 'trigger-1',
      useDeployedState: true,
    })

    await Promise.resolve()
    await Promise.resolve()

    expect(executeWorkflowWithFullLogging).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: 'wf-1',
        workflowInput: { prompt: 'preferred' },
        overrideTriggerType: 'copilot',
        triggerBlockId: 'trigger-1',
        useDraftState: false,
      })
    )
  })

  it('treats a tab-local execution pointer as handled in background', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)
    loadExecutionPointer.mockResolvedValueOnce({
      workflowId: 'wf-1',
      executionId: 'exec-existing',
      lastEventId: 7,
    })

    await expect(bindRunToolToExecution('tool-3', 'wf-1')).resolves.toBe(true)

    expect(setActiveWorkflow).not.toHaveBeenCalled()
    expect(setIsExecuting).not.toHaveBeenCalled()
    expect(setCurrentExecutionId).not.toHaveBeenCalled()
    expect(saveExecutionPointer).not.toHaveBeenCalled()
    expect(executeWorkflowWithFullLogging).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/copilot/confirm',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"status":"background"'),
      })
    )
  })

  it('does not recover from shared console rows without a tab-local pointer', async () => {
    loadExecutionPointer.mockResolvedValueOnce(null)
    getWorkflowEntries.mockReturnValueOnce([
      {
        workflowId: 'wf-1',
        executionId: 'exec-shared',
        isRunning: true,
        startedAt: new Date().toISOString(),
      },
    ])

    await expect(bindRunToolToExecution('tool-4', 'wf-1')).resolves.toBe(false)

    expect(setActiveWorkflow).not.toHaveBeenCalled()
    expect(setIsExecuting).not.toHaveBeenCalled()
    expect(setCurrentExecutionId).not.toHaveBeenCalled()
    expect(saveExecutionPointer).not.toHaveBeenCalled()
  })

  it('reports local stream handler failures as background instead of workflow errors', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)
    getCurrentExecutionId.mockImplementation(
      () => saveExecutionPointer.mock.calls[0]?.[0]?.executionId ?? null
    )
    executeWorkflowWithFullLogging.mockRejectedValueOnce(
      new MockSSEEventHandlerError('handler failed', 'exec-1')
    )

    executeRunToolOnClient('tool-5', 'run_workflow', { workflowId: 'wf-1' })

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/copilot/confirm',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"status":"background"'),
        })
      )
    })
    expect(clearExecutionPointer).not.toHaveBeenCalled()
    expect(setIsExecuting).toHaveBeenCalledWith('wf-1', false)
    expect(fetchMock).not.toHaveBeenCalledWith(
      '/api/copilot/confirm',
      expect.objectContaining({
        body: expect.stringContaining('"status":"error"'),
      })
    )
  })
})
