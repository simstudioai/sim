export class GoogleSlidesOperationError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
    this.name = 'GoogleSlidesOperationError'
  }
}
