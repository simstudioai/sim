import { createLogger } from '@sim/logger'
import { create } from 'zustand'
import type { OperationQueueState, QueuedOperation } from './types'

const logger = createLogger('OperationQueue')

/** Timeout for subblock/variable operations before considering them failed */
const SUBBLOCK_VARIABLE_TIMEOUT_MS = 15000
/** Timeout for structural operations before considering them failed */
const STRUCTURAL_TIMEOUT_MS = 5000
/** Maximum retry attempts for subblock/variable operations */
const SUBBLOCK_VARIABLE_MAX_RETRIES = 5
/** Maximum retry attempts for structural operations */
const STRUCTURAL_MAX_RETRIES = 3
/** Maximum retry delay cap for subblock/variable operations */
const SUBBLOCK_VARIABLE_MAX_RETRY_DELAY_MS = 3000
/** Base retry delay multiplier (1s, 2s, 3s for linear) */
const RETRY_DELAY_BASE_MS = 1000

const retryTimeouts = new Map<string, NodeJS.Timeout>()
const operationTimeouts = new Map<string, NodeJS.Timeout>()

let emitWorkflowOperation:
  | ((operation: string, target: string, payload: any, operationId?: string) => void)
  | null = null
let emitSubblockUpdate:
  | ((
      blockId: string,
      subblockId: string,
      value: any,
      operationId: string | undefined,
      workflowId: string
    ) => void)
  | null = null
let emitVariableUpdate:
  | ((
      variableId: string,
      field: string,
      value: any,
      operationId: string | undefined,
      workflowId: string
    ) => void)
  | null = null

export function registerEmitFunctions(
  workflowEmit: (operation: string, target: string, payload: any, operationId?: string) => void,
  subblockEmit: (
    blockId: string,
    subblockId: string,
    value: any,
    operationId: string | undefined,
    workflowId: string
  ) => void,
  variableEmit: (
    variableId: string,
    field: string,
    value: any,
    operationId: string | undefined,
    workflowId: string
  ) => void,
  workflowId: string | null
) {
  emitWorkflowOperation = workflowEmit
  emitSubblockUpdate = subblockEmit
  emitVariableUpdate = variableEmit
  currentRegisteredWorkflowId = workflowId
  if (workflowId) {
    useOperationQueueStore.getState().processNextOperation()
  }
}

let currentRegisteredWorkflowId: string | null = null

