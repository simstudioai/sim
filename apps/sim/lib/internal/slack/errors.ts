export class SlackOperationError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown
  ) {
    super(
      typeof body === 'object' && body !== null && 'error' in body
        ? String(body.error)
        : 'Slack operation failed'
    )
    this.name = 'SlackOperationError'
  }
}
