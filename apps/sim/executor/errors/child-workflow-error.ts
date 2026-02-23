import type { TraceSpan } from '@/lib/logs/types'
import type { ExecutionResult } from '@/executor/types'

interface ChildWorkflowErrorOptions {
  message: string
  childWorkflowName: string
  childTraceSpans?: TraceSpan[]
  executionResult?: ExecutionResult
  childWorkflowSnapshotId?: string
  childWorkflowInstanceId?: string
  cause?: Error
}

/**
 * Error raised when a child workflow execution fails.
 */
export class ChildWorkflowError extends Error {
  readonly childTraceSpans: TraceSpan[]
  readonly childWorkflowName: string
  readonly executionResult?: ExecutionResult
  readonly childWorkflowSnapshotId?: string
  /** Per-invocation unique ID used to correlate child block events with this workflow block. */
  readonly childWorkflowInstanceId?: string

  constructor(options: ChildWorkflowErrorOptions) {
    super(options.message, { cause: options.cause })
    this.name = 'ChildWorkflowError'
    this.childWorkflowName = options.childWorkflowName
    this.childTraceSpans = options.childTraceSpans ?? []
    this.executionResult = options.executionResult
    this.childWorkflowSnapshotId = options.childWorkflowSnapshotId
    this.childWorkflowInstanceId = options.childWorkflowInstanceId
  }

  static isChildWorkflowError(error: unknown): error is ChildWorkflowError {
    return error instanceof ChildWorkflowError
  }
}
