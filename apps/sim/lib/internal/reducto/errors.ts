export class ReductoOperationError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown
  ) {
    super('Reducto operation failed')
    this.name = 'ReductoOperationError'
  }
}
