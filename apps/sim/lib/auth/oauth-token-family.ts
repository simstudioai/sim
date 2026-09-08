import { db } from '@sim/db'
import {
  oauthAccessToken,
  oauthClient,
  oauthConsent,
  oauthRefreshToken,
  oauthTokenFamily,
  session,
  user,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { safeCompare } from '@sim/security/compare'
import { generateSecureToken } from '@sim/security/tokens'
import { generateId } from '@sim/utils/id'
import { symmetricDecrypt } from 'better-auth/crypto'
import { and, eq, isNull } from 'drizzle-orm'
import { isAccountBlocked } from '@/lib/auth/ban'
import { hashOAuthToken } from '@/lib/auth/oauth-access-token'
import {
  OAUTH_ACCESS_TOKEN_PREFIX,
  OAUTH_ACCESS_TOKEN_TTL_SECONDS,
  OAUTH_REFRESH_TOKEN_PREFIX,
  OAUTH_TOKEN_FAMILY_MAX_GENERATION,
} from '@/lib/auth/oauth-provider'
import { env } from '@/lib/core/config/env'

const logger = createLogger('OAuthTokenFamily')

type OAuthDatabase = typeof db
type OAuthReadDatabase = OAuthDatabase | Parameters<Parameters<OAuthDatabase['transaction']>[0]>[0]
type OAuthClientAuthenticationMethod = 'none' | 'client_secret_basic' | 'client_secret_post'

export interface OAuthClientCredentials {
  clientId: string
  clientSecret?: string
  method: OAuthClientAuthenticationMethod
}

export interface RotateOAuthRefreshTokenInput {
  credentials: OAuthClientCredentials
  refreshToken: string
  requestedScopes?: string[]
}

export type OAuthProtocolErrorCode =
  | 'invalid_client'
  | 'invalid_grant'
  | 'invalid_scope'
  | 'unauthorized_client'

export type OAuthProtocolResult<T> =
  | { success: true; value: T }
  | { success: false; error: OAuthProtocolErrorCode; description: string }

export interface OAuthTokenPair {
  accessToken: string
  refreshToken: string
  expiresIn: number
  expiresAt: number
  scope: string
}

interface OAuthClientRow {
  clientId: string
  clientSecret: string | null
  disabled: boolean
  public: boolean | null
  tokenEndpointAuthMethod: string | null
  grantTypes: string[] | null
  scopes: string[] | null
  skipConsent: boolean | null
}

interface RefreshTokenRow {
  id: string
  clientId: string
  sessionId: string | null
  userId: string
  referenceId: string | null
  expiresAt: Date
  revoked: Date | null
  authTime: Date | null
  scopes: string[]
  familyId: string
  familyConsentId: string | null
  generation: number
}

function protocolError<T>(
  error: OAuthProtocolErrorCode,
  description: string
): OAuthProtocolResult<T> {
  return { success: false, error, description }
}

function stripTokenPrefix(token: string, prefix: string): string | null {
  if (!token.startsWith(prefix)) return null
  const raw = token.slice(prefix.length)
  return raw || null
}

function clientAllowsRefresh(client: OAuthClientRow): boolean {
  const grants = client.grantTypes?.length ? client.grantTypes : ['authorization_code']
  return grants.includes('refresh_token') || grants.includes('authorization_code')
}

async function authenticateClient(
  client: OAuthClientRow | undefined,
  credentials: OAuthClientCredentials
): Promise<OAuthProtocolResult<OAuthClientRow>> {
  if (!client || client.disabled) {
    return protocolError('invalid_client', 'Client authentication failed.')
  }

  const registeredMethod = client.tokenEndpointAuthMethod ?? 'client_secret_basic'
  if (
    registeredMethod !== 'none' &&
    registeredMethod !== 'client_secret_basic' &&
    registeredMethod !== 'client_secret_post'
  ) {
    logger.error('OAuth client has an unsupported token authentication method', {
      clientId: client.clientId,
      registeredMethod,
    })
    return protocolError('invalid_client', 'Client authentication failed.')
  }
  if (credentials.method !== registeredMethod) {
    return protocolError(
      'invalid_client',
      'Client authentication method does not match registration.'
    )
  }

  if (registeredMethod === 'none') {
    if (!client.public || credentials.clientSecret) {
      return protocolError('invalid_client', 'Client authentication failed.')
    }
    return { success: true, value: client }
  }

  if (client.public || !client.clientSecret || !credentials.clientSecret) {
    return protocolError('invalid_client', 'Client authentication failed.')
  }

  try {
    const expected = await symmetricDecrypt({
      key: env.BETTER_AUTH_SECRET,
      data: client.clientSecret,
    })
    if (!safeCompare(expected, credentials.clientSecret)) {
      return protocolError('invalid_client', 'Client authentication failed.')
    }
  } catch (error) {
    logger.error('Failed to decrypt an OAuth client secret', { clientId: client.clientId, error })
    return protocolError('invalid_client', 'Client authentication failed.')
  }

  return { success: true, value: client }
}

async function readClient(
  database: OAuthDatabase,
  clientId: string
): Promise<OAuthClientRow | undefined> {
  const [client] = await database
    .select({
      clientId: oauthClient.clientId,
      clientSecret: oauthClient.clientSecret,
      disabled: oauthClient.disabled,
      public: oauthClient.public,
      tokenEndpointAuthMethod: oauthClient.tokenEndpointAuthMethod,
      grantTypes: oauthClient.grantTypes,
      scopes: oauthClient.scopes,
      skipConsent: oauthClient.skipConsent,
    })
    .from(oauthClient)
    .where(eq(oauthClient.clientId, clientId))
    .limit(1)
  return client
}

/** Validates one token-endpoint client authentication attempt against its registered method. */
export async function validateOAuthClientCredentials(
  credentials: OAuthClientCredentials,
  database: OAuthDatabase = db
): Promise<OAuthProtocolResult<undefined>> {
  const authenticated = await authenticateClient(
    await readClient(database, credentials.clientId),
    credentials
  )
  return authenticated.success
    ? { success: true, value: undefined }
    : protocolError(authenticated.error, authenticated.description)
}

async function readRefreshToken(
  database: OAuthReadDatabase,
  tokenHash: string
): Promise<RefreshTokenRow | undefined> {
  const [token] = await database
    .select({
      id: oauthRefreshToken.id,
      clientId: oauthRefreshToken.clientId,
      sessionId: oauthRefreshToken.sessionId,
      userId: oauthRefreshToken.userId,
      referenceId: oauthRefreshToken.referenceId,
      expiresAt: oauthRefreshToken.expiresAt,
      revoked: oauthRefreshToken.revoked,
      authTime: oauthRefreshToken.authTime,
      scopes: oauthRefreshToken.scopes,
      familyId: oauthRefreshToken.familyId,
      familyConsentId: oauthTokenFamily.consentId,
      generation: oauthRefreshToken.generation,
    })
    .from(oauthRefreshToken)
    .innerJoin(oauthTokenFamily, eq(oauthRefreshToken.familyId, oauthTokenFamily.id))
    .where(eq(oauthRefreshToken.token, tokenHash))
    .limit(1)
  return token
}

function validateScopes(
  tokenScopes: string[],
  clientScopes: string[] | null,
  requestedScopes?: string[]
): OAuthProtocolResult<string[]> {
  const scopes = requestedScopes ?? tokenScopes
  const tokenScopeSet = new Set(tokenScopes)
  const clientScopeSet = clientScopes ? new Set(clientScopes) : null
  for (const scope of scopes) {
    if (!tokenScopeSet.has(scope) || (clientScopeSet && !clientScopeSet.has(scope))) {
      return protocolError('invalid_scope', `The client cannot refresh scope ${scope}.`)
    }
  }
  return { success: true, value: scopes }
}

/**
 * Rotates one refresh token under the stable family lock.
 *
 * Replay is intentionally fail-closed: after the first rotation commits, a
 * second presentation of any consumed generation deletes the family parent.
 * Cascades remove every refresh token and every access token issued by this
 * login while independent logins for the same user and client remain intact.
 */
export async function rotateOAuthRefreshToken(
  input: RotateOAuthRefreshTokenInput,
  database: OAuthDatabase = db
): Promise<OAuthProtocolResult<OAuthTokenPair>> {
  const rawRefreshToken = stripTokenPrefix(input.refreshToken, OAUTH_REFRESH_TOKEN_PREFIX)
  if (!rawRefreshToken) return protocolError('invalid_grant', 'Refresh token is invalid.')

  const clientAuthentication = await authenticateClient(
    await readClient(database, input.credentials.clientId),
    input.credentials
  )
  if (!clientAuthentication.success) return clientAuthentication
  if (!clientAllowsRefresh(clientAuthentication.value)) {
    return protocolError('unauthorized_client', 'Client is not allowed to use refresh tokens.')
  }

  const tokenHash = hashOAuthToken(rawRefreshToken)
  const provisionalToken = await readRefreshToken(database, tokenHash)
  if (!provisionalToken) return protocolError('invalid_grant', 'Refresh token is invalid.')
  if (provisionalToken.clientId !== input.credentials.clientId) {
    return protocolError('invalid_grant', 'Refresh token is invalid.')
  }

  const nextRefreshBody = generateSecureToken(32)
  const nextAccessBody = generateSecureToken(32)
  const nextRefreshId = generateId()
  const nextAccessId = generateId()

  return database.transaction(async (tx) => {
    const [activeUser] = await tx
      .select({
        id: user.id,
        banned: user.banned,
        banExpires: user.banExpires,
        suspendedAt: user.suspendedAt,
      })
      .from(user)
      .where(eq(user.id, provisionalToken.userId))
      .for('share')
      .limit(1)
    if (!activeUser || isAccountBlocked(activeUser)) {
      return protocolError('invalid_grant', 'Refresh token is invalid.')
    }

    if (provisionalToken.sessionId) {
      const [activeSession] = await tx
        .select({ id: session.id })
        .from(session)
        .where(eq(session.id, provisionalToken.sessionId))
        .for('share')
        .limit(1)
      if (!activeSession) return protocolError('invalid_grant', 'Refresh token is invalid.')
    }

    const [lockedClient] = await tx
      .select({
        clientId: oauthClient.clientId,
        clientSecret: oauthClient.clientSecret,
        disabled: oauthClient.disabled,
        public: oauthClient.public,
        tokenEndpointAuthMethod: oauthClient.tokenEndpointAuthMethod,
        grantTypes: oauthClient.grantTypes,
        scopes: oauthClient.scopes,
        skipConsent: oauthClient.skipConsent,
      })
      .from(oauthClient)
      .where(eq(oauthClient.clientId, input.credentials.clientId))
      .for('share')
      .limit(1)
    const lockedAuthentication = await authenticateClient(lockedClient, input.credentials)
    if (!lockedAuthentication.success) return lockedAuthentication
    if (!clientAllowsRefresh(lockedAuthentication.value)) {
      return protocolError('unauthorized_client', 'Client is not allowed to use refresh tokens.')
    }

    let consentScopes: string[] | null = null
    if (!lockedClient?.skipConsent) {
      if (!provisionalToken.familyConsentId) {
        return protocolError('invalid_grant', 'Refresh token is invalid.')
      }
      const [consent] = await tx
        .select({ id: oauthConsent.id, scopes: oauthConsent.scopes })
        .from(oauthConsent)
        .where(eq(oauthConsent.id, provisionalToken.familyConsentId))
        .for('share')
        .limit(1)
      if (!consent) return protocolError('invalid_grant', 'Refresh token is invalid.')
      consentScopes = consent.scopes
    }

    const [family] = await tx
      .select({
        id: oauthTokenFamily.id,
        clientId: oauthTokenFamily.clientId,
        userId: oauthTokenFamily.userId,
        sessionId: oauthTokenFamily.sessionId,
        referenceId: oauthTokenFamily.referenceId,
        currentGeneration: oauthTokenFamily.currentGeneration,
        expiresAt: oauthTokenFamily.expiresAt,
      })
      .from(oauthTokenFamily)
      .where(eq(oauthTokenFamily.id, provisionalToken.familyId))
      .for('update')
      .limit(1)
    if (!family) return protocolError('invalid_grant', 'Refresh token is invalid.')

    const rotationTime = new Date()
    const currentToken = await readRefreshToken(tx, tokenHash)
    if (
      !currentToken ||
      currentToken.familyId !== family.id ||
      currentToken.clientId !== family.clientId ||
      currentToken.userId !== family.userId ||
      currentToken.sessionId !== family.sessionId ||
      currentToken.referenceId !== family.referenceId ||
      currentToken.revoked ||
      currentToken.expiresAt <= rotationTime ||
      family.expiresAt <= rotationTime ||
      currentToken.generation !== family.currentGeneration
    ) {
      await tx.delete(oauthTokenFamily).where(eq(oauthTokenFamily.id, family.id))
      return protocolError('invalid_grant', 'Refresh token is invalid or has already been used.')
    }

    const originalScopesAllowedByClient =
      !lockedClient.scopes ||
      currentToken.scopes.every((scope) => lockedClient.scopes?.includes(scope))
    const originalScopesStillConsented =
      lockedClient.skipConsent ||
      (consentScopes !== null &&
        currentToken.scopes.every((scope) => consentScopes.includes(scope)))
    if (!originalScopesAllowedByClient || !originalScopesStillConsented) {
      await tx.delete(oauthTokenFamily).where(eq(oauthTokenFamily.id, family.id))
      return protocolError('invalid_grant', 'Refresh token grant is no longer active.')
    }
    if (family.currentGeneration >= OAUTH_TOKEN_FAMILY_MAX_GENERATION) {
      await tx.delete(oauthTokenFamily).where(eq(oauthTokenFamily.id, family.id))
      return protocolError('invalid_grant', 'Refresh token grant reached its rotation limit.')
    }

    const scopes = validateScopes(currentToken.scopes, lockedClient.scopes, input.requestedScopes)
    if (!scopes.success) return scopes

    const [consumed] = await tx
      .update(oauthRefreshToken)
      .set({ revoked: rotationTime })
      .where(and(eq(oauthRefreshToken.id, currentToken.id), isNull(oauthRefreshToken.revoked)))
      .returning({ id: oauthRefreshToken.id })
    if (!consumed) {
      await tx.delete(oauthTokenFamily).where(eq(oauthTokenFamily.id, family.id))
      return protocolError('invalid_grant', 'Refresh token is invalid or has already been used.')
    }

    const nextGeneration = family.currentGeneration + 1
    await tx
      .update(oauthTokenFamily)
      .set({ currentGeneration: nextGeneration })
      .where(eq(oauthTokenFamily.id, family.id))

    const accessExpiresAt = new Date(rotationTime.getTime() + OAUTH_ACCESS_TOKEN_TTL_SECONDS * 1000)

    await tx.insert(oauthRefreshToken).values({
      id: nextRefreshId,
      token: hashOAuthToken(nextRefreshBody),
      clientId: currentToken.clientId,
      sessionId: currentToken.sessionId,
      userId: currentToken.userId,
      referenceId: currentToken.referenceId,
      expiresAt: family.expiresAt,
      createdAt: rotationTime,
      revoked: null,
      authTime: currentToken.authTime,
      scopes: currentToken.scopes,
      familyId: family.id,
      generation: nextGeneration,
    })
    await tx.insert(oauthAccessToken).values({
      id: nextAccessId,
      token: hashOAuthToken(nextAccessBody),
      clientId: currentToken.clientId,
      sessionId: currentToken.sessionId,
      userId: currentToken.userId,
      referenceId: currentToken.referenceId,
      refreshId: nextRefreshId,
      expiresAt: accessExpiresAt,
      createdAt: rotationTime,
      scopes: scopes.value,
    })

    return {
      success: true,
      value: {
        accessToken: `${OAUTH_ACCESS_TOKEN_PREFIX}${nextAccessBody}`,
        refreshToken: `${OAUTH_REFRESH_TOKEN_PREFIX}${nextRefreshBody}`,
        expiresIn: OAUTH_ACCESS_TOKEN_TTL_SECONDS,
        expiresAt: Math.floor(accessExpiresAt.getTime() / 1000),
        scope: scopes.value.join(' '),
      },
    }
  })
}

/** Revokes one refresh family or one opaque access token. Unknown tokens are a successful no-op. */
export async function revokeOAuthToken(
  input: { credentials: OAuthClientCredentials; token: string },
  database: OAuthDatabase = db
): Promise<OAuthProtocolResult<undefined>> {
  const clientAuthentication = await authenticateClient(
    await readClient(database, input.credentials.clientId),
    input.credentials
  )
  if (!clientAuthentication.success) return clientAuthentication

  const rawRefreshToken = stripTokenPrefix(input.token, OAUTH_REFRESH_TOKEN_PREFIX)
  if (rawRefreshToken) {
    const provisionalToken = await readRefreshToken(database, hashOAuthToken(rawRefreshToken))
    if (!provisionalToken || provisionalToken.clientId !== input.credentials.clientId) {
      return { success: true, value: undefined }
    }

    return database.transaction(async (tx) => {
      await tx
        .select({ id: user.id })
        .from(user)
        .where(eq(user.id, provisionalToken.userId))
        .for('share')
        .limit(1)
      if (provisionalToken.sessionId) {
        await tx
          .select({ id: session.id })
          .from(session)
          .where(eq(session.id, provisionalToken.sessionId))
          .for('share')
          .limit(1)
      }
      const [lockedClient] = await tx
        .select({
          clientId: oauthClient.clientId,
          clientSecret: oauthClient.clientSecret,
          disabled: oauthClient.disabled,
          public: oauthClient.public,
          tokenEndpointAuthMethod: oauthClient.tokenEndpointAuthMethod,
          grantTypes: oauthClient.grantTypes,
          scopes: oauthClient.scopes,
          skipConsent: oauthClient.skipConsent,
        })
        .from(oauthClient)
        .where(eq(oauthClient.clientId, input.credentials.clientId))
        .for('share')
        .limit(1)
      const lockedAuthentication = await authenticateClient(lockedClient, input.credentials)
      if (!lockedAuthentication.success) return lockedAuthentication

      const [family] = await tx
        .select({ id: oauthTokenFamily.id, consentId: oauthTokenFamily.consentId })
        .from(oauthTokenFamily)
        .where(eq(oauthTokenFamily.id, provisionalToken.familyId))
        .limit(1)
      if (!family) return { success: true, value: undefined }

      if (family.consentId) {
        await tx
          .select({ id: oauthConsent.id })
          .from(oauthConsent)
          .where(eq(oauthConsent.id, family.consentId))
          .for('share')
          .limit(1)
      }
      await tx
        .select({ id: oauthTokenFamily.id })
        .from(oauthTokenFamily)
        .where(eq(oauthTokenFamily.id, family.id))
        .for('update')
        .limit(1)
      await tx.delete(oauthTokenFamily).where(eq(oauthTokenFamily.id, family.id))
      return { success: true, value: undefined }
    })
  }

  const rawAccessToken = stripTokenPrefix(input.token, OAUTH_ACCESS_TOKEN_PREFIX)
  if (rawAccessToken) {
    await database
      .delete(oauthAccessToken)
      .where(
        and(
          eq(oauthAccessToken.token, hashOAuthToken(rawAccessToken)),
          eq(oauthAccessToken.clientId, input.credentials.clientId)
        )
      )
  }
  return { success: true, value: undefined }
}
