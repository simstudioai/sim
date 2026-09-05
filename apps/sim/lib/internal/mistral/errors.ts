export class MistralOperationError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
    readonly retryAfterMs?: number
  ) {
    super('Mistral operation failed')
    this.name = 'MistralOperationError'
  }
}
