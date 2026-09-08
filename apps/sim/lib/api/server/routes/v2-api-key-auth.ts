import type {
  OAuthAccessTokenPrincipal,
  PersonalApiKeyPrincipal,
  WorkspaceApiKeyPrincipal,
} from '@sim/auth/principal'
import { db } from '@sim/db'
import { apiKey, user } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import type { V2CredentialHeaders } from '@/lib/api/server/routes/v2-credential-headers'
import { hashApiKey } from '@/lib/api-key/crypto'
import { updateApiKeyLastUsed } from '@/lib/api-key/service'
import { ANONYMOUS_USER_ID } from '@/lib/auth/constants'
import { InvalidOAuthAccessTokenError, verifyOAuthAccessToken } from '@/lib/auth/oauth-access-token'
import { resolveWorkspaceBillingPayer } from '@/lib/billing/core/billing-attribution'
import { getHighestPrioritySubscription } from '@/lib/billing/core/subscription'
import { isAuthDisabled } from '@/lib/core/config/env-flags'

const logger = createLogger('V2ApiKeyAuth')

/**
 * The credentials v2 authenticates: an API key in `x-api-key`, or one of Sim's
 * own OAuth access tokens as `Authorization: Bearer`. The module keeps its
 * API-key name because the key path is unchanged and every route names its
 * policy object; the bearer path is the addition.
 */
export type V2ApiKeyPrincipal =
  | PersonalApiKeyPrincipal
  | WorkspaceApiKeyPrincipal
  | OAuthAccessTokenPrincipal

/** Which credential the caller presented, as `/api/v2/meta` reports it. */
export type V2CredentialType = 'personal' | 'workspace' | 'oauth_access_token'

/** Which challenge a 401 should lead with: the scheme the caller tried, or the key when it tried nothing. */
export type V2AuthChallenge = 'api_key' | 'bearer'

interface RateLimitSubscription {
  plan: string
  referenceId: string
}

export interface V2ApiKeyAuthContext {
  principal: V2ApiKeyPrincipal
  rateLimitSubjectIds: readonly [string, ...string[]]
  rateLimitSubscription: RateLimitSubscription | null
  keyType: V2CredentialType
  /**
   * When the authenticated credential expires, or `null` when it never does —
   * read from the same row the authenticator has just checked, so no surface
   * has to go back to the credential table for it. `/api/v2/meta` reports it,
   * and the application layer must never query `api_key` itself to find it out.
   */
  keyExpiresAt: Date | null
}

export class V2ApiKeyUnauthenticatedError extends Error {
  constructor(
    message = 'Invalid API key',
    readonly challenge: V2AuthChallenge = 'api_key'
  ) {
    super(message)
    this.name = 'V2ApiKeyUnauthenticatedError'
  }
}

interface ApiKeyRow {
  id: string
  userId: string
  workspaceId: string | null
  type: string
  expiresAt: Date | null
  userBanned: boolean | null
  userSuspendedAt: Date | null
}

function requireValidRow(row: ApiKeyRow | undefined): ApiKeyRow {
  if (!row || (row.expiresAt && row.expiresAt < new Date())) {
    throw new V2ApiKeyUnauthenticatedError()
  }
  if (row.type === 'personal' && row.workspaceId === null) {
    if (row.userBanned === null) {
      throw new Error(`Personal API key ${row.id} is missing its credential owner`)
    }
    if (row.userBanned) throw new V2ApiKeyUnauthenticatedError()
    /**
     * A suspension keeps the account's resources — and therefore its keys —
     * intact, so refusing the key here is what ends its machine access.
     */
    if (row.userSuspendedAt) throw new V2ApiKeyUnauthenticatedError()
    return row
  }
  if (row.type === 'workspace' && row.workspaceId) return row
  throw new Error(`API key ${row.id} has an invalid persisted type/workspace combination`)
}

async function personalSubscription(userId: string): Promise<RateLimitSubscription | null> {
  const subscription = await getHighestPrioritySubscription(userId, { onError: 'throw' })
  return subscription ? { plan: subscription.plan, referenceId: subscription.referenceId } : null
}

