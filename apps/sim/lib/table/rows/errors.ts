import { OrchestrationError } from '@/lib/core/orchestration/types'

/** Raised when a row disappears before an operation can mutate it. */
export class TableRowNotFoundError extends OrchestrationError {
  constructor() {
    super('not_found', 'Row not found')
    this.name = 'TableRowNotFoundError'
  }
}
