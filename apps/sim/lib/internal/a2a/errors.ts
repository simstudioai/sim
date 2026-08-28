export class A2AOperationError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
    this.name = 'A2AOperationError'
  }
}