async function authenticateApiKey(apiKeyHeader: string): Promise<V2ApiKeyAuthContext> {
  const [candidate] = await db
    .select({
      id: apiKey.id,
      userId: apiKey.userId,
      workspaceId: apiKey.workspaceId,
      type: apiKey.type,
      expiresAt: apiKey.expiresAt,
      userBanned: user.banned,
      userSuspendedAt: user.suspendedAt,
    })
    .from(apiKey)
    .leftJoin(user, eq(apiKey.userId, user.id))
    .where(eq(apiKey.keyHash, hashApiKey(apiKeyHeader)))
    .limit(1)
  const row = requireValidRow(candidate)

  await updateApiKeyLastUsed(row.id)
  logger.debug('Authenticated v2 API key', { keyId: row.id, keyType: row.type })

  if (row.type === 'personal') {
    return {
      principal: { kind: 'personal_api_key', userId: row.userId, keyId: row.id },
      rateLimitSubjectIds: [`api-key:${row.id}`, `user:${row.userId}`],
      rateLimitSubscription: await personalSubscription(row.userId),
      keyType: 'personal',
      keyExpiresAt: row.expiresAt,
    }
  }

  const workspaceId = row.workspaceId
  if (!workspaceId) {
    throw new Error(`Workspace API key ${row.id} is missing its workspace scope`)
  }
  const payer = await resolveWorkspaceBillingPayer(workspaceId)
  if (!payer) {
    throw new Error(`Workspace ${workspaceId} is missing its billing owner`)
  }
  return {
    principal: { kind: 'workspace_api_key', workspaceId, keyId: row.id },
    rateLimitSubjectIds: [`api-key:${row.id}`, `workspace:${workspaceId}`],
    rateLimitSubscription: payer.payerSubscription
      ? {
          plan: payer.payerSubscription.plan,
          referenceId: payer.payerSubscription.referenceId,
        }
      : null,
    keyType: 'workspace',
    keyExpiresAt: row.expiresAt,
  }
}

/**
 * An OAuth token is rate-limited like the personal key it stands in for: per
 * token and per user, on the user's own plan. A client that holds many tokens
 * for one user still shares that user's bucket.
 */
async function authenticateBearer(token: string): Promise<V2ApiKeyAuthContext> {
  let principal: OAuthAccessTokenPrincipal
  try {
    principal = await verifyOAuthAccessToken(token)
  } catch (error) {
    if (error instanceof InvalidOAuthAccessTokenError) {
      logger.warn('Invalid OAuth access token attempted', { reason: error.reason })
      throw new V2ApiKeyUnauthenticatedError('Invalid access token', 'bearer')
    }
    throw error
  }
  return {
    principal,
    rateLimitSubjectIds: [`oauth-token:${principal.tokenId}`, `user:${principal.userId}`],
    rateLimitSubscription: await personalSubscription(principal.userId),
    keyType: 'oauth_access_token',
    keyExpiresAt: principal.expiresAt,
  }
}

/**
 * Authenticates a v2 request from its credential headers.
 *
 * `x-api-key` wins when both are present, so a client that always sends a key
 * and happens to also carry an `Authorization` header keeps the behavior it
 * had before bearer tokens existed. A bearer token is only consulted when no
 * key is offered.
 */
export async function authenticateV2ApiKey(
  credential: V2CredentialHeaders
): Promise<V2ApiKeyAuthContext> {
  if (isAuthDisabled) {
    return {
      principal: {
        kind: 'personal_api_key',
        userId: ANONYMOUS_USER_ID,
        keyId: 'auth-disabled',
      },
      rateLimitSubjectIds: [`user:${ANONYMOUS_USER_ID}`],
      rateLimitSubscription: null,
      keyType: 'personal',
      keyExpiresAt: null,
    }
  }
  if (credential.apiKey) return authenticateApiKey(credential.apiKey)
  if (credential.bearer) return authenticateBearer(credential.bearer)
  if (credential.malformedOAuthBearer) {
    throw new V2ApiKeyUnauthenticatedError('Invalid access token', 'bearer')
  }
  throw new V2ApiKeyUnauthenticatedError('API key or OAuth access token required')
}
