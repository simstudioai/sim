export class ExtendOperationError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown
  ) {
    super('Extend operation failed')
    this.name = 'ExtendOperationError'
  }
}
