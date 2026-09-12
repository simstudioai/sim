export type OutboundRoutingErrorCode =
  | 'CONFIGURATION_UNAVAILABLE'
  | 'INVALID_CONFIGURATION'
  | 'MISSING_SCOPE'
  | 'ROUTE_BLOCKED'
  | 'UNSUPPORTED_TRANSPORT'
  | 'GATEWAY_UNAVAILABLE'

/** Public error text never includes routing configuration, credentials or destination details. */
export class OutboundRoutingError extends Error {
  constructor(readonly code: OutboundRoutingErrorCode) {
    super(`Outbound routing failed: ${code}`)
    this.name = 'OutboundRoutingError'
  }
}
