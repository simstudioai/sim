/** Inputs that determine whether the collaborative editor can currently accept writes. */

export interface CollabReadinessInputs {
  /** The provider's current-session synchronization state. */
  synced: boolean
  /** Whether the shared doc carries the seed flag. */
  seeded: boolean
  /** A terminal rejection or access revocation prevents further synchronization and editing. */
  fatal: boolean
}

/** A document is writable only while this connection has synced the server-seeded Yjs document. */
export function isCollabReady(input: CollabReadinessInputs): boolean {
  return input.synced && input.seeded && !input.fatal
}
