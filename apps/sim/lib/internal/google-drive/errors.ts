export class GoogleDriveOperationError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown
  ) {
    super(
      typeof body === 'object' && body !== null && 'error' in body
        ? String(body.error)
        : 'Google Drive operation failed'
    )
    this.name = 'GoogleDriveOperationError'
  }
}
