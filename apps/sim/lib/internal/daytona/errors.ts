export class DaytonaOperationError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
    this.name = 'DaytonaOperationError'
  }
}
