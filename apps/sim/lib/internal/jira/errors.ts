export class JiraOperationError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown
  ) {
    super(
      typeof body === 'object' && body !== null && 'error' in body
        ? String(body.error)
        : 'Jira operation failed'
    )
    this.name = 'JiraOperationError'
  }
}
