export class PulseOperationError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown
  ) {
    super('Pulse operation failed')
    this.name = 'PulseOperationError'
  }
}
