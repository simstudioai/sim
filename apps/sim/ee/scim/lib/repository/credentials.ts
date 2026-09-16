import { scimCredential } from '@sim/db/schema'
import { and, eq, isNull, or, sql } from 'drizzle-orm'

/** Credentials that still authenticate: not revoked and not past their expiry. */
export function activeCredentialCondition(connectionId: string) {
  return and(
    eq(scimCredential.connectionId, connectionId),
    isNull(scimCredential.revokedAt),
    or(isNull(scimCredential.expiresAt), sql`${scimCredential.expiresAt} > now()`)
  )
}
