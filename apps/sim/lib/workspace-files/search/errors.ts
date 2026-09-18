/** A retryable search failure caused by contention or index maintenance. */
export class WorkspaceFileSearchUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WorkspaceFileSearchUnavailableError'
  }
}
