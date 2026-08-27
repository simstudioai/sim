export class GmailOperationError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'GmailOperationError'
  }
}
