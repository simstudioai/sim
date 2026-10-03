export class TypeformOperationError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
    this.name = 'TypeformOperationError'
  }
}
