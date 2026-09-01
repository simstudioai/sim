export class PersonaOperationError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
    this.name = 'PersonaOperationError'
  }
}
