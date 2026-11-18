import { OrchestrationError, type OrchestrationErrorCode } from '@/lib/core/orchestration/types'
import type { TableLockKind } from '@/lib/table'

export class TableOperationError extends OrchestrationError {
  constructor(
    code: OrchestrationErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
    readonly lock?: TableLockKind
  ) {
    super(code, message)
    this.name = 'TableOperationError'
  }
}

/** A reshape's rows changed since the caller read them at its `expectedRowsVersion`. */
export class TableRowsChangedError extends OrchestrationError {
  constructor(tableName: string) {
    super('conflict', `The rows of table "${tableName}" changed since they were read.`)
    this.name = 'TableRowsChangedError'
  }
}

export function throwTableOperationFailure(
  outcome: {
    success: boolean
    error?: string
    errorCode?: OrchestrationErrorCode
    lock?: TableLockKind
  },
  fallback: string,
  details?: Record<string, unknown>
): never {
  if (outcome.success) throw new Error('Cannot throw a successful table operation outcome')
  if (!outcome.errorCode || outcome.errorCode === 'internal') {
    throw new Error(fallback)
  }
  throw new TableOperationError(outcome.errorCode, outcome.error ?? fallback, details, outcome.lock)
}
