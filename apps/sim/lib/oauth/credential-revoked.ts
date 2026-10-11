/**
 * Stable code for an OAuth credential whose provider revoked its grant. Only the credential's
 * owner reconnecting restores it, so surfaces present it as "reconnect" rather than a failure.
 */
export const OAUTH_CREDENTIAL_REVOKED = 'OAUTH_CREDENTIAL_REVOKED'

/**
 * An OAuth credential the provider has revoked (`invalid_grant` and kin). User-actionable, not a
 * fault of ours: catchers log it at WARN and tell the user to reconnect. Dependency-free so the
 * tool executor can recognize it without importing the credential service.
 */
export class CredentialRevokedError extends Error {
  constructor(
    message: string,
    readonly provider?: { providerId: string; errorCode: string }
  ) {
    super(message)
    this.name = 'CredentialRevokedError'
  }
}

/** The `account` revocation columns of a chain known to be live. */
export const CLEARED_REFRESH_REVOCATION = {
  refreshRevokedAt: null,
  refreshRevokedCode: null,
  refreshRevokedTokenHash: null,
} as const
