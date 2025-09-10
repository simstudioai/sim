import { create } from 'zustand'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('OperationQueue')

export interface QueuedOperation {
  id: string
  operation: {
    operation: string
    target: string
    payload: any
  }
  workflowId: string
  timestamp: number
  retryCount: number
  status: 'pending' | 'processing' | 'confirmed' | 'failed'
  userId: string
  immediate?: boolean // Flag for immediate processing (skips debouncing)
}

interface OperationQueueState {
  operations: QueuedOperation[]
  isProcessing: boolean
  hasOperationError: boolean

  addToQueue: (operation: Omit<QueuedOperation, 'timestamp' | 'retryCount' | 'status'>) => void
  confirmOperation: (operationId: string) => void
  failOperation: (operationId: string, retryable?: boolean) => void
  handleOperationTimeout: (operationId: string) => void
  processNextOperation: () => void
  cancelOperationsForBlock: (blockId: string) => void
  cancelOperationsForVariable: (variableId: string) => void

  cancelOperationsForWorkflow: (workflowId: string) => void

  triggerOfflineMode: () => void
  clearError: () => void
}

const retryTimeouts = new Map<string, NodeJS.Timeout>()
const operationTimeouts = new Map<string, NodeJS.Timeout>()

let emitWorkflowOperation:
  | ((operation: string, target: string, payload: any, operationId?: string) => void)
  | null = null
let emitSubblockUpdate:
  | ((blockId: string, subblockId: string, value: any, operationId?: string) => void)
  | null = null
let emitVariableUpdate:
  | ((variableId: string, field: string, value: any, operationId?: string) => void)
  | null = null

export function registerEmitFunctions(
  workflowEmit: (operation: string, target: string, payload: any, operationId?: string) => void,
  subblockEmit: (blockId: string, subblockId: string, value: any, operationId?: string) => void,
  variableEmit: (variableId: string, field: string, value: any, operationId?: string) => void,
  workflowId: string | null
) {
  emitWorkflowOperation = workflowEmit
  emitSubblockUpdate = subblockEmit
  emitVariableUpdate = variableEmit
  currentRegisteredWorkflowId = workflowId
}

let currentRegisteredWorkflowId: string | null = null

