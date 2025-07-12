import { create } from 'zustand'
import { createLogger } from '@/lib/logs/console-logger'

const logger = createLogger('OperationQueue')

// Operation queue types
export interface QueuedOperation {
  id: string
  operation: {
    operation: string
    target: string
    payload: any
  }
  workflowId: string // Track which workflow this operation belongs to
  timestamp: number
  retryCount: number
  status: 'pending' | 'confirmed' | 'failed'
  userId: string
}

interface OperationQueueState {
  operations: QueuedOperation[]
  isProcessing: boolean
  hasOperationError: boolean

  // Actions
  addToQueue: (operation: Omit<QueuedOperation, 'timestamp' | 'retryCount' | 'status'>) => void
  confirmOperation: (operationId: string) => void
  failOperation: (operationId: string, emitFunction: (operation: QueuedOperation) => void) => void
  handleOperationTimeout: (operationId: string) => void
  handleSocketReconnection: () => void
  triggerOfflineMode: () => void
  clearError: () => void
}

// Global timeout maps (outside of Zustand store to avoid serialization issues)
const retryTimeouts = new Map<string, NodeJS.Timeout>()
const operationTimeouts = new Map<string, NodeJS.Timeout>()

// Global registry for emit functions and current workflow (set by collaborative workflow hook)
let emitWorkflowOperation:
  | ((operation: string, target: string, payload: any, operationId?: string) => void)
  | null = null
let emitSubblockUpdate:
  | ((blockId: string, subblockId: string, value: any, operationId?: string) => void)
  | null = null
let currentWorkflowId: string | null = null

export function registerEmitFunctions(
  workflowEmit: (operation: string, target: string, payload: any, operationId?: string) => void,
  subblockEmit: (blockId: string, subblockId: string, value: any, operationId?: string) => void,
  workflowId: string | null
) {
  emitWorkflowOperation = workflowEmit
  emitSubblockUpdate = subblockEmit
  currentWorkflowId = workflowId
}

