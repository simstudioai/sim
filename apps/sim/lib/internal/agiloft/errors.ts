export class AgiloftOperationError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown
  ) {
    super(
      body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
        ? body.error
        : 'Agiloft operation failed'
    )
    this.name = 'AgiloftOperationError'
  }
}
