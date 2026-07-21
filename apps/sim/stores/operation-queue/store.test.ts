/**
 * @vitest-environment node
 */
import Module from 'node:module'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { registerEmitFunctions, useOperationQueueStore } from '@/stores/operation-queue/store'

function addWorkflowOperation(id: string) {
  useOperationQueueStore.getState().addToQueue({
    id,
    workflowId: 'workflow-a',
    userId: 'user-1',
    operation: {
      operation: 'replace-state',
      target: 'workflow',
      payload: { state: { operationId: id } },
    },
  })
}

function addBlockOperation(id: string, blockId: string) {
  useOperationQueueStore.getState().addToQueue({
    id,
    workflowId: 'workflow-a',
    userId: 'user-1',
    operation: {
      operation: 'block-update',
      target: 'block',
      payload: { id: blockId },
    },
  })
}

describe('operation queue room gating', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useOperationQueueStore.setState({
      operations: [],
      workflowOperationVersions: {},
      processingOperationId: null,
      hasOperationError: false,
    })
    registerEmitFunctions(vi.fn(), vi.fn(), vi.fn(), null)
  })

  afterEach(() => {
    useOperationQueueStore.setState({
      operations: [],
      workflowOperationVersions: {},
      processingOperationId: null,
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
    expect(state.processingOperationId).toBeNull()
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

  it('advances exactly once after a successful acknowledgement', () => {
    const workflowEmit = vi.fn(() => true)
    registerEmitFunctions(workflowEmit, vi.fn(), vi.fn(), 'workflow-a')

    addWorkflowOperation('op-1')
    addWorkflowOperation('op-2')

    expect(workflowEmit).toHaveBeenCalledTimes(1)
    expect(useOperationQueueStore.getState().processingOperationId).toBe('op-1')

    useOperationQueueStore.getState().confirmOperation('op-1')

    expect(workflowEmit).toHaveBeenCalledTimes(2)
    expect(useOperationQueueStore.getState().processingOperationId).toBe('op-2')

    useOperationQueueStore.getState().confirmOperation('op-2')

    expect(workflowEmit).toHaveBeenCalledTimes(2)
    expect(useOperationQueueStore.getState().processingOperationId).toBeNull()
    expect(useOperationQueueStore.getState().operations).toEqual([])
  })

  it('advances when an acknowledgement arrives during retry backoff', async () => {
    vi.useFakeTimers()
    try {
      const workflowEmit = vi.fn(() => true)
      registerEmitFunctions(workflowEmit, vi.fn(), vi.fn(), 'workflow-a')

      addWorkflowOperation('op-1')
      addWorkflowOperation('op-2')

      useOperationQueueStore.getState().failOperation('op-1', true)

      expect(workflowEmit).toHaveBeenCalledTimes(1)
      expect(useOperationQueueStore.getState().processingOperationId).toBeNull()
      expect(useOperationQueueStore.getState().operations).toEqual([
        expect.objectContaining({ id: 'op-1', status: 'pending', retryCount: 1 }),
        expect.objectContaining({ id: 'op-2', status: 'pending', retryCount: 0 }),
      ])

      useOperationQueueStore.getState().confirmOperation('op-1')

      expect(workflowEmit).toHaveBeenCalledTimes(2)
      expect(useOperationQueueStore.getState().processingOperationId).toBe('op-2')
      expect(useOperationQueueStore.getState().operations).toEqual([
        expect.objectContaining({ id: 'op-2', status: 'processing' }),
      ])

      await vi.advanceTimersByTimeAsync(2000)

      expect(workflowEmit).toHaveBeenCalledTimes(2)
      expect(useOperationQueueStore.getState().processingOperationId).toBe('op-2')
      useOperationQueueStore.getState().confirmOperation('op-2')
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not release the active operation for an unknown acknowledgement', () => {
    const workflowEmit = vi.fn(() => true)
    registerEmitFunctions(workflowEmit, vi.fn(), vi.fn(), 'workflow-a')

    addWorkflowOperation('op-1')
    addWorkflowOperation('op-2')

    useOperationQueueStore.getState().confirmOperation('unknown-operation')

    expect(workflowEmit).toHaveBeenCalledTimes(1)
    expect(useOperationQueueStore.getState().processingOperationId).toBe('op-1')
    expect(useOperationQueueStore.getState().operations.map((operation) => operation.id)).toEqual([
      'op-1',
      'op-2',
    ])

    useOperationQueueStore.getState().confirmOperation('op-1')
    useOperationQueueStore.getState().confirmOperation('op-2')
  })

  it('does not release the active operation for a stale acknowledgement', () => {
    const workflowEmit = vi.fn(() => true)
    registerEmitFunctions(workflowEmit, vi.fn(), vi.fn(), 'workflow-a')

    addWorkflowOperation('op-1')
    addWorkflowOperation('op-2')
    addWorkflowOperation('op-3')

    useOperationQueueStore.getState().confirmOperation('op-2')

    expect(workflowEmit).toHaveBeenCalledTimes(1)
    expect(useOperationQueueStore.getState().processingOperationId).toBe('op-1')
    expect(useOperationQueueStore.getState().operations.map((operation) => operation.id)).toEqual([
      'op-1',
      'op-3',
    ])

    useOperationQueueStore.getState().confirmOperation('op-1')

    expect(workflowEmit).toHaveBeenCalledTimes(2)
    expect(useOperationQueueStore.getState().processingOperationId).toBe('op-3')
    useOperationQueueStore.getState().confirmOperation('op-3')
  })

  it('ignores a stale failure for a pending operation', () => {
    const workflowEmit = vi.fn(() => true)
    registerEmitFunctions(workflowEmit, vi.fn(), vi.fn(), 'workflow-a')

    addWorkflowOperation('op-1')
    addWorkflowOperation('op-2')

    useOperationQueueStore.getState().failOperation('op-2')

    expect(workflowEmit).toHaveBeenCalledTimes(1)
    expect(useOperationQueueStore.getState().processingOperationId).toBe('op-1')
    expect(useOperationQueueStore.getState().operations).toEqual([
      expect.objectContaining({ id: 'op-1', status: 'processing', retryCount: 0 }),
      expect.objectContaining({ id: 'op-2', status: 'pending', retryCount: 0 }),
    ])

    useOperationQueueStore.getState().confirmOperation('op-1')
    useOperationQueueStore.getState().confirmOperation('op-2')
  })

  it('does not advance when cancelling an unrelated pending operation', () => {
    const workflowEmit = vi.fn(() => true)
    registerEmitFunctions(workflowEmit, vi.fn(), vi.fn(), 'workflow-a')

    addWorkflowOperation('op-1')
    addBlockOperation('op-2', 'block-2')
    addWorkflowOperation('op-3')

    useOperationQueueStore.getState().cancelOperationsForBlock('block-2')

    expect(workflowEmit).toHaveBeenCalledTimes(1)
    expect(useOperationQueueStore.getState().processingOperationId).toBe('op-1')
    expect(useOperationQueueStore.getState().operations.map((operation) => operation.id)).toEqual([
      'op-1',
      'op-3',
    ])

    useOperationQueueStore.getState().confirmOperation('op-1')

    expect(workflowEmit).toHaveBeenCalledTimes(2)
    expect(useOperationQueueStore.getState().processingOperationId).toBe('op-3')
    useOperationQueueStore.getState().confirmOperation('op-3')
  })

  it('releases ownership and advances once when cancelling the active operation', () => {
    const workflowEmit = vi.fn(() => true)
    registerEmitFunctions(workflowEmit, vi.fn(), vi.fn(), 'workflow-a')

    addBlockOperation('op-1', 'block-1')
    addWorkflowOperation('op-2')

    useOperationQueueStore.getState().cancelOperationsForBlock('block-1')

    expect(workflowEmit).toHaveBeenCalledTimes(2)
    expect(useOperationQueueStore.getState().processingOperationId).toBe('op-2')
    expect(useOperationQueueStore.getState().operations).toEqual([
      expect.objectContaining({ id: 'op-2', status: 'processing' }),
    ])

    useOperationQueueStore.getState().confirmOperation('op-2')
    expect(workflowEmit).toHaveBeenCalledTimes(2)
    expect(useOperationQueueStore.getState().processingOperationId).toBeNull()
  })

  it('drops a failed operation with a missing target and advances once', () => {
    const originalRequire = Module.prototype.require
    const requireSpy = vi.spyOn(Module.prototype, 'require').mockImplementation(function (
      moduleId: string
    ) {
      if (moduleId === '@/stores/workflows/workflow/store') {
        return { useWorkflowStore: { getState: () => ({ blocks: {} }) } }
      }
      return originalRequire.call(this, moduleId)
    })

    try {
      const workflowEmit = vi.fn(() => true)
      registerEmitFunctions(workflowEmit, vi.fn(), vi.fn(), 'workflow-a')

      addBlockOperation('op-1', 'missing-block')
      addWorkflowOperation('op-2')

      useOperationQueueStore.getState().failOperation('op-1', false)

      expect(workflowEmit).toHaveBeenCalledTimes(2)
      expect(useOperationQueueStore.getState().hasOperationError).toBe(false)
      expect(useOperationQueueStore.getState().processingOperationId).toBe('op-2')
      expect(useOperationQueueStore.getState().operations).toEqual([
        expect.objectContaining({ id: 'op-2', status: 'processing' }),
      ])

      useOperationQueueStore.getState().confirmOperation('op-2')
    } finally {
      requireSpy.mockRestore()
    }
  })

  it('triggers offline mode for a non-retryable failure and recovers via clearError', () => {
    const workflowEmit = vi.fn(() => true)
    registerEmitFunctions(workflowEmit, vi.fn(), vi.fn(), 'workflow-a')

    addWorkflowOperation('op-1')
    addWorkflowOperation('op-2')

    useOperationQueueStore.getState().failOperation('op-1', false)

    expect(workflowEmit).toHaveBeenCalledTimes(1)
    expect(useOperationQueueStore.getState().hasOperationError).toBe(true)
    expect(useOperationQueueStore.getState().operations).toEqual([])
    expect(useOperationQueueStore.getState().processingOperationId).toBeNull()

    useOperationQueueStore.getState().clearError()

    expect(useOperationQueueStore.getState().hasOperationError).toBe(false)
  })

  it('retries only after ownership is reacquired and enters offline mode after max retries', async () => {
    vi.useFakeTimers()
    try {
      const workflowEmit = vi.fn(() => true)
      registerEmitFunctions(workflowEmit, vi.fn(), vi.fn(), 'workflow-a')
      addWorkflowOperation('op-1')

      for (const delay of [2000, 4000, 8000]) {
        useOperationQueueStore.getState().failOperation('op-1', true)

        expect(useOperationQueueStore.getState().processingOperationId).toBeNull()
        expect(useOperationQueueStore.getState().hasOperationError).toBe(false)

        await vi.advanceTimersByTimeAsync(delay)
        expect(useOperationQueueStore.getState().processingOperationId).toBe('op-1')
      }

      useOperationQueueStore.getState().failOperation('op-1', true)

      expect(workflowEmit).toHaveBeenCalledTimes(4)
      expect(useOperationQueueStore.getState().hasOperationError).toBe(true)
      expect(useOperationQueueStore.getState().operations).toEqual([])
      expect(useOperationQueueStore.getState().processingOperationId).toBeNull()
    } finally {
      vi.useRealTimers()
    }
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
