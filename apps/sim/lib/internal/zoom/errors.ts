export class ZoomOperationError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
    this.name = 'ZoomOperationError'
  }
}
