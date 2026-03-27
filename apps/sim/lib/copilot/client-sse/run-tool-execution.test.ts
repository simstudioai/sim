/**
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { executeWorkflowWithFullLogging } = vi.hoisted(() => ({
  executeWorkflowWithFullLogging: vi.fn(),
}))

const setIsExecuting = vi.fn()
const setCurrentExecutionId = vi.fn()
const getWorkflowExecution = vi.fn(() => ({ isExecuting: false }))

vi.mock('@/app/workspace/[workspaceId]/w/[workflowId]/utils/workflow-execution-utils', () => ({
  executeWorkflowWithFullLogging,
}))

vi.mock('@/stores/execution/store', () => ({
  useExecutionStore: {
    getState: () => ({
      getWorkflowExecution,
      setIsExecuting,
      setCurrentExecutionId,
    }),
  },
}))

vi.mock('@/stores/workflows/registry/store', () => ({
  useWorkflowRegistry: {
    getState: () => ({
      activeWorkflowId: 'wf-1',
      setActiveWorkflow: vi.fn(),
    }),
  },
}))

vi.mock('@/stores/terminal', () => ({
  consolePersistence: {
    executionStarted: vi.fn(),
    executionEnded: vi.fn(),
    persist: vi.fn(),
  },
  saveExecutionPointer: vi.fn(),
  clearExecutionPointer: vi.fn(),
}))

import {
  cancelRunToolExecution,
  executeRunToolOnClient,
  reportManualRunToolStop,
} from './run-tool-execution'

describe('run tool execution cancellation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
})
