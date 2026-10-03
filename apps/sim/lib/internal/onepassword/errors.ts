export class OnePasswordOperationError extends Error {
  constructor(
    readonly status: number,
    readonly body: Record<string, unknown>
  ) {
    super(typeof body.error === 'string' ? body.error : '1Password operation failed')
    this.name = 'OnePasswordOperationError'
  }
}
