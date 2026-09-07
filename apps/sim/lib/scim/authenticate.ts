import { createHash, timingSafeEqual } from 'node:crypto'
import type { ScimConnectionPrincipal, ScimCredentialScope } from '@sim/auth/principal'
import { db } from '@sim/db'
import { scimConnection, scimCredential } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId, generateShortId } from '@sim/utils/id'
import { and, eq, isNull, lt, or, sql } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { isOrganizationFeatureEntitled } from '@/lib/billing/core/subscription'
import { isScimEnabled } from '@/lib/core/config/env-flags'
import { ScimError } from '@/lib/scim/protocol/errors'

const logger = createLogger('ScimAuthenticate')

export type ScimConnectionAuthenticator = (request: NextRequest) => Promise<ScimConnectionPrincipal>

/**
 * The prefix every issued credential carries.
 *
 * Makes a leaked token identifiable in a log or a secret scanner without
 * revealing which tenant it belongs to.
 */
export const SCIM_TOKEN_PREFIX = 'sim_scim_'

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
    hash: hashScimToken(secret),
    prefix: secret.slice(0, DISPLAY_PREFIX_LENGTH),
  }
}

export function hashScimToken(secret: string): string {
  return createHash('sha256').update(secret).digest('base64url')
}

/**
 * Compares digests without leaking their difference through timing.
 *
 * The lookup is by digest, so a mismatch normally means no row at all; this
 * guards the case where a row is found by an equal-prefix collision.
 */
function digestsMatch(left: string, right: string): boolean {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}

function unauthorized(detail = 'Invalid SCIM credential'): ScimError {
  return new ScimError(401, undefined, detail, {
    'WWW-Authenticate': 'Bearer realm="SCIM"',
  })
}

function readBearerToken(request: NextRequest): string | null {
  const header = request.headers.get('authorization')
  if (!header) return null
  const match = header.match(/^Bearer\s+(.+)$/i)
  return match ? match[1].trim() : null
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
 * Every refusal renders the same message. A provider cannot be helped by knowing
 * whether a token was unknown, revoked, expired, or belonged to a disabled
 * connection, while an attacker probing tokens learns which of those it hit.
 */
export async function authenticateScimRequest(
  request: NextRequest
): Promise<ScimConnectionPrincipal> {
  const token = readBearerToken(request)
  if (!token) throw unauthorized('A bearer credential is required')

  const [row] = await db
    .select({
      credentialId: scimCredential.id,
      tokenHash: scimCredential.tokenHash,
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
    .where(eq(scimCredential.tokenHash, hashScimToken(token)))
    .limit(1)

  if (!row || !digestsMatch(row.tokenHash, hashScimToken(token))) throw unauthorized()
  if (row.revokedAt) throw unauthorized()
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) throw unauthorized()
  if (row.status !== 'active') throw unauthorized()

  /**
   * The entitlement is checked on every request, not only when the connection is
   * created. An organization that lapses stops accepting directory writes rather
   * than continuing to provision members it is no longer paying for.
   */
  if (!(await isOrganizationFeatureEntitled(row.organizationId, isScimEnabled))) {
    throw unauthorized()
  }

  touchCredentialLastUsed(row.credentialId, row.lastUsedAt)
  touchConnectionLastRequest(row.connectionId, row.lastRequestAt)

  return {
    kind: 'scim_connection',
    organizationId: row.organizationId,
    connectionId: row.connectionId,
    credentialId: row.credentialId,
    scopes: row.scopes as ScimCredentialScope[],
  }
}

/** Active credentials for a connection, used to bound how many may exist at once. */
export function activeCredentialCondition(connectionId: string) {
  return and(
    eq(scimCredential.connectionId, connectionId),
    isNull(scimCredential.revokedAt),
    or(isNull(scimCredential.expiresAt), sql`${scimCredential.expiresAt} > now()`)
  )
}

/** Marks credentials whose expiry has passed, so the active count stays honest. */
export async function pruneExpiredCredentials(connectionId: string): Promise<void> {
  await db
    .update(scimCredential)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(scimCredential.connectionId, connectionId),
        isNull(scimCredential.revokedAt),
        lt(scimCredential.expiresAt, new Date())
      )
    )
}

/** Generates the ids the SCIM tables use, kept here so callers share one source. */
export function newScimId(): string {
  return generateId()
}
