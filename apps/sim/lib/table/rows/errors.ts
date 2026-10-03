import { OrchestrationError } from '@/lib/core/orchestration/types'

/**
 * Raised when a row an operation names is not in the table — either the target
 * row disappeared before the mutation, or the caller named an `afterRowId` /
 * `beforeRowId` anchor that does not exist. `rowId` is the caller's own input,
 * so echoing it is the difference between a fixable error and a guess.
 */
export class TableRowNotFoundError extends OrchestrationError {
  constructor(rowId?: string) {
    super('not_found', rowId ? `Row not found: ${rowId}` : 'Row not found')
    this.name = 'TableRowNotFoundError'
  }
}

/**
 * Refusal for a read whose opt-in run-state sidecar cannot be materialized
 * within `TABLE_LIMITS.MAX_ROW_RUN_STATE_BYTES`.
 *
 * `payload_too_large` rather than a truncated success: the question run state
 * answers is "which of my rows errored", and a silently short answer to that is
 * wrong rather than merely incomplete.
 *
 * Lives beside the row errors rather than in the application layer because the
 * budget is spent — and therefore blown — inside the sidecar drain itself, and
 * `lib/table/rows/**` cannot import the use cases that sit above it.
 */
export class TableRunStateCollectionLimitExceededError extends OrchestrationError {
  constructor(limitBytes: number) {
    super(
      'payload_too_large',
      `Run state for this page exceeds the ${limitBytes} byte limit; request a smaller limit or read the rows without includeRunState`
    )
    this.name = 'TableRunStateCollectionLimitExceededError'
  }
}
