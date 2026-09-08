import type { OAuthAccessTokenPrincipal } from '@sim/auth/principal'
import { db } from '@sim/db'
import { oauthAccessToken, oauthClient, user } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { sha256Hex } from '@sim/security/hash'
import { eq } from 'drizzle-orm'
import { isAccountBlocked } from '@/lib/auth/ban'
import {
  OAUTH_ACCESS_TOKEN_PREFIX,
  OAUTH_API_READ_SCOPE,
  oauthScopeSatisfies,
} from '@/lib/auth/oauth-provider'

const logger = createLogger('OAuthAccessToken')

const BEARER_SCHEME = /^Bearer[ ]+/i

/**
 * Hashes an issued token for storage and lookup. Handed to the plugin as
 * `storeTokens.hash`, so the row the plugin writes and the row this file reads
 * are computed by one function. The tokens are 32 random alphanumerics (190
 * bits), so a fast digest is the right construction — see the note on
 * {@link sha256Hex}.
 *
 * It lives here rather than beside the other OAuth vocabulary because
 * `sha256Hex` pulls in `node:crypto`: the consent card and the authorized-apps
 * settings page both import that module for their scope wording, so anything
 * server-only in it would follow them into the browser bundle.
 */
export function hashOAuthToken(token: string): string {
  return sha256Hex(token)
}

export type InvalidOAuthAccessTokenReason =
  | 'malformed'
  | 'unknown'
  | 'expired'
  | 'client_disabled'
  | 'user_missing'
  | 'user_banned'
  | 'wrong_resource'

export class InvalidOAuthAccessTokenError extends Error {
  constructor(readonly reason: InvalidOAuthAccessTokenReason) {
    super('Invalid access token')
    this.name = 'InvalidOAuthAccessTokenError'
  }
}

/**
 * The single token in an `Authorization: Bearer` header, or `null` when the
 * header is absent or carries another scheme.
 *
 * The scheme is matched case-insensitively because RFC 7235 §2.1 defines it
 * that way — `bearer foo` is a well-formed credential, and treating it as no
 * credential at all would let it through the optional-auth path as an
 * anonymous request instead of refusing it. The credential itself is still
 * strict: a header carrying two tokens or an empty value is refused rather
 * than guessed at.
 */
export function parseBearerToken(headers: Headers): string | null {
  const header = headers.get('authorization')
  if (!header || !BEARER_SCHEME.test(header)) return null
  const token = header.replace(BEARER_SCHEME, '').trim()
  return token && !/\s/.test(token) ? token : null
}

/** Whether a bearer credential is one of Sim's own OAuth access tokens, by its prefix. */
function looksLikeOAuthAccessToken(token: string): boolean {
  return token.startsWith(OAUTH_ACCESS_TOKEN_PREFIX)
}

export interface OAuthAccessTokenOptions {
  resource?: string
  /** Search MCP also accepts existing full-API grants; Search-only tokens still need an audience. */
  allowUnboundApiTokens?: boolean
}

/**
 * Resolves an opaque OAuth access token to the principal it stands for.
 *
 * One indexed read: the token is hashed the same way the provider stored it and
 * joined to its client and user, so the checks the API-key path makes about a
 * key row — not expired, owner still exists, owner not banned — are made here
 * about the token row, plus the one that is new: the client has not been
 * disabled. Nothing about the token is cached; that is what makes revoking an
 * app in settings, or `sim logout`, take effect on the very next request.
 */
export async function verifyOAuthAccessToken(
  token: string,
  options: OAuthAccessTokenOptions = {}
): Promise<OAuthAccessTokenPrincipal> {
  if (!looksLikeOAuthAccessToken(token)) throw new InvalidOAuthAccessTokenError('malformed')
  const raw = token.slice(OAUTH_ACCESS_TOKEN_PREFIX.length)
  if (!raw) throw new InvalidOAuthAccessTokenError('malformed')

  const [row] = await db
    .select({
      id: oauthAccessToken.id,
      userId: oauthAccessToken.userId,
      clientId: oauthAccessToken.clientId,
      scopes: oauthAccessToken.scopes,
      resource: oauthAccessToken.resource,
      expiresAt: oauthAccessToken.expiresAt,
      clientDisabled: oauthClient.disabled,
      userBanned: user.banned,
      userBanExpires: user.banExpires,
      userSuspendedAt: user.suspendedAt,
      userExists: user.id,
    })
    .from(oauthAccessToken)
    .innerJoin(oauthClient, eq(oauthAccessToken.clientId, oauthClient.clientId))
    .leftJoin(user, eq(oauthAccessToken.userId, user.id))
    .where(eq(oauthAccessToken.token, hashOAuthToken(raw)))
    .limit(1)

  if (!row) throw new InvalidOAuthAccessTokenError('unknown')
  const acceptsUnboundApiToken =
    options.allowUnboundApiTokens &&
    options.resource &&
    row.resource == null &&
    oauthScopeSatisfies(row.scopes, OAUTH_API_READ_SCOPE)
  if ((row.resource ?? null) !== (options.resource ?? null) && !acceptsUnboundApiToken) {
    throw new InvalidOAuthAccessTokenError('wrong_resource')
  }
  if (row.expiresAt <= new Date()) throw new InvalidOAuthAccessTokenError('expired')
  if (row.clientDisabled) throw new InvalidOAuthAccessTokenError('client_disabled')
  if (!row.userId || !row.userExists) throw new InvalidOAuthAccessTokenError('user_missing')
  if (
    isAccountBlocked({
      banned: row.userBanned,
      banExpires: row.userBanExpires,
      suspendedAt: row.userSuspendedAt,
    })
  ) {
    throw new InvalidOAuthAccessTokenError('user_banned')
  }

  logger.debug('Authenticated OAuth access token', { tokenId: row.id, clientId: row.clientId })
  return {
    kind: 'oauth_access_token',
    userId: row.userId,
    clientId: row.clientId,
    tokenId: row.id,
    scopes: row.scopes,
    expiresAt: row.expiresAt,
  }
}
