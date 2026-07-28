import type { TraceSpan } from '@/lib/logs/types'
import type { CustomBlockFailure } from '@/executor/errors/boundary'
import type { ExecutionResult } from '@/executor/types'

interface ChildWorkflowErrorOptions {
  message: string
  childWorkflowName: string
  childTraceSpans?: TraceSpan[]
  executionResult?: ExecutionResult
  childWorkflowSnapshotId?: string
  childWorkflowInstanceId?: string
  /** Child workflow names from this invocation down to the failing run, outermost first. */
  workflowChain?: string[]
  /** The deepest non-workflow failure, already block-name-prefixed (`"Function 1: boom"`). */
  rootErrorMessage?: string
  /** Consumer-safe failure descriptor. Set only at a custom-block invocation boundary. */
  consumerFacing?: CustomBlockFailure
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
  /**
   * The chain of child workflow names from this invocation down to the failing
   * run. Carried structurally so nesting never has to be recovered by parsing
   * the formatted message.
   */
  readonly workflowChain: string[]
  /** The deepest non-workflow failure, without any workflow-chain prefixes. */
  readonly rootErrorMessage: string
  readonly consumerFacing?: CustomBlockFailure

  constructor(options: ChildWorkflowErrorOptions) {
    super(options.message, { cause: options.cause })
    this.name = 'ChildWorkflowError'
    this.childWorkflowName = options.childWorkflowName
    this.childTraceSpans = options.childTraceSpans ?? []
    this.executionResult = options.executionResult
    this.childWorkflowSnapshotId = options.childWorkflowSnapshotId
    this.childWorkflowInstanceId = options.childWorkflowInstanceId
    this.workflowChain = options.workflowChain ?? [options.childWorkflowName]
    this.rootErrorMessage = options.rootErrorMessage ?? options.message
    this.consumerFacing = options.consumerFacing
  }

  static isChildWorkflowError(error: unknown): error is ChildWorkflowError {
    return error instanceof ChildWorkflowError
  }
}

/**
 * Renders a nested child-workflow failure for display. Kept byte-identical to
 * the format this error used to carry as a raw string, so persisted logs and
 * the UI are unaffected by the move to structured fields.
 */
export function formatWorkflowChainMessage(chain: string[], rootError: string): string {
  if (chain.length > 1) {
    return `Workflow chain: ${chain.join(' → ')} | ${rootError}`
  }
  return `"${chain[0]}" failed: ${rootError}`
}
