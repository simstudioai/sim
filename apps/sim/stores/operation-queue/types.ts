/**
 * Emit functions return whether the payload was actually sent over the socket.
 * A `false` return means the emit was skipped (room not joined/visible) and the
 * operation should stay pending instead of waiting on a confirmation timeout.
 */
export type WorkflowOperationEmit = (
  workflowId: string,
  operation: string,
  target: string,
  payload: any,
  operationId?: string
) => boolean

export type SubblockUpdateEmit = (
  blockId: string,
  subblockId: string,
  value: any,
  operationId: string | undefined,
  workflowId: string
) => boolean

export type VariableUpdateEmit = (
  variableId: string,
  field: string,
  value: any,
  operationId: string | undefined,
  workflowId: string
) => boolean

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

export interface OperationQueueState {
  operations: QueuedOperation[]
  workflowOperationVersions: Record<string, number>
  processingOperationId: string | null
  hasOperationError: boolean

  addToQueue: (operation: Omit<QueuedOperation, 'timestamp' | 'retryCount' | 'status'>) => void
  confirmOperation: (operationId: string) => void
  failOperation: (operationId: string, retryable?: boolean) => void
  handleOperationTimeout: (operationId: string) => void
  processNextOperation: () => void
  hasPendingOperations: (workflowId: string) => boolean
  waitForWorkflowOperations: (workflowId: string, timeoutMs?: number) => Promise<boolean>
  cancelOperationsForBlock: (blockId: string) => void
  cancelOperationsForVariable: (variableId: string) => void

  cancelOperationsForWorkflow: (workflowId: string) => void

  triggerOfflineMode: () => void
  clearError: () => void
}
