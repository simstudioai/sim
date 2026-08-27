export class MistralOperationError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown
  ) {
    super('Mistral operation failed')
    this.name = 'MistralOperationError'
  }
}
