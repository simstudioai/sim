import { create } from 'zustand'
import { createLogger } from '@/lib/logs/console-logger'

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
  status: 'pending' | 'confirmed' | 'failed'
  userId: string
}

interface OperationQueueState {
  operations: QueuedOperation[]
  isProcessing: boolean
  hasOperationError: boolean

  addToQueue: (operation: Omit<QueuedOperation, 'timestamp' | 'retryCount' | 'status'>) => void
  confirmOperation: (operationId: string) => void
  failOperation: (operationId: string, emitFunction: (operation: QueuedOperation) => void) => void
  handleOperationTimeout: (operationId: string) => void
  handleSocketReconnection: () => void
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

    const existingOp = state.operations.find((op) => op.id === operation.id)
    if (existingOp) {
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

    const timeoutId = setTimeout(() => {
      logger.warn('Operation timeout - no server response after 5 seconds', {
        operationId: queuedOp.id,
      })
      operationTimeouts.delete(queuedOp.id)

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

    set({ operations: newOperations })
  },

  failOperation: (operationId: string, emitFunction: (operation: QueuedOperation) => void) => {
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

    if (operation.retryCount < 3) {
      const newRetryCount = operation.retryCount + 1
      const delay = 2 ** newRetryCount * 1000 // 2s, 4s, 8s

      logger.warn(`Operation failed, retrying in ${delay}ms (attempt ${newRetryCount}/3)`, {
        operationId,
        retryCount: newRetryCount,
      })

      const timeout = setTimeout(() => {
        if (operation.workflowId !== currentWorkflowId) {
          logger.warn('Cancelling retry - workflow changed', {
            operationId,
            operationWorkflow: operation.workflowId,
            currentWorkflow: currentWorkflowId,
          })
          retryTimeouts.delete(operationId)
          set((state) => ({
            operations: state.operations.filter((op) => op.id !== operationId),
          }))
          return
        }

        emitFunction(operation)
        retryTimeouts.delete(operationId)

        // Create new operation timeout for this retry attempt
        const newTimeoutId = setTimeout(() => {
          logger.warn('Retry operation timeout - no server response after 5 seconds', {
            operationId,
          })
          operationTimeouts.delete(operationId)
          get().handleOperationTimeout(operationId)
        }, 5000)

        operationTimeouts.set(operationId, newTimeoutId)
      }, delay)

      retryTimeouts.set(operationId, timeout)

      set((state) => ({
        operations: state.operations.map((op) =>
          op.id === operationId ? { ...op, retryCount: newRetryCount } : op
        ),
      }))
    } else {
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

    const retryFunction = (operation: any) => {
      const { operation: op, target, payload } = operation.operation

      if (op === 'subblock-update' && target === 'subblock') {
        if (emitSubblockUpdate) {
          emitSubblockUpdate(payload.blockId, payload.subblockId, payload.value, operation.id)
        }
      } else {
        if (emitWorkflowOperation) {
          emitWorkflowOperation(op, target, payload, operation.id)
        }
      }
    }

    get().failOperation(operationId, retryFunction)
  },

  handleSocketReconnection: () => {
    // Clear all timeouts since they're for the old socket
    retryTimeouts.forEach((timeout) => clearTimeout(timeout))
    retryTimeouts.clear()
    operationTimeouts.forEach((timeout) => clearTimeout(timeout))
    operationTimeouts.clear()

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
    handleSocketReconnection: store.handleSocketReconnection,
    triggerOfflineMode: store.triggerOfflineMode,
    clearError: store.clearError,
  }
}
