/** Safe caller-facing failure from an Oracle Fusion product request. */
export class OracleFusionProviderError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
    this.name = 'OracleFusionProviderError'
  }
}
