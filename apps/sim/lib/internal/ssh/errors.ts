export class SshOperationError extends Error {
  constructor(
    readonly status: number,
    readonly body: { error: string }
  ) {
    super(body.error)
    this.name = 'SshOperationError'
  }
}
