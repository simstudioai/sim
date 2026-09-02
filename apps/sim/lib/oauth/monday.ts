import type { OAuth2Tokens } from 'better-auth/oauth2'
import { decodeJwt } from 'jose'
import { z } from 'zod'
import {
  DEFAULT_MAX_ERROR_BODY_BYTES,
  readResponseJsonWithLimit,
  readResponseTextWithLimit,
} from '@/lib/core/utils/stream-limits'

export const MONDAY_OAUTH_AUTHORIZATION_URL = 'https://auth.monday.com/oauth2/authorize'
export const MONDAY_OAUTH_TOKEN_URL = 'https://auth.monday.com/oauth_ms/oauth/token'

const MONDAY_OAUTH_TOKEN_TIMEOUT_MS = 15_000
const MONDAY_ACCESS_TOKEN_FALLBACK_LIFETIME_SECONDS = 60 * 60
const MONDAY_ACCESS_TOKEN_MAX_RESPONSE_LIFETIME_SECONDS = 24 * 60 * 60

const mondayOAuthTokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  token_type: z.string().min(1),
  expires_in: z.union([z.number(), z.string()]).optional(),
  scope: z.string().optional(),
})

interface ExchangeMondayAuthorizationCodeParams {
  clientId: string
  clientSecret: string
  code: string
  codeVerifier: string
  redirectUri: string
}

function parsePositiveLifetimeSeconds(value: unknown): number | undefined {
  const parsed = typeof value === 'number' || typeof value === 'string' ? Number(value) : Number.NaN
  return Number.isFinite(parsed) &&
    parsed > 0 &&
    parsed <= MONDAY_ACCESS_TOKEN_MAX_RESPONSE_LIFETIME_SECONDS
    ? parsed
    : undefined
}

/**
 * Resolves monday.com's access-token expiry for storage and refresh scheduling.
 *
 * OAuth 2.1 access tokens are JWTs and monday.com documents the `exp` claim as
 * authoritative. The response lifetime and one-hour documented default keep
 * credentials refreshable if a deployment temporarily receives an opaque token.
 */
export function resolveMondayAccessTokenExpiresAt(
  accessToken: string,
  expiresIn?: unknown,
  now = new Date()
): Date {
  try {
    const { exp } = decodeJwt(accessToken)
    if (typeof exp === 'number' && Number.isFinite(exp) && exp * 1000 > now.getTime()) {
      const expiresAt = new Date(exp * 1000)
      if (!Number.isNaN(expiresAt.getTime())) return expiresAt
    }
  } catch {}

  const lifetimeSeconds =
    parsePositiveLifetimeSeconds(expiresIn) ?? MONDAY_ACCESS_TOKEN_FALLBACK_LIFETIME_SECONDS
  return new Date(now.getTime() + lifetimeSeconds * 1000)
}

/** Exchanges a monday.com OAuth 2.1 authorization code without exposing token material. */
export async function exchangeMondayAuthorizationCode({
  clientId,
  clientSecret,
  code,
  codeVerifier,
  redirectUri,
}: ExchangeMondayAuthorizationCodeParams): Promise<OAuth2Tokens> {
  const signal = AbortSignal.timeout(MONDAY_OAUTH_TOKEN_TIMEOUT_MS)
  const response = await fetch(MONDAY_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    }),
    redirect: 'error',
    signal,
  })
  if (!response.ok) {
    await readResponseTextWithLimit(response, {
      maxBytes: DEFAULT_MAX_ERROR_BODY_BYTES,
      label: 'Monday OAuth token error response',
      signal,
    }).catch(() => {})
    throw new Error(`Monday OAuth token exchange failed with HTTP ${response.status}`)
  }

  const payload = await readResponseJsonWithLimit<unknown>(response, {
    maxBytes: DEFAULT_MAX_ERROR_BODY_BYTES,
    label: 'Monday OAuth token response',
    signal,
  })

  const parsed = mondayOAuthTokenResponseSchema.safeParse(payload)
  if (!parsed.success || parsed.data.token_type.toLowerCase() !== 'bearer') {
    throw new Error('Monday OAuth token response was incomplete')
  }

  const scopes = parsed.data.scope?.split(/\s+/).filter(Boolean)
  return {
    accessToken: parsed.data.access_token,
    refreshToken: parsed.data.refresh_token,
    tokenType: parsed.data.token_type,
    accessTokenExpiresAt: resolveMondayAccessTokenExpiresAt(
      parsed.data.access_token,
      parsed.data.expires_in
    ),
    ...(scopes ? { scopes } : {}),
  }
}
