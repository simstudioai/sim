/** Safe provider-owned classification, independent of HTTP status or free-form messages. */
export type ConnectorSourceFailureCategory =
  | 'authorization'
  | 'source_unavailable'
  | 'request_rejected'
  | 'rate_limit'
  | 'provider_unavailable'

/** Providers classify their structured reasons here; shared diagnostics own user-facing text. */
export class ConnectorSourceError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly category?: ConnectorSourceFailureCategory
  ) {
    super(message)
    this.name = 'ConnectorSourceError'
  }
}
