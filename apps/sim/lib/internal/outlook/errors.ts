export class OutlookOperationError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: { success: false; error: string } = { success: false, error: message }
  ) {
    super(message)
    this.name = 'OutlookOperationError'
  }
}
