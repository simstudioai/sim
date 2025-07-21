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
  failOperation: (operationId: string, retryable?: boolean) => void
  handleOperationTimeout: (operationId: string) => void
  processNextOperation: () => void
  cancelOperationsForBlock: (blockId: string) => void

  triggerOfflineMode: () => void
  clearError: () => void
}

const retryTimeouts = new Map<string, NodeJS.Timeout>()
const operationTimeouts = new Map<string, NodeJS.Timeout>()
const subblockDebounceTimeouts = new Map<string, NodeJS.Timeout>()

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
    // Handle debouncing for subblock operations
    if (
      operation.operation.operation === 'subblock-update' &&
      operation.operation.target === 'subblock'
    ) {
      const { blockId, subblockId } = operation.operation.payload
      const debounceKey = `${blockId}-${subblockId}`

      const existingTimeout = subblockDebounceTimeouts.get(debounceKey)
      if (existingTimeout) {
        clearTimeout(existingTimeout)
      }

      set((state) => ({
        operations: state.operations.filter(
          (op) =>
            !(
              op.status === 'pending' &&
              op.operation.operation === 'subblock-update' &&
              op.operation.target === 'subblock' &&
              op.operation.payload?.blockId === blockId &&
              op.operation.payload?.subblockId === subblockId
            )
        ),
      }))

      const timeoutId = setTimeout(() => {
        subblockDebounceTimeouts.delete(debounceKey)

        const queuedOp: QueuedOperation = {
          ...operation,
          timestamp: Date.now(),
          retryCount: 0,
          status: 'pending',
        }

        set((state) => ({
          operations: [...state.operations, queuedOp],
        }))

        get().processNextOperation()
      }, 150) // 150ms debounce for subblock operations

      subblockDebounceTimeouts.set(debounceKey, timeoutId)
      return
    }

    // Handle non-subblock operations (existing logic)
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

    // Clean up any debounce timeouts for subblock operations
    if (
      operation?.operation.operation === 'subblock-update' &&
      operation.operation.target === 'subblock'
    ) {
      const { blockId, subblockId } = operation.operation.payload
      const debounceKey = `${blockId}-${subblockId}`
      const debounceTimeout = subblockDebounceTimeouts.get(debounceKey)
      if (debounceTimeout) {
        clearTimeout(debounceTimeout)
        subblockDebounceTimeouts.delete(debounceKey)
      }
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

    // Clean up any debounce timeouts for subblock operations
    if (
      operation.operation.operation === 'subblock-update' &&
      operation.operation.target === 'subblock'
    ) {
      const { blockId, subblockId } = operation.operation.payload
      const debounceKey = `${blockId}-${subblockId}`
      const debounceTimeout = subblockDebounceTimeouts.get(debounceKey)
      if (debounceTimeout) {
        clearTimeout(debounceTimeout)
        subblockDebounceTimeouts.delete(debounceKey)
      }
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

  cancelOperationsForBlock: (blockId: string) => {
    logger.debug('Canceling all operations for block', { blockId })

    // Cancel all debounce timeouts for this block's subblocks
    const keysToDelete: string[] = []
    for (const [key, timeout] of subblockDebounceTimeouts.entries()) {
      if (key.startsWith(`${blockId}-`)) {
        clearTimeout(timeout)
        keysToDelete.push(key)
      }
    }
    keysToDelete.forEach((key) => subblockDebounceTimeouts.delete(key))

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
      cancelledDebounceTimeouts: keysToDelete.length,
      cancelledOperations: operationsToCancel.length,
    })

    // Process next operation if there are any remaining
    get().processNextOperation()
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
    triggerOfflineMode: store.triggerOfflineMode,
    clearError: store.clearError,
  }
}
