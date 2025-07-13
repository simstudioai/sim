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
  status: 'pending' | 'processing' | 'confirmed' | 'failed'
  userId: string
}

interface OperationQueueState {
  operations: QueuedOperation[]
  isProcessing: boolean
  hasOperationError: boolean

  addToQueue: (operation: Omit<QueuedOperation, 'timestamp' | 'retryCount' | 'status'>) => void
  confirmOperation: (operationId: string) => void
  failOperation: (operationId: string) => void
  handleOperationTimeout: (operationId: string) => void
  processNextOperation: () => void

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
          // For subblock operations, check blockId and subblockId
          (operation.operation.target === 'subblock' &&
            op.operation.payload?.blockId === operation.operation.payload?.blockId &&
            op.operation.payload?.subblockId === operation.operation.payload?.subblockId) ||
          // For other operations, fall back to full payload comparison
          (operation.operation.target !== 'block' &&
            operation.operation.target !== 'subblock' &&
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

  failOperation: (operationId: string) => {
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

    get().failOperation(operationId)
  },

  processNextOperation: () => {
    const state = get()

    // Don't process if already processing
    if (state.isProcessing) {
      return
    }

    // Find the first pending operation (FIFO - first in, first out)
    const nextOperation = state.operations.find((op) => op.status === 'pending')
    if (!nextOperation) {
      return // No pending operations
    }

    // Check workflow context
    if (nextOperation.workflowId !== currentWorkflowId) {
      logger.warn('Cancelling operation - workflow changed', {
        operationId: nextOperation.id,
        operationWorkflow: nextOperation.workflowId,
        currentWorkflow: currentWorkflowId,
      })
      set((state) => ({
        operations: state.operations.filter((op) => op.id !== nextOperation.id),
      }))
      // Try next operation
      get().processNextOperation()
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
    } else {
      if (emitWorkflowOperation) {
        emitWorkflowOperation(op, target, payload, nextOperation.id)
      }
    }

    // Create operation timeout
    const timeoutId = setTimeout(() => {
      logger.warn('Operation timeout - no server response after 5 seconds', {
        operationId: nextOperation.id,
      })
      operationTimeouts.delete(nextOperation.id)
      get().handleOperationTimeout(nextOperation.id)
    }, 5000)

    operationTimeouts.set(nextOperation.id, timeoutId)
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
    triggerOfflineMode: store.triggerOfflineMode,
    clearError: store.clearError,
  }
}
