export class ZohoDeskOperationError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
    this.name = 'ZohoDeskOperationError'
  }
}
