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
      workflowOperationVersions: {},
      isProcessing: false,
      hasOperationError: false,
    })
    registerEmitFunctions(vi.fn(), vi.fn(), vi.fn(), null)
  })

  afterEach(() => {
    useOperationQueueStore.setState({
      operations: [],
      workflowOperationVersions: {},
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

  it('reverts the operation to pending without retrying when the emit is skipped', () => {
    const skippingEmit = vi.fn(() => false)
    registerEmitFunctions(skippingEmit, vi.fn(), vi.fn(), 'workflow-a')

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

    expect(skippingEmit).toHaveBeenCalledTimes(1)

    const state = useOperationQueueStore.getState()
    expect(state.isProcessing).toBe(false)
    expect(state.hasOperationError).toBe(false)
    expect(state.operations).toEqual([
      expect.objectContaining({ id: 'op-1', status: 'pending', retryCount: 0 }),
    ])
  })

  it('emits a previously skipped operation once the room becomes joinable', () => {
    const skippingEmit = vi.fn(() => false)
    registerEmitFunctions(skippingEmit, vi.fn(), vi.fn(), 'workflow-a')

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

    expect(skippingEmit).toHaveBeenCalledTimes(1)

    const sendingEmit = vi.fn(() => true)
    registerEmitFunctions(sendingEmit, vi.fn(), vi.fn(), 'workflow-a')

    expect(sendingEmit).toHaveBeenCalledWith(
      'workflow-a',
      'replace-state',
      'workflow',
      { state: {} },
      'op-1'
    )
    expect(useOperationQueueStore.getState().operations).toEqual([
      expect.objectContaining({ id: 'op-1', status: 'processing' }),
    ])

    useOperationQueueStore.getState().confirmOperation('op-1')
  })

  it('triggers offline mode for a non-retryable failure and recovers via clearError', () => {
    registerEmitFunctions(
      vi.fn(() => true),
      vi.fn(),
      vi.fn(),
      'workflow-a'
    )

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

    useOperationQueueStore.getState().failOperation('op-1', false)

    expect(useOperationQueueStore.getState().hasOperationError).toBe(true)
    expect(useOperationQueueStore.getState().operations).toEqual([])

    useOperationQueueStore.getState().clearError()

    expect(useOperationQueueStore.getState().hasOperationError).toBe(false)
  })

  it('triggers offline mode once retries exhaust for retryable failures', () => {
    registerEmitFunctions(
      vi.fn(() => true),
      vi.fn(),
      vi.fn(),
      'workflow-a'
    )

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

    useOperationQueueStore.getState().failOperation('op-1', true)
    useOperationQueueStore.getState().failOperation('op-1', true)
    useOperationQueueStore.getState().failOperation('op-1', true)
    expect(useOperationQueueStore.getState().hasOperationError).toBe(false)

    useOperationQueueStore.getState().failOperation('op-1', true)

    expect(useOperationQueueStore.getState().hasOperationError).toBe(true)
    expect(useOperationQueueStore.getState().operations).toEqual([])
  })

  it('reports pending operations per workflow', () => {
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

    expect(useOperationQueueStore.getState().hasPendingOperations('workflow-a')).toBe(true)
    expect(useOperationQueueStore.getState().hasPendingOperations('workflow-b')).toBe(false)
  })

  it('tracks local operation activity per workflow', () => {
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

    expect(useOperationQueueStore.getState().workflowOperationVersions['workflow-a']).toBe(1)
    expect(
      useOperationQueueStore.getState().workflowOperationVersions['workflow-b']
    ).toBeUndefined()
  })

  it('coalesces pending subblock updates to the latest value for the same field', () => {
    useOperationQueueStore.getState().addToQueue({
      id: 'op-1',
      workflowId: 'workflow-a',
      userId: 'user-1',
      operation: {
        operation: 'subblock-update',
        target: 'subblock',
        payload: {
          blockId: 'block-1',
          subblockId: 'prompt',
          value: 'old value',
        },
      },
    })
    useOperationQueueStore.getState().addToQueue({
      id: 'op-2',
      workflowId: 'workflow-a',
      userId: 'user-1',
      operation: {
        operation: 'subblock-update',
        target: 'subblock',
        payload: {
          blockId: 'block-1',
          subblockId: 'prompt',
          value: 'new value',
        },
      },
    })

    expect(useOperationQueueStore.getState().operations).toEqual([
      expect.objectContaining({
        id: 'op-2',
        operation: expect.objectContaining({
          payload: expect.objectContaining({ value: 'new value' }),
        }),
      }),
    ])
  })

  it('does not coalesce matching subblock updates across workflows', () => {
    useOperationQueueStore.getState().addToQueue({
      id: 'op-1',
      workflowId: 'workflow-a',
      userId: 'user-1',
      operation: {
        operation: 'subblock-update',
        target: 'subblock',
        payload: {
          blockId: 'block-1',
          subblockId: 'prompt',
          value: 'workflow a value',
        },
      },
    })
    useOperationQueueStore.getState().addToQueue({
      id: 'op-2',
      workflowId: 'workflow-b',
      userId: 'user-1',
      operation: {
        operation: 'subblock-update',
        target: 'subblock',
        payload: {
          blockId: 'block-1',
          subblockId: 'prompt',
          value: 'workflow b value',
        },
      },
    })

    expect(useOperationQueueStore.getState().operations).toEqual([
      expect.objectContaining({
        id: 'op-1',
        workflowId: 'workflow-a',
      }),
      expect.objectContaining({
        id: 'op-2',
        workflowId: 'workflow-b',
      }),
    ])
  })

  it('coalesces variable field updates without dropping unrelated fields', () => {
    useOperationQueueStore.getState().addToQueue({
      id: 'op-1',
      workflowId: 'workflow-a',
      userId: 'user-1',
      operation: {
        operation: 'variable-update',
        target: 'variable',
        payload: {
          variableId: 'variable-1',
          field: 'value',
          value: 'old value',
        },
      },
    })
    useOperationQueueStore.getState().addToQueue({
      id: 'op-2',
      workflowId: 'workflow-a',
      userId: 'user-1',
      operation: {
        operation: 'variable-update',
        target: 'variable',
        payload: {
          variableId: 'variable-1',
          field: 'name',
          value: 'Variable Name',
        },
      },
    })
    useOperationQueueStore.getState().addToQueue({
      id: 'op-3',
      workflowId: 'workflow-a',
      userId: 'user-1',
      operation: {
        operation: 'variable-update',
        target: 'variable',
        payload: {
          variableId: 'variable-1',
          field: 'value',
          value: 'new value',
        },
      },
    })

    expect(useOperationQueueStore.getState().operations).toEqual([
      expect.objectContaining({
        id: 'op-2',
        operation: expect.objectContaining({
          payload: expect.objectContaining({ field: 'name', value: 'Variable Name' }),
        }),
      }),
      expect.objectContaining({
        id: 'op-3',
        operation: expect.objectContaining({
          payload: expect.objectContaining({ field: 'value', value: 'new value' }),
        }),
      }),
    ])
  })

  it('does not coalesce matching variable updates across workflows', () => {
    useOperationQueueStore.getState().addToQueue({
      id: 'op-1',
      workflowId: 'workflow-a',
      userId: 'user-1',
      operation: {
        operation: 'variable-update',
        target: 'variable',
        payload: {
          variableId: 'variable-1',
          field: 'value',
          value: 'workflow a value',
        },
      },
    })
    useOperationQueueStore.getState().addToQueue({
      id: 'op-2',
      workflowId: 'workflow-b',
      userId: 'user-1',
      operation: {
        operation: 'variable-update',
        target: 'variable',
        payload: {
          variableId: 'variable-1',
          field: 'value',
          value: 'workflow b value',
        },
      },
    })

    expect(useOperationQueueStore.getState().operations).toEqual([
      expect.objectContaining({
        id: 'op-1',
        workflowId: 'workflow-a',
      }),
      expect.objectContaining({
        id: 'op-2',
        workflowId: 'workflow-b',
      }),
    ])
  })

  it('waits for matching workflow operations to drain', async () => {
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

    const drained = useOperationQueueStore.getState().waitForWorkflowOperations('workflow-a')
    useOperationQueueStore.getState().confirmOperation('op-1')

    await expect(drained).resolves.toBe(true)
  })

  it('does not wait on operations from other workflows', async () => {
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

    await expect(
      useOperationQueueStore.getState().waitForWorkflowOperations('workflow-b')
    ).resolves.toBe(true)
  })

  it('stops waiting when an operation error is reported', async () => {
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

    const drained = useOperationQueueStore.getState().waitForWorkflowOperations('workflow-a')
    useOperationQueueStore.setState({ hasOperationError: true })

    await expect(drained).resolves.toBe(false)
  })

  it('stops waiting when matching workflow operations do not drain before timeout', async () => {
    vi.useFakeTimers()
    try {
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

      const drained = useOperationQueueStore.getState().waitForWorkflowOperations('workflow-a', 100)
      await vi.advanceTimersByTimeAsync(100)

      await expect(drained).resolves.toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})
