import { OrchestrationError } from '@/lib/core/orchestration/types'

export type WorkflowRunAlreadyTerminalStatus = 'completed' | 'failed'

interface WorkflowRunAlreadyTerminalErrorOptions {
  executionId: string
  executionStatus: WorkflowRunAlreadyTerminalStatus
  redisAvailable: boolean
  locallyAborted: boolean
}

/** A standalone run reached a non-cancellable terminal state before cancellation won. */
export class WorkflowRunAlreadyTerminalError extends OrchestrationError {
  readonly executionId: string
  readonly executionStatus: WorkflowRunAlreadyTerminalStatus
  readonly redisAvailable: boolean
  readonly locallyAborted: boolean

  constructor(options: WorkflowRunAlreadyTerminalErrorOptions) {
    super('conflict', `Execution cannot be cancelled while ${options.executionStatus}`)
    this.name = 'WorkflowRunAlreadyTerminalError'
    this.executionId = options.executionId
    this.executionStatus = options.executionStatus
    this.redisAvailable = options.redisAvailable
    this.locallyAborted = options.locallyAborted
  }
}

export function isWorkflowRunAlreadyTerminalStatus(
  status: string
): status is WorkflowRunAlreadyTerminalStatus {
  return status === 'completed' || status === 'failed'
}
