export class TtsOperationError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: Record<string, unknown> = { error: message }
  ) {
    super(message)
    this.name = 'TtsOperationError'
  }
}
