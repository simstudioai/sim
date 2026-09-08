import type { ScimConnectionPrincipal } from '@sim/auth/principal'
import { db } from '@sim/db'
import { scimConnection, scimCredential } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { sha256Base64Url } from '@sim/security/hash'
import { generateShortId } from '@sim/utils/id'
import { eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { parseBearerToken } from '@/lib/auth/oauth-access-token'
import { isScimEntitledForOrganization } from '@/ee/scim/lib/entitlement'
import { ScimError } from '@/ee/scim/lib/protocol/errors'

const logger = createLogger('ScimAuthenticate')

export type ScimConnectionAuthenticator = (request: NextRequest) => Promise<ScimConnectionPrincipal>

/**
 * The prefix every issued credential carries.
 *
 * Makes a leaked token identifiable in a log or a secret scanner without
 * revealing which tenant it belongs to.
 */
const SCIM_TOKEN_PREFIX = 'sim_scim_'

/** Characters shown in the settings list so an administrator can tell two apart. */
const DISPLAY_PREFIX_LENGTH = SCIM_TOKEN_PREFIX.length + 6

/**
 * Mints a credential.
 *
 * 40 url-safe characters is about 238 bits, far beyond guessing, and the secret
 * is returned exactly once — only its digest is stored, so a database read
 * cannot recover a live token.
 */
export function generateScimToken(): { secret: string; hash: string; prefix: string } {
  const secret = `${SCIM_TOKEN_PREFIX}${generateShortId(40)}`
  return {
    secret,
    hash: sha256Base64Url(secret),
    prefix: secret.slice(0, DISPLAY_PREFIX_LENGTH),
  }
}

function unauthorized(detail = 'Invalid SCIM token'): ScimError {
  return new ScimError(401, undefined, detail, {
    'WWW-Authenticate': 'Bearer realm="SCIM"',
  })
}

/**
 * How long a credential's `last_used_at` may lag before it is rewritten.
 *
 * A provisioning cycle makes hundreds of calls a minute; writing the timestamp
 * on each one would turn a read path into a write path for a value nobody reads
 * more precisely than "today".
 */
const LAST_USED_WRITE_INTERVAL_MS = 5 * 60 * 1000

function touchCredentialLastUsed(credentialId: string, lastUsedAt: Date | null): void {
  if (lastUsedAt && Date.now() - lastUsedAt.getTime() < LAST_USED_WRITE_INTERVAL_MS) return
  void db
    .update(scimCredential)
    .set({ lastUsedAt: new Date() })
    .where(eq(scimCredential.id, credentialId))
    .catch((error) => logger.warn('Failed to record SCIM credential use', { error }))
}

function touchConnectionLastRequest(connectionId: string, lastRequestAt: Date | null): void {
  if (lastRequestAt && Date.now() - lastRequestAt.getTime() < LAST_USED_WRITE_INTERVAL_MS) return
  void db
    .update(scimConnection)
    .set({ lastRequestAt: new Date() })
    .where(eq(scimConnection.id, connectionId))
    .catch((error) => logger.warn('Failed to record SCIM connection activity', { error }))
}

/**
 * Resolves the bearer credential on a SCIM request into a principal.
 *
 * The lookup is by the token's digest, so the comparison the database performs
 * is between two fixed-length hashes and reveals nothing about the secret
 * through its timing. Every refusal renders the same message: a provider cannot
 * be helped by knowing whether a token was unknown, revoked, expired, or
 * belonged to a disabled connection, while an attacker probing tokens would
 * learn which of those it hit.
 */
export async function authenticateScimRequest(
  request: NextRequest
): Promise<ScimConnectionPrincipal> {
  const token = parseBearerToken(request.headers)
  if (!token) throw unauthorized('A bearer token is required')

  const [row] = await db
    .select({
      credentialId: scimCredential.id,
      scopes: scimCredential.scopes,
      expiresAt: scimCredential.expiresAt,
      revokedAt: scimCredential.revokedAt,
      lastUsedAt: scimCredential.lastUsedAt,
      connectionId: scimConnection.id,
      organizationId: scimConnection.organizationId,
      status: scimConnection.status,
      lastRequestAt: scimConnection.lastRequestAt,
    })
    .from(scimCredential)
    .innerJoin(scimConnection, eq(scimConnection.id, scimCredential.connectionId))
    .where(eq(scimCredential.tokenHash, sha256Base64Url(token)))
    .limit(1)

  if (!row) throw unauthorized()
  if (row.revokedAt) throw unauthorized()
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) throw unauthorized()
  if (row.status !== 'active') throw unauthorized()

  /**
   * The entitlement is checked on every request, not only when the connection is
   * created. An organization that lapses stops accepting directory writes rather
   * than continuing to provision members it is no longer paying for.
   */
  if (!(await isScimEntitledForOrganization(row.organizationId))) {
    throw unauthorized()
  }

  touchCredentialLastUsed(row.credentialId, row.lastUsedAt)
  touchConnectionLastRequest(row.connectionId, row.lastRequestAt)

  return {
    kind: 'scim_connection',
    organizationId: row.organizationId,
    connectionId: row.connectionId,
    credentialId: row.credentialId,
    scopes: row.scopes,
  }
}
