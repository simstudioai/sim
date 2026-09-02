/**
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  clearExecutionPointer,
  executeWorkflowWithFullLogging,
  getWorkflowEntries,
  loadExecutionPointer,
  MockExecutionStreamHttpError,
  MockSSEEventHandlerError,
  MockSSEStreamInterruptedError,
  saveExecutionPointer,
  setActiveWorkflow,
} = vi.hoisted(() => ({
  clearExecutionPointer: vi.fn(),
  executeWorkflowWithFullLogging: vi.fn(),
  getWorkflowEntries: vi.fn(() => []),
  loadExecutionPointer: vi.fn(),
  MockExecutionStreamHttpError: class ExecutionStreamHttpError extends Error {
    constructor(
      message: string,
      public readonly httpStatus: number,
      public readonly code?: string
    ) {
      super(message)
      this.name = 'ExecutionStreamHttpError'
    }
  },
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

// Neutralize the confirm-retry backoff so exhaustion tests stay fast.
vi.mock('@sim/utils/retry', () => ({
  backoffWithJitter: () => 0,
}))

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
  ExecutionStreamHttpError: MockExecutionStreamHttpError,
  isExecutionStreamHttpError: (error: unknown) => error instanceof MockExecutionStreamHttpError,
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
    executionStarted: vi.fn(() => ({})),
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
  isRunToolActiveForId,
  isRunToolActiveForWorkflow,
  reportManualRunToolStop,
  subscribeToRunToolRelease,
} from './run-tool-execution'

describe('run tool execution cancellation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.sessionStorage.clear()
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

  it('owns the workflow for exactly as long as the client run is in flight', async () => {
    executeWorkflowWithFullLogging.mockImplementationOnce(async (options: any) => {
      await new Promise((_, reject) => {
        options.abortSignal.addEventListener(
          'abort',
          () => reject(new DOMException('Aborted', 'AbortError')),
          { once: true }
        )
      })
    })
    let ownedWhenPointerSaved: boolean | undefined
    saveExecutionPointer.mockImplementationOnce(() => {
      ownedWhenPointerSaved = isRunToolActiveForWorkflow('wf-1')
    })
    expect(isRunToolActiveForWorkflow('wf-1')).toBe(false)

    executeRunToolOnClient('tool-1', 'run_workflow', { workflowId: 'wf-1' })
    await Promise.resolve()
    const ownedWhileInFlight = isRunToolActiveForWorkflow('wf-1')
    const otherWorkflowOwnedWhileInFlight = isRunToolActiveForWorkflow('wf-2')

    cancelRunToolExecution('wf-1')
    await vi.waitFor(() => expect(clearExecutionPointer).toHaveBeenCalledWith('wf-1'))

    expect(ownedWhenPointerSaved).toBe(true)
    expect(ownedWhileInFlight).toBe(true)
    expect(otherWorkflowOwnedWhileInFlight).toBe(false)
    expect(saveExecutionPointer).toHaveBeenCalledWith(
      expect.objectContaining({ workflowId: 'wf-1', lastEventId: 0 })
    )
    expect(isRunToolActiveForWorkflow('wf-1')).toBe(false)
  })

  it.each([
    ['handler', new MockSSEEventHandlerError('Block handler failed on event 7', 'exec-1')],
    ['transport', new MockSSEStreamInterruptedError('Execution stream interrupted', 'exec-1')],
  ])(
    'releases a run whose stream was cut by a %s failure only after giving up ownership',
    async (_kind, interruption) => {
      const ownedAtRelease: boolean[] = []
      const listener = vi.fn((workflowId: string) => {
        ownedAtRelease.push(isRunToolActiveForWorkflow(workflowId))
      })
      const unsubscribe = subscribeToRunToolRelease(listener)
      executeWorkflowWithFullLogging.mockRejectedValueOnce(interruption)

      try {
        executeRunToolOnClient('tool-1', 'run_workflow', { workflowId: 'wf-1' })
        await vi.waitFor(() => expect(listener).toHaveBeenCalledWith('wf-1'))

        expect(listener).toHaveBeenCalledTimes(1)
        expect(ownedAtRelease).toEqual([false])
        expect(setIsExecuting).toHaveBeenCalledWith('wf-1', false)
        expect(setCurrentExecutionId).toHaveBeenCalledWith('wf-1', null)
        expect(setIsExecuting.mock.invocationCallOrder.at(-1)).toBeLessThan(
          listener.mock.invocationCallOrder[0]
        )
        expect(clearExecutionPointer).not.toHaveBeenCalled()
        expect(fetch).toHaveBeenCalledWith(
          '/api/copilot/confirm',
          expect.objectContaining({
            body: expect.stringContaining('"status":"background"'),
          })
        )
        expect(vi.mocked(fetch).mock.calls[0][1]?.body).toContain('"executionId":"exec-1"')
      } finally {
        unsubscribe()
      }
    }
  )

  it('does not release a run it observed to completion, even when the report fails', async () => {
    const listener = vi.fn()
    const unsubscribe = subscribeToRunToolRelease(listener)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))
    executeWorkflowWithFullLogging.mockResolvedValueOnce({ success: true })

    try {
      executeRunToolOnClient('tool-1', 'run_workflow', { workflowId: 'wf-1' })
      await vi.waitFor(() => expect(isRunToolActiveForWorkflow('wf-1')).toBe(false))

      expect(listener).not.toHaveBeenCalled()
      expect(clearExecutionPointer).not.toHaveBeenCalled()
    } finally {
      unsubscribe()
    }
  })

  it('can report a manual stop using the explicit toolCallId override', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)
    getCurrentExecutionId.mockReturnValueOnce('exec-manual')

    await reportManualRunToolStop('wf-1', 'tool-override')

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/copilot/confirm',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"toolCallId":"tool-override"'),
      })
    )
    expect(fetchMock.mock.calls[0][1]?.body).toContain('"executionId":"exec-manual"')
  })

  it('prefers workflow_input, forwards triggerBlockId, and respects useDeployedState', async () => {
    executeWorkflowWithFullLogging.mockResolvedValueOnce({
      success: true,
      output: { token: 'raw-secret-output' },
      logs: [{ output: 'raw-secret-log' }],
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
    const executionId = executeWorkflowWithFullLogging.mock.calls[0][0].executionId
    await vi.waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/api/copilot/confirm',
        expect.objectContaining({
          body: expect.stringContaining(`"executionId":"${executionId}"`),
        })
      )
    })
    expect(fetch.mock.calls[0][1]?.body).not.toContain('raw-secret')
  })

  it('queues run_workflow asynchronously and reports the execution as background', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 202,
        json: vi.fn().mockResolvedValue({
          success: true,
          async: true,
          executionId: 'exec-async',
        }),
      })
      .mockResolvedValueOnce({ ok: true })
    vi.stubGlobal('fetch', fetchMock)

    executeRunToolOnClient('tool-async', 'run_workflow', {
      workflowId: 'wf-1',
      workflow_input: { prompt: 'long-running task' },
      triggerBlockId: 'trigger-async',
      async: true,
    })

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))

    expect(executeWorkflowWithFullLogging).not.toHaveBeenCalled()
    expect(setIsExecuting).not.toHaveBeenCalled()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/workflows/wf-1/execute')
    expect(fetchMock.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Execution-Mode': 'async',
        },
      })
    )
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toMatchObject({
      input: { prompt: 'long-running task' },
      triggerType: 'copilot',
      triggerBlockId: 'trigger-async',
      isClientSession: true,
      copilotToolCallId: 'tool-async',
    })
    expect(fetchMock.mock.calls[1][0]).toBe('/api/copilot/confirm')
    expect(fetchMock.mock.calls[1][1]?.body).toContain('"status":"background"')
    expect(fetchMock.mock.calls[1][1]?.body).toContain('"executionId":"exec-async"')
    // An async run has no reconnectable stream, so it must never leave the
    // terminal a pointer that a reconnect would 404 against.
    expect(saveExecutionPointer).not.toHaveBeenCalled()
    expect(clearExecutionPointer).not.toHaveBeenCalled()
    expect(window.sessionStorage.getItem('sim:copilot:run-tool-completion:tool-async')).toBeNull()
  })

  it('recovers a queued async launch by re-reporting it without enqueueing again', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 202,
        json: vi.fn().mockResolvedValue({ executionId: 'exec-recover-async' }),
      })
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)

    executeRunToolOnClient('tool-recover-async', 'run_workflow', {
      workflowId: 'wf-1',
      async: true,
    })

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(6))
    await vi.waitFor(() => expect(isRunToolActiveForId('tool-recover-async')).toBe(false))
    expect(saveExecutionPointer).not.toHaveBeenCalled()
    expect(
      window.sessionStorage.getItem('sim:copilot:run-tool-completion:tool-recover-async')
    ).toContain('"executionId":"exec-recover-async"')

    await expect(bindRunToolToExecution('tool-recover-async', 'wf-1')).resolves.toBe(true)

    expect(fetchMock).toHaveBeenCalledTimes(7)
    expect(fetchMock.mock.calls[6][0]).toBe('/api/copilot/confirm')
    expect(fetchMock.mock.calls[6][1]?.body).toContain('"status":"background"')
    expect(fetchMock.mock.calls[6][1]?.body).toContain('"executionId":"exec-recover-async"')
    expect(
      fetchMock.mock.calls.filter(([url]) => url === '/api/workflows/wf-1/execute')
    ).toHaveLength(1)
    expect(clearExecutionPointer).not.toHaveBeenCalled()
    expect(
      window.sessionStorage.getItem('sim:copilot:run-tool-completion:tool-recover-async')
    ).toBeNull()
  })

  it('cleans up the terminal pointer an earlier client left for an async launch', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)
    loadExecutionPointer.mockResolvedValueOnce({
      workflowId: 'wf-1',
      executionId: 'exec-legacy-async',
      lastEventId: 0,
    })
    window.sessionStorage.setItem(
      'sim:copilot:run-tool-completion:tool-legacy-async',
      JSON.stringify({
        status: 'background',
        executionId: 'exec-legacy-async',
        clearExecutionPointerAfterReport: true,
      })
    )

    await expect(bindRunToolToExecution('tool-legacy-async', 'wf-1')).resolves.toBe(true)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][1]?.body).toContain('"status":"background"')
    expect(fetchMock.mock.calls[0][1]?.body).toContain('"executionId":"exec-legacy-async"')
    expect(clearExecutionPointer).toHaveBeenCalledWith('wf-1')
  })

  it('reports a stale deployment as an async tool failure without queueing completion', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: vi.fn().mockResolvedValue({
          error: 'Async execution requires the current workflow to match its deployed version',
          code: 'ASYNC_WORKFLOW_DEPLOYMENT_STALE',
        }),
      })
      .mockResolvedValueOnce({ ok: true })
    vi.stubGlobal('fetch', fetchMock)

    executeRunToolOnClient('tool-stale', 'run_workflow', {
      workflowId: 'wf-1',
      async: true,
    })

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))

    expect(fetchMock.mock.calls[1][0]).toBe('/api/copilot/confirm')
    expect(fetchMock.mock.calls[1][1]?.body).toContain('"status":"error"')
    expect(fetchMock.mock.calls[1][1]?.body).toContain(
      'Async execution requires the current workflow to match its deployed version'
    )
    expect(fetchMock.mock.calls[1][1]?.body).toContain('"code":"ASYNC_WORKFLOW_DEPLOYMENT_STALE"')
    expect(fetchMock.mock.calls[1][1]?.body).not.toContain('"status":"background"')
  })

  it('reports the workflow execution id with terminal error results', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)
    executeWorkflowWithFullLogging.mockResolvedValueOnce({
      success: false,
      output: {},
      error: 'workflow failed',
      logs: [],
    })

    executeRunToolOnClient('tool-error', 'run_workflow', { workflowId: 'wf-1' })

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/copilot/confirm',
        expect.objectContaining({
          body: expect.stringContaining('"status":"error"'),
        })
      )
    })
    const executionId = executeWorkflowWithFullLogging.mock.calls[0][0].executionId
    expect(fetchMock.mock.calls[0][1]?.body).toContain(`"executionId":"${executionId}"`)
    expect(fetchMock.mock.calls[0][1]?.body).not.toContain('workflow failed')
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
    expect(fetchMock.mock.calls[0][1]?.body).toContain('"executionId":"exec-existing"')
  })

  it('strips raw payloads from legacy pending completion recovery', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)
    loadExecutionPointer.mockResolvedValueOnce({
      workflowId: 'wf-1',
      executionId: 'exec-existing',
      lastEventId: 7,
    })
    window.sessionStorage.setItem(
      'sim:copilot:run-tool-completion:tool-recovered',
      JSON.stringify({
        status: 'success',
        message: 'legacy raw-secret-error',
        data: { output: 'legacy raw-secret-output', logs: ['legacy raw-secret-log'] },
        executionId: 'exec-existing',
      })
    )

    await expect(bindRunToolToExecution('tool-recovered', 'wf-1')).resolves.toBe(true)

    const body = fetchMock.mock.calls[0][1]?.body
    expect(body).toContain('"status":"success"')
    expect(body).toContain('"executionId":"exec-existing"')
    expect(body).not.toContain('raw-secret')
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
    expect(fetchMock.mock.calls[0][1]?.body).toContain('"executionId":"exec-1"')
    expect(fetchMock).not.toHaveBeenCalledWith(
      '/api/copilot/confirm',
      expect.objectContaining({
        body: expect.stringContaining('"status":"error"'),
      })
    )
  })

  it('reports the real failure reason so the agent can correct its arguments', async () => {
    // A generic "Workflow execution failed." told the model nothing, so it could
    // not fix a rejected binding or an undeployed workflow on retry.
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)
    executeWorkflowWithFullLogging.mockRejectedValueOnce(
      new MockExecutionStreamHttpError(
        'This Copilot workflow tool call is bound to a different workflow',
        403,
        'COPILOT_WORKFLOW_TOOL_BINDING_WORKFLOW_MISMATCH'
      )
    )

    executeRunToolOnClient('tool-binding-rejected', 'run_workflow', { workflowId: 'wf-1' })

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/copilot/confirm',
        expect.objectContaining({
          body: expect.stringContaining('COPILOT_WORKFLOW_TOOL_BINDING_WORKFLOW_MISMATCH'),
        })
      )
    })
    const confirmBody = JSON.parse(
      fetchMock.mock.calls.find(([url]) => url === '/api/copilot/confirm')?.[1]?.body as string
    )
    expect(confirmBody.message).toBe(
      'This Copilot workflow tool call is bound to a different workflow'
    )
    expect(confirmBody.status).toBe('error')
  })

  it('drops a duplicate async launch without confirming or surfacing an error', async () => {
    // The server fallback (or another tab) already claimed this tool call.
    // Reporting an error here would overwrite a run that is in flight.
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: vi.fn().mockResolvedValue({
        error: 'Copilot workflow tool is already bound to another execution',
        code: 'COPILOT_WORKFLOW_EXECUTION_CONFLICT',
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    executeRunToolOnClient('tool-async-duplicate', 'run_workflow', {
      workflowId: 'wf-1',
      async: true,
    })

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    // Only the execute attempt — never a /api/copilot/confirm report.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/workflows/wf-1/execute')
    expect(saveExecutionPointer).not.toHaveBeenCalled()
  })

  it('drops a duplicate client runner without confirming or surfacing an error', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)
    executeWorkflowWithFullLogging.mockRejectedValueOnce(
      new MockExecutionStreamHttpError(
        'Copilot workflow execution is already owned by another client',
        409,
        'COPILOT_WORKFLOW_EXECUTION_CONFLICT'
      )
    )

    executeRunToolOnClient('tool-duplicate', 'run_workflow', { workflowId: 'wf-1' })

    await vi.waitFor(() => {
      expect(clearExecutionPointer).toHaveBeenCalledWith('wf-1')
    })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(setIsExecuting).toHaveBeenCalledWith('wf-1', false)
  })
})
