/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { registerEmitFunctions, useOperationQueueStore } from '@/stores/operation-queue/store'

describe('operation queue room gating', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useOperationQueueStore.setState({
      operations: [],
      isProcessing: false,
      hasOperationError: false,
    })
    registerEmitFunctions(vi.fn(), vi.fn(), vi.fn(), null)
  })

  afterEach(() => {
    useOperationQueueStore.setState({
      operations: [],
      isProcessing: false,
      hasOperationError: false,
    })
    registerEmitFunctions(vi.fn(), vi.fn(), vi.fn(), null)
  })

  it('does not process workflow operations while no workflow is registered', () => {
    const workflowEmit = vi.fn()
    registerEmitFunctions(workflowEmit, vi.fn(), vi.fn(), null)

    useOperationQueueStore.getState().addToQueue({
      id: 'op-1',
      workflowId: 'workflow-a',
      userId: 'user-1',
      operation: {
        operation: 'replace-state',
        target: 'workflow',
        payload: { state: {} },
      },
    })

    expect(workflowEmit).not.toHaveBeenCalled()
  })

  it('waits until the matching workflow is registered before emitting', () => {
    const workflowEmit = vi.fn()
    registerEmitFunctions(workflowEmit, vi.fn(), vi.fn(), null)

    useOperationQueueStore.getState().addToQueue({
      id: 'op-1',
      workflowId: 'workflow-a',
      userId: 'user-1',
      operation: {
        operation: 'replace-state',
        target: 'workflow',
        payload: { state: {} },
      },
    })

    registerEmitFunctions(workflowEmit, vi.fn(), vi.fn(), 'workflow-b')
    expect(workflowEmit).not.toHaveBeenCalled()

    registerEmitFunctions(workflowEmit, vi.fn(), vi.fn(), 'workflow-a')
    expect(workflowEmit).toHaveBeenCalledWith(
      'workflow-a',
      'replace-state',
      'workflow',
      { state: {} },
      'op-1'
    )

    useOperationQueueStore.getState().confirmOperation('op-1')
  })
})
