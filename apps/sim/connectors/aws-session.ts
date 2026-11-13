/**
 * The AWS keys a saved AWS credential resolved to for one connector run.
 *
 * A saved AWS credential has no bearer token: the server resolves it to a key
 * pair (and, for a role, an STS session token) for the knowledge base's own
 * scope. The resolver seeds them into the run's `syncContext` under one slot,
 * the same way it seeds a credential's bound site, so a connector reads them
 * from one place and never from tool or user input. Server-only state: the
 * slot is never persisted or logged.
 */
export interface ConnectorAwsSession {
  accessKeyId: string
  secretAccessKey: string
  /** Present for STS sessions (assumed and keyless roles); absent for saved long-lived keys. */
  sessionToken?: string
}

const AWS_SESSION_CONTEXT_KEY = 'credentialAwsSession'

/** The `syncContext` entries that carry a resolved AWS session to a connector. */
export function awsSessionSyncContext(session: ConnectorAwsSession): Record<string, unknown> {
  return {
    [AWS_SESSION_CONTEXT_KEY]: {
      accessKeyId: session.accessKeyId,
      secretAccessKey: session.secretAccessKey,
      ...(session.sessionToken ? { sessionToken: session.sessionToken } : {}),
    },
  }
}

/** The AWS session seeded into this run, or undefined when the connector signs with inline keys. */
export function readAwsSession(
  syncContext: Record<string, unknown> | undefined
): ConnectorAwsSession | undefined {
  const value = syncContext?.[AWS_SESSION_CONTEXT_KEY]
  if (typeof value !== 'object' || value === null) return undefined
  const { accessKeyId, secretAccessKey, sessionToken } = value as Record<string, unknown>
  if (typeof accessKeyId !== 'string' || !accessKeyId) return undefined
  if (typeof secretAccessKey !== 'string' || !secretAccessKey) return undefined
  if (sessionToken !== undefined && (typeof sessionToken !== 'string' || !sessionToken)) {
    return undefined
  }
  return { accessKeyId, secretAccessKey, ...(sessionToken ? { sessionToken } : {}) }
}
