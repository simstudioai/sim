/**
 * A run's workspace or workflow was hard-deleted while it was in flight, so the run has nowhere
 * left to record its log, cost, or counts. An expected outcome of the owner deleting it, not a
 * failure to retry or page on. Carries no `cause`: `classifyFailure` would rank the database error
 * that revealed the deletion as internal.
 */
export class ExecutionScopeDeletedError extends Error {
  readonly executionId: string
  readonly scope: 'workspace' | 'workflow'

  constructor(executionId: string, scope: 'workspace' | 'workflow') {
    super(`The ${scope} of execution ${executionId} was deleted`)
    this.name = 'ExecutionScopeDeletedError'
    this.executionId = executionId
    this.scope = scope
  }
}
