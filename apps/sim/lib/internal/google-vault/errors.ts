export class GoogleVaultOperationError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
    this.name = 'GoogleVaultOperationError'
  }
}
