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
