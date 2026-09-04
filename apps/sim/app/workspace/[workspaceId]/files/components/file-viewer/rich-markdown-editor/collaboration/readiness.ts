/** Inputs that determine whether the collaborative editor can currently accept writes. */

export interface CollabReadinessInputs {
  /** The provider's current-session synchronization state. */
  synced: boolean
  /** Whether the shared doc carries the seed flag. */
  seeded: boolean
  /** Whether the seed flag was set by the offline fallback (no server sync) rather than the server. */
  offlineSeed: boolean
  /**
   * Whether the provider has GIVEN UP on this document — a non-retryable rejection, an access
   * revocation, or the readiness deadline lapsing. A fatal provider ignores every inbound frame and
   * never rejoins, so nothing typed after this point reaches the server.
   */
  fatal: boolean
}

/** A document is writable only while this connection has synced the server-seeded Yjs document. */
export function isCollabReady(input: CollabReadinessInputs): boolean {
  return input.synced && input.seeded && !input.offlineSeed && !input.fatal
}
