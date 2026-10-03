export class S3OperationError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
    this.name = 'S3OperationError'
  }
}
