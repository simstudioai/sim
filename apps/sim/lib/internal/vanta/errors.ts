export class VantaOperationError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown
  ) {
    super('Vanta operation failed')
    this.name = 'VantaOperationError'
  }
}