export const useOperationQueueStore = create<OperationQueueState>((set, get) => ({
  operations: [],
  isProcessing: false,
  hasOperationError: false,

  addToQueue: (operation) => {
    const state = get()

    // Check if operation already exists in queue
    const existingOp = state.operations.find((op) => op.id === operation.id)
    if (existingOp) {
      console.log('⚠️ Operation already in queue, skipping duplicate', { operationId: operation.id })
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

    // Start 5-second timeout to detect unresponsive server
    // This will trigger retry mechanism if server doesn't respond at all
    const timeoutId = setTimeout(() => {
      logger.warn('Operation timeout - no server response after 5 seconds', {
        operationId: queuedOp.id,
      })
      operationTimeouts.delete(queuedOp.id)

      // Handle timeout directly in store instead of emitting events
      get().handleOperationTimeout(queuedOp.id)
    }, 5000)

    operationTimeouts.set(queuedOp.id, timeoutId)

    set((state) => ({
      operations: [...state.operations, queuedOp],
    }))
  },

  confirmOperation: (operationId) => {
    const state = get()
    const newOperations = state.operations.filter((op) => op.id !== operationId)

    // Clear any retry timeout for this operation
    const retryTimeout = retryTimeouts.get(operationId)
    if (retryTimeout) {
      clearTimeout(retryTimeout)
      retryTimeouts.delete(operationId)
    }

    // Clear any operation timeout for this operation
    const operationTimeout = operationTimeouts.get(operationId)
    if (operationTimeout) {
      clearTimeout(operationTimeout)
      operationTimeouts.delete(operationId)
    }

    logger.debug('Removing operation from queue', {
      operationId,
      remainingOps: newOperations.length,
    })

    set({ operations: newOperations })
  },

  failOperation: (operationId: string, emitFunction: (operation: QueuedOperation) => void) => {
    const state = get()
    const operation = state.operations.find((op) => op.id === operationId)
    if (!operation) {
      logger.warn('Attempted to fail operation that does not exist in queue', { operationId })
      return
    }

    // Clear any existing operation timeout since we're handling the failure
    const operationTimeout = operationTimeouts.get(operationId)
    if (operationTimeout) {
      clearTimeout(operationTimeout)
      operationTimeouts.delete(operationId)
    }

    if (operation.retryCount < 3) {
      // Retry the operation with exponential backoff
      const newRetryCount = operation.retryCount + 1
      const delay = 2 ** newRetryCount * 1000 // 2s, 4s, 8s

      logger.warn(`Operation failed, retrying in ${delay}ms (attempt ${newRetryCount}/3)`, {
        operationId,
        retryCount: newRetryCount,
      })

      const timeout = setTimeout(() => {
        // Check if we're still in the same workflow before retrying
        if (operation.workflowId !== currentWorkflowId) {
          logger.warn('Cancelling retry - workflow changed', {
            operationId,
            operationWorkflow: operation.workflowId,
            currentWorkflow: currentWorkflowId,
          })
          retryTimeouts.delete(operationId)
          // Remove operation from queue since it's no longer relevant
          set((state) => ({
            operations: state.operations.filter((op) => op.id !== operationId),
          }))
          return
        }

        // Re-emit the operation
        emitFunction(operation)
        retryTimeouts.delete(operationId)

        // Start a new operation timeout for the retry
        const newTimeoutId = setTimeout(() => {
          logger.warn('Retry operation timeout - no server response after 5 seconds', {
            operationId,
          })
          operationTimeouts.delete(operationId)

          // Trigger another retry attempt
          get().handleOperationTimeout(operationId)
        }, 5000)

        operationTimeouts.set(operationId, newTimeoutId)
      }, delay)

      retryTimeouts.set(operationId, timeout)

      // Update retry count
      set((state) => ({
        operations: state.operations.map((op) =>
          op.id === operationId ? { ...op, retryCount: newRetryCount } : op
        ),
      }))
    } else {
      // Max retries exceeded - trigger offline mode
      logger.error('Operation failed after max retries, triggering offline mode', { operationId })
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

    // Create a retry function that re-emits the operation using the correct channel
    const retryFunction = (operation: any) => {
      const { operation: op, target, payload } = operation.operation

      if (op === 'subblock-update' && target === 'subblock') {
        // Use subblock-update channel for subblock operations
        if (emitSubblockUpdate) {
          emitSubblockUpdate(payload.blockId, payload.subblockId, payload.value, operation.id)
        }
      } else {
        // Use workflow-operation channel for block/edge/subflow operations
        if (emitWorkflowOperation) {
          emitWorkflowOperation(op, target, payload, operation.id)
        }
      }
    }

    // Treat timeout as a failure to trigger retry mechanism
    get().failOperation(operationId, retryFunction)
  },

  handleSocketReconnection: () => {
    logger.info('Socket reconnected - clearing timeouts but keeping operations for retry')

    // Clear all timeouts since they're for the old socket
    retryTimeouts.forEach((timeout) => clearTimeout(timeout))
    retryTimeouts.clear()
    operationTimeouts.forEach((timeout) => clearTimeout(timeout))
    operationTimeouts.clear()

    // Keep operations in queue but reset their retry counts and start fresh timeouts
    const state = get()
    const resetOperations = state.operations.map((op) => ({
      ...op,
      retryCount: 0, // Reset retry count for fresh attempts
      status: 'pending' as const,
    }))

    set({
      operations: resetOperations,
      isProcessing: false,
      hasOperationError: false,
    })

    // Start new timeouts for all operations (they'll retry when socket is ready)
    resetOperations.forEach((operation) => {
      const timeoutId = setTimeout(() => {
        logger.warn('Operation timeout after reconnection - no server response after 5 seconds', {
          operationId: operation.id,
        })
        operationTimeouts.delete(operation.id)
        get().handleOperationTimeout(operation.id)
      }, 5000)

      operationTimeouts.set(operation.id, timeoutId)
    })
  },

  triggerOfflineMode: () => {
    logger.error('Operation failed after retries - triggering offline mode')

    // Clear all timeouts and queue
    retryTimeouts.forEach((timeout) => clearTimeout(timeout))
    retryTimeouts.clear()
    operationTimeouts.forEach((timeout) => clearTimeout(timeout))
    operationTimeouts.clear()

    // Clear queue and trigger error state
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

// Hook wrapper for easier usage
export function useOperationQueue() {
  const store = useOperationQueueStore()

  return {
    queue: store.operations,
    isProcessing: store.isProcessing,
    hasOperationError: store.hasOperationError,
    addToQueue: store.addToQueue,
    confirmOperation: store.confirmOperation,
    failOperation: store.failOperation,
    handleSocketReconnection: store.handleSocketReconnection,
    triggerOfflineMode: store.triggerOfflineMode,
    clearError: store.clearError,
  }
}
