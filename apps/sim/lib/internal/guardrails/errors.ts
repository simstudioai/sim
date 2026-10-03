export class GuardrailsOperationError extends Error {
  constructor(
    readonly status: number,
    readonly body: { error: string }
  ) {
    super(body.error)
    this.name = 'GuardrailsOperationError'
  }
}
