export class DocuSignOperationError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: Record<string, unknown> = { success: false, error: message }
  ) {
    super(message)
    this.name = 'DocuSignOperationError'
  }
}