export const useOperationQueueStore = create<OperationQueueState>((set, get) => ({
  operations: [],
  isProcessing: false,
  hasOperationError: false,

  addToQueue: (operation) => {
    if (
      operation.operation.operation === 'subblock-update' &&
      operation.operation.target === 'subblock'
    ) {
      const { blockId, subblockId } = operation.operation.payload
      set((state) => ({
        operations: [
          ...state.operations.filter(
            (op) =>
              !(
                op.status === 'pending' &&
                op.operation.operation === 'subblock-update' &&
                op.operation.target === 'subblock' &&
                op.operation.payload?.blockId === blockId &&
                op.operation.payload?.subblockId === subblockId
              )
          ),
        ],
      }))
    }

    if (
      operation.operation.operation === 'variable-update' &&
      operation.operation.target === 'variable'
    ) {
      const { variableId, field } = operation.operation.payload
      set((state) => ({
        operations: [
          ...state.operations.filter(
            (op) =>
              !(
                op.status === 'pending' &&
                op.operation.operation === 'variable-update' &&
                op.operation.target === 'variable' &&
                op.operation.payload?.variableId === variableId &&
                op.operation.payload?.field === field
              )
          ),
        ],
      }))
    }

    const state = get()

    const existingOp = state.operations.find((op) => op.id === operation.id)
    if (existingOp) {
      logger.debug('Skipping duplicate operation ID', {
        operationId: operation.id,
        existingStatus: existingOp.status,
      })
      return
    }

    const duplicateContent = state.operations.find(
      (op) =>
        op.operation.operation === operation.operation.operation &&
        op.operation.target === operation.operation.target &&
        op.workflowId === operation.workflowId &&
        ((operation.operation.target === 'block' &&
          op.operation.payload?.id === operation.operation.payload?.id) ||
          (operation.operation.target !== 'block' &&
            JSON.stringify(op.operation.payload) === JSON.stringify(operation.operation.payload)))
    )

    const isReplaceStateWorkflowOp =
      operation.operation.target === 'workflow' && operation.operation.operation === 'replace-state'

    if (duplicateContent && !isReplaceStateWorkflowOp) {
      logger.debug('Skipping duplicate operation content', {
        operationId: operation.id,
        existingOperationId: duplicateContent.id,
        operation: operation.operation.operation,
        target: operation.operation.target,
        existingStatus: duplicateContent.status,
        payload:
          operation.operation.target === 'block'
            ? { id: operation.operation.payload?.id }
            : operation.operation.payload,
      })
      return
    }

    const queuedOp: QueuedOperation = {
      ...operation,
      timestamp: Date.now(),
      retryCount: 0,
      status: 'pending',
    }

    logger.debug('Adding operation to queue', {
      operationId: queuedOp.id,
      operation: queuedOp.operation,
    })

    set((state) => ({
      operations: [...state.operations, queuedOp],
    }))

    get().processNextOperation()
  },

  confirmOperation: (operationId) => {
    const state = get()
    const operation = state.operations.find((op) => op.id === operationId)
    const newOperations = state.operations.filter((op) => op.id !== operationId)

    const retryTimeout = retryTimeouts.get(operationId)
    if (retryTimeout) {
      clearTimeout(retryTimeout)
      retryTimeouts.delete(operationId)
    }

    const operationTimeout = operationTimeouts.get(operationId)
    if (operationTimeout) {
      clearTimeout(operationTimeout)
      operationTimeouts.delete(operationId)
    }

    logger.debug('Removing operation from queue', {
      operationId,
      remainingOps: newOperations.length,
    })

    set({ operations: newOperations, isProcessing: false })

    get().processNextOperation()
  },

  failOperation: (operationId: string, retryable = true) => {
    const state = get()
    const operation = state.operations.find((op) => op.id === operationId)
    if (!operation) {
      logger.warn('Attempted to fail operation that does not exist in queue', { operationId })
      return
    }

    const operationTimeout = operationTimeouts.get(operationId)
    if (operationTimeout) {
      clearTimeout(operationTimeout)
      operationTimeouts.delete(operationId)
    }

    if (!retryable) {
      logger.error(
        'Operation failed with non-retryable error - state out of sync, triggering offline mode',
        {
          operationId,
          operation: operation.operation.operation,
          target: operation.operation.target,
        }
      )

      get().triggerOfflineMode()
      return
    }

    const isSubblockOrVariable =
      (operation.operation.operation === 'subblock-update' &&
        operation.operation.target === 'subblock') ||
      (operation.operation.operation === 'variable-update' &&
        operation.operation.target === 'variable')

    const maxRetries = isSubblockOrVariable ? SUBBLOCK_VARIABLE_MAX_RETRIES : STRUCTURAL_MAX_RETRIES

    if (operation.retryCount < maxRetries) {
      const newRetryCount = operation.retryCount + 1
      // Faster retries for subblock/variable, exponential for structural
      const delay = isSubblockOrVariable
        ? Math.min(RETRY_DELAY_BASE_MS * newRetryCount, SUBBLOCK_VARIABLE_MAX_RETRY_DELAY_MS)
        : 2 ** newRetryCount * RETRY_DELAY_BASE_MS

      logger.warn(
        `Operation failed, retrying in ${delay}ms (attempt ${newRetryCount}/${maxRetries})`,
        {
          operationId,
          retryCount: newRetryCount,
          operation: operation.operation.operation,
        }
      )

      set((state) => ({
        operations: state.operations.map((op) =>
          op.id === operationId
            ? { ...op, retryCount: newRetryCount, status: 'pending' as const }
            : op
        ),
        isProcessing: false,
      }))

      const timeout = setTimeout(() => {
        retryTimeouts.delete(operationId)
        get().processNextOperation()
      }, delay)

      retryTimeouts.set(operationId, timeout)
    } else {
      logger.error('Operation failed after max retries, triggering offline mode', {
        operationId,
        operation: operation.operation.operation,
        retryCount: operation.retryCount,
      })
      get().triggerOfflineMode()
    }
  },

  handleOperationTimeout: (operationId: string) => {
    const state = get()
    const operation = state.operations.find((op) => op.id === operationId)
    if (!operation) {
      logger.debug('Ignoring timeout for operation not in queue', { operationId })
      return
    }

    logger.warn('Operation timeout detected - treating as failure to trigger retries', {
      operationId,
    })

    get().failOperation(operationId)
  },

  processNextOperation: () => {
    const state = get()

    if (state.isProcessing) {
      return
    }

    if (!currentRegisteredWorkflowId) {
      return
    }

    const nextOperation = state.operations.find(
      (op) => op.status === 'pending' && op.workflowId === currentRegisteredWorkflowId
    )
    if (!nextOperation) {
      return
    }

    set((state) => ({
      operations: state.operations.map((op) =>
        op.id === nextOperation.id ? { ...op, status: 'processing' as const } : op
      ),
      isProcessing: true,
    }))

    logger.debug('Processing operation sequentially', {
      operationId: nextOperation.id,
      operation: nextOperation.operation,
      retryCount: nextOperation.retryCount,
    })

    const { operation: op, target, payload } = nextOperation.operation
    if (op === 'subblock-update' && target === 'subblock') {
      if (emitSubblockUpdate) {
        emitSubblockUpdate(
          payload.blockId,
          payload.subblockId,
          payload.value,
          nextOperation.id,
          nextOperation.workflowId
        )
      }
    } else if (op === 'variable-update' && target === 'variable') {
      if (emitVariableUpdate) {
        emitVariableUpdate(
          payload.variableId,
          payload.field,
          payload.value,
          nextOperation.id,
          nextOperation.workflowId
        )
      }
    } else {
      if (emitWorkflowOperation) {
        emitWorkflowOperation(op, target, payload, nextOperation.id)
      }
    }

    const isSubblockOrVariable =
      (nextOperation.operation.operation === 'subblock-update' &&
        nextOperation.operation.target === 'subblock') ||
      (nextOperation.operation.operation === 'variable-update' &&
        nextOperation.operation.target === 'variable')
    const timeoutDuration = isSubblockOrVariable
      ? SUBBLOCK_VARIABLE_TIMEOUT_MS
      : STRUCTURAL_TIMEOUT_MS

    const timeoutId = setTimeout(() => {
      logger.warn(`Operation timeout - no server response after ${timeoutDuration}ms`, {
        operationId: nextOperation.id,
        operation: nextOperation.operation.operation,
      })
      operationTimeouts.delete(nextOperation.id)
      get().handleOperationTimeout(nextOperation.id)
    }, timeoutDuration)

    operationTimeouts.set(nextOperation.id, timeoutId)
  },

  cancelOperationsForBlock: (blockId: string) => {
    logger.debug('Canceling all operations for block', { blockId })

    const state = get()
    const operationsToCancel = state.operations.filter((op) => {
      const { target, payload, operation } = op.operation

      if (target === 'block' && payload?.id === blockId) return true

      if (target === 'subblock' && payload?.blockId === blockId) return true

      if (target === 'blocks') {
        if (operation === 'batch-add-blocks' && Array.isArray(payload?.blocks)) {
          return payload.blocks.some((b: { id: string }) => b.id === blockId)
        }
        if (operation === 'batch-remove-blocks' && Array.isArray(payload?.ids)) {
          return payload.ids.includes(blockId)
        }
        if (operation === 'batch-update-positions' && Array.isArray(payload?.updates)) {
          return payload.updates.some((u: { id: string }) => u.id === blockId)
        }
      }

      return false
    })

    operationsToCancel.forEach((op) => {
      const operationTimeout = operationTimeouts.get(op.id)
      if (operationTimeout) {
        clearTimeout(operationTimeout)
        operationTimeouts.delete(op.id)
      }

      const retryTimeout = retryTimeouts.get(op.id)
      if (retryTimeout) {
        clearTimeout(retryTimeout)
        retryTimeouts.delete(op.id)
      }
    })

    const newOperations = state.operations.filter((op) => {
      const { target, payload, operation } = op.operation

      if (target === 'block' && payload?.id === blockId) return false

      if (target === 'subblock' && payload?.blockId === blockId) return false

      if (target === 'blocks') {
        if (operation === 'batch-add-blocks' && Array.isArray(payload?.blocks)) {
          if (payload.blocks.some((b: { id: string }) => b.id === blockId)) return false
        }
        if (operation === 'batch-remove-blocks' && Array.isArray(payload?.ids)) {
          if (payload.ids.includes(blockId)) return false
        }
        if (operation === 'batch-update-positions' && Array.isArray(payload?.updates)) {
          if (payload.updates.some((u: { id: string }) => u.id === blockId)) return false
        }
      }

      return true
    })

    set({
      operations: newOperations,
      isProcessing: false,
    })

    logger.debug('Cancelled operations for block', {
      blockId,
      cancelledOperations: operationsToCancel.length,
    })

    get().processNextOperation()
  },

  cancelOperationsForVariable: (variableId: string) => {
    logger.debug('Canceling all operations for variable', { variableId })

    const state = get()
    const operationsToCancel = state.operations.filter(
      (op) =>
        (op.operation.target === 'variable' && op.operation.payload?.variableId === variableId) ||
        (op.operation.target === 'variable' &&
          op.operation.payload?.sourceVariableId === variableId)
    )

    operationsToCancel.forEach((op) => {
      const operationTimeout = operationTimeouts.get(op.id)
      if (operationTimeout) {
        clearTimeout(operationTimeout)
        operationTimeouts.delete(op.id)
      }

      const retryTimeout = retryTimeouts.get(op.id)
      if (retryTimeout) {
        clearTimeout(retryTimeout)
        retryTimeouts.delete(op.id)
      }
    })

    const newOperations = state.operations.filter(
      (op) =>
        !(
          (op.operation.target === 'variable' && op.operation.payload?.variableId === variableId) ||
          (op.operation.target === 'variable' &&
            op.operation.payload?.sourceVariableId === variableId)
        )
    )

    set({
      operations: newOperations,
      isProcessing: false,
    })

    logger.debug('Cancelled operations for variable', {
      variableId,
      cancelledOperations: operationsToCancel.length,
    })

    get().processNextOperation()
  },

  cancelOperationsForWorkflow: (workflowId: string) => {
    const state = get()
    retryTimeouts.forEach((timeout, opId) => {
      const op = state.operations.find((o) => o.id === opId)
      if (op && op.workflowId === workflowId) {
        clearTimeout(timeout)
        retryTimeouts.delete(opId)
      }
    })
    operationTimeouts.forEach((timeout, opId) => {
      const op = state.operations.find((o) => o.id === opId)
      if (op && op.workflowId === workflowId) {
        clearTimeout(timeout)
        operationTimeouts.delete(opId)
      }
    })
    set((s) => ({
      operations: s.operations.filter((op) => op.workflowId !== workflowId),
      isProcessing: false,
    }))
  },

  triggerOfflineMode: () => {
    logger.error('Operation failed after retries - triggering offline mode')

    retryTimeouts.forEach((timeout) => clearTimeout(timeout))
    retryTimeouts.clear()
    operationTimeouts.forEach((timeout) => clearTimeout(timeout))
    operationTimeouts.clear()

    set({
      operations: [],
      isProcessing: false,
      hasOperationError: true,
    })
  },

  clearError: () => {
    set({ hasOperationError: false })
  },
}))

/**
 * Hook to access operation queue state and actions.
 * Uses getState() for actions to avoid unnecessary re-renders.
 * Only subscribes to the specific state values needed.
 */
export function useOperationQueue() {
  const hasOperationError = useOperationQueueStore((state) => state.hasOperationError)

  const actions = useOperationQueueStore.getState()

  return {
    get queue() {
      return useOperationQueueStore.getState().operations
    },
    get isProcessing() {
      return useOperationQueueStore.getState().isProcessing
    },
    hasOperationError,
    addToQueue: actions.addToQueue,
    confirmOperation: actions.confirmOperation,
    failOperation: actions.failOperation,
    processNextOperation: actions.processNextOperation,
    cancelOperationsForBlock: actions.cancelOperationsForBlock,
    cancelOperationsForVariable: actions.cancelOperationsForVariable,
    triggerOfflineMode: actions.triggerOfflineMode,
    clearError: actions.clearError,
  }
}