export const useOperationQueueStore = create<OperationQueueState>((set, get) => ({
  operations: [],
  isProcessing: false,
  hasOperationError: false,

  addToQueue: (operation) => {
    // Immediate coalescing without client-side debouncing:
    // For subblock updates, keep only latest pending op for the same blockId+subblockId
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

    // For variable updates, keep only latest pending op for same variableId+field
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

    // Handle remaining logic
    const state = get()

    // Check for duplicate operation ID
    const existingOp = state.operations.find((op) => op.id === operation.id)
    if (existingOp) {
      logger.debug('Skipping duplicate operation ID', {
        operationId: operation.id,
        existingStatus: existingOp.status,
      })
      return
    }

    // Enhanced duplicate content check - especially important for block operations
    const duplicateContent = state.operations.find(
      (op) =>
        op.operation.operation === operation.operation.operation &&
        op.operation.target === operation.operation.target &&
        op.workflowId === operation.workflowId &&
        // For block operations, check the block ID specifically
        ((operation.operation.target === 'block' &&
          op.operation.payload?.id === operation.operation.payload?.id) ||
          // For other operations, fall back to full payload comparison
          (operation.operation.target !== 'block' &&
            JSON.stringify(op.operation.payload) === JSON.stringify(operation.operation.payload)))
    )

    if (duplicateContent) {
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

    // Start processing if not already processing
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

    // Process next operation in queue
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
      logger.debug('Operation marked as non-retryable, removing from queue', { operationId })

      set((state) => ({
        operations: state.operations.filter((op) => op.id !== operationId),
        isProcessing: false,
      }))

      get().processNextOperation()
      return
    }

    // More aggressive retry for subblock/variable updates, less aggressive for structural ops
    const isSubblockOrVariable =
      (operation.operation.operation === 'subblock-update' &&
        operation.operation.target === 'subblock') ||
      (operation.operation.operation === 'variable-update' &&
        operation.operation.target === 'variable')

    const maxRetries = isSubblockOrVariable ? 5 : 3 // 5 retries for text, 3 for structural

    if (operation.retryCount < maxRetries) {
      const newRetryCount = operation.retryCount + 1
      // Faster retries for subblock/variable, exponential for structural
      const delay = isSubblockOrVariable
        ? Math.min(1000 * newRetryCount, 3000) // 1s, 2s, 3s, 3s, 3s (cap at 3s)
        : 2 ** newRetryCount * 1000 // 2s, 4s, 8s (exponential for structural)

      logger.warn(
        `Operation failed, retrying in ${delay}ms (attempt ${newRetryCount}/${maxRetries})`,
        {
          operationId,
          retryCount: newRetryCount,
          operation: operation.operation.operation,
        }
      )

      // Update retry count and mark as pending for retry
      set((state) => ({
        operations: state.operations.map((op) =>
          op.id === operationId
            ? { ...op, retryCount: newRetryCount, status: 'pending' as const }
            : op
        ),
        isProcessing: false, // Allow processing to continue
      }))

      // Schedule retry
      const timeout = setTimeout(() => {
        retryTimeouts.delete(operationId)
        get().processNextOperation()
      }, delay)

      retryTimeouts.set(operationId, timeout)
    } else {
      // Always trigger offline mode when we can't persist - never silently drop data
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

    // Don't process if already processing
    if (state.isProcessing) {
      return
    }

    const nextOperation = currentRegisteredWorkflowId
      ? state.operations.find(
          (op) => op.status === 'pending' && op.workflowId === currentRegisteredWorkflowId
        )
      : state.operations.find((op) => op.status === 'pending')
    if (!nextOperation) {
      return
    }

    if (currentRegisteredWorkflowId && nextOperation.workflowId !== currentRegisteredWorkflowId) {
      return
    }

    // Mark as processing
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

    // Emit the operation
    const { operation: op, target, payload } = nextOperation.operation
    if (op === 'subblock-update' && target === 'subblock') {
      if (emitSubblockUpdate) {
        emitSubblockUpdate(payload.blockId, payload.subblockId, payload.value, nextOperation.id)
      }
    } else if (op === 'variable-update' && target === 'variable') {
      if (emitVariableUpdate) {
        emitVariableUpdate(payload.variableId, payload.field, payload.value, nextOperation.id)
      }
    } else {
      if (emitWorkflowOperation) {
        emitWorkflowOperation(op, target, payload, nextOperation.id)
      }
    }

    // Create operation timeout - longer for subblock/variable updates to handle reconnects
    const isSubblockOrVariable =
      (nextOperation.operation.operation === 'subblock-update' &&
        nextOperation.operation.target === 'subblock') ||
      (nextOperation.operation.operation === 'variable-update' &&
        nextOperation.operation.target === 'variable')
    const timeoutDuration = isSubblockOrVariable ? 15000 : 5000 // 15s for text edits, 5s for structural ops

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

    // No debounced timeouts to cancel (moved to server-side)

    // Find and cancel operation timeouts for operations related to this block
    const state = get()
    const operationsToCancel = state.operations.filter(
      (op) =>
        (op.operation.target === 'block' && op.operation.payload?.id === blockId) ||
        (op.operation.target === 'subblock' && op.operation.payload?.blockId === blockId)
    )

    // Cancel timeouts for these operations
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

    // Remove all operations for this block (both pending and processing)
    const newOperations = state.operations.filter(
      (op) =>
        !(
          (op.operation.target === 'block' && op.operation.payload?.id === blockId) ||
          (op.operation.target === 'subblock' && op.operation.payload?.blockId === blockId)
        )
    )

    set({
      operations: newOperations,
      isProcessing: false, // Reset processing state in case we removed the current operation
    })

    logger.debug('Cancelled operations for block', {
      blockId,
      cancelledOperations: operationsToCancel.length,
    })

    // Process next operation if there are any remaining
    get().processNextOperation()
  },

  cancelOperationsForVariable: (variableId: string) => {
    logger.debug('Canceling all operations for variable', { variableId })

    // No debounced timeouts to cancel (moved to server-side)

    // Find and cancel operation timeouts for operations related to this variable
    const state = get()
    const operationsToCancel = state.operations.filter(
      (op) =>
        (op.operation.target === 'variable' && op.operation.payload?.variableId === variableId) ||
        (op.operation.target === 'variable' &&
          op.operation.payload?.sourceVariableId === variableId)
    )

    // Cancel timeouts for these operations
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

    // Remove all operations for this variable (both pending and processing)
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
      isProcessing: false, // Reset processing state in case we removed the current operation
    })

    logger.debug('Cancelled operations for variable', {
      variableId,
      cancelledOperations: operationsToCancel.length,
    })

    // Process next operation if there are any remaining
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

export function useOperationQueue() {
  const store = useOperationQueueStore()

  return {
    queue: store.operations,
    isProcessing: store.isProcessing,
    hasOperationError: store.hasOperationError,
    addToQueue: store.addToQueue,
    confirmOperation: store.confirmOperation,
    failOperation: store.failOperation,
    processNextOperation: store.processNextOperation,
    cancelOperationsForBlock: store.cancelOperationsForBlock,
    cancelOperationsForVariable: store.cancelOperationsForVariable,
    triggerOfflineMode: store.triggerOfflineMode,
    clearError: store.clearError,
  }
}
