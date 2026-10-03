/** Safe provider-owned classification, independent of HTTP status or free-form messages. */
export type ConnectorSourceFailureCategory =
  | 'authorization'
  | 'source_unavailable'
  | 'request_rejected'
  | 'rate_limit'
  | 'provider_unavailable'

/** Whether provider reason codes were present and safe to retain. */
export const CONNECTOR_SOURCE_REASON_STATES = [
  'present',
  'absent',
  'filtered',
  'malformed',
  'unreadable',
] as const

export type ConnectorSourceReasonState = (typeof CONNECTOR_SOURCE_REASON_STATES)[number]

/** Providers classify their structured reasons here; shared diagnostics own user-facing text. */
export class ConnectorSourceError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly category?: ConnectorSourceFailureCategory,
    readonly diagnostic?: {
      operation: string
      reasons: readonly string[]
      reasonState?: ConnectorSourceReasonState
    }
  ) {
    super(message)
    this.name = 'ConnectorSourceError'
  }
}

/** Keeps directory failures distinct from document-content failures through cause wrapping. */
export class ConnectorDirectoryError extends Error {}

/** A provider-confirmed inaccessible external group, rather than a directory-wide failure. */
export class ConnectorDirectoryGroupAccessError extends ConnectorDirectoryError {}
