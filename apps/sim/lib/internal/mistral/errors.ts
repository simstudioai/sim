export class MistralOperationError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
    readonly retryAfterMs?: number,
    readonly source: 'operation' | 'provider' = 'operation'
  ) {
    super('Mistral operation failed')
    this.name = 'MistralOperationError'
  }
}
