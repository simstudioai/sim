import { generateId } from '@sim/utils/id'
import type { OAuth2Tokens } from 'better-auth/oauth2'
import type { GenericOAuthConfig } from 'better-auth/plugins'
import { z } from 'zod'
import { syntheticConnectorEmail } from '@/lib/auth/connector-email'
import {
  DEFAULT_MAX_ERROR_BODY_BYTES,
  readResponseJsonWithLimit,
} from '@/lib/core/utils/stream-limits'

export const GREENHOUSE_TOKEN_URL = 'https://auth.greenhouse.io/token'
const GREENHOUSE_INTROSPECTION_URL = 'https://auth.greenhouse.io/introspect'
const REQUEST_TIMEOUT_MS = 15_000
const REFRESH_TOKEN_LIFETIME_MS = 14 * 24 * 60 * 60 * 1000

const tokenSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  token_type: z.string().refine((value) => value.toLowerCase() === 'bearer'),
  expires_at: z.iso.datetime({ offset: true }).optional(),
  expires_in: z.number().int().positive().optional(),
})

const introspectionSchema = z.object({
  active: z.literal(true),
  client_id: z.string().min(1),
  sub: z.string().min(1),
  scope: z.string(),
  token_type: z.string().refine((value) => value.toLowerCase() === 'bearer'),
  username: z.email().nullish(),
  'https://auth.greenhouse.io/claims': z.object({
    organization: z.object({
      id: z.number().int(),
      name: z.string().optional(),
    }),
  }),
})

/** Parses the partner grant's absolute expiry and mandatory rotating refresh token. */
export function parseGreenhouseTokens(payload: unknown, now = new Date()) {
  const parsed = tokenSchema.safeParse(payload)
  if (!parsed.success) throw new Error('Invalid Greenhouse token response')
  const data = parsed.data
  const expiresAt = data.expires_at
    ? new Date(data.expires_at)
    : data.expires_in
      ? new Date(now.getTime() + data.expires_in * 1000)
      : undefined
  if (!expiresAt || !Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= now.getTime()) {
    throw new Error('Invalid Greenhouse token response')
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    tokenType: data.token_type,
    accessTokenExpiresAt: expiresAt,
    refreshTokenExpiresAt: new Date(now.getTime() + REFRESH_TOKEN_LIFETIME_MS),
  } satisfies OAuth2Tokens
}

/** Maps only documented refresh-grant failures to the shared reconnect classification. */
export function getGreenhouseRefreshErrorCode(payload: unknown): string | undefined {
  const parsed = z.object({ errors: z.array(z.string()) }).safeParse(payload)
  if (!parsed.success) return undefined
  return parsed.data.errors.some((error) =>
    /^(?:Refresh token does not exist|Refresh token has already been exchanged for new tokens|Refresh token is assigned to a disabled user|Refresh token has been invalidated at .+|Refresh token expired at .+)$/.test(
      error
    )
  )
    ? 'invalid_grant'
    : undefined
}

interface GreenhouseProviderParams {
  clientId: string
  clientSecret: string
  redirectURI: string
  scopes: string[]
}

/** Connects a registered Greenhouse partner app through the documented authorization-code flow. */
export function createGreenhouseProvider({
  clientId,
  clientSecret,
  redirectURI,
  scopes,
}: GreenhouseProviderParams): GenericOAuthConfig {
  const authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`
  async function post(url: string, body: URLSearchParams | undefined, label: string) {
    const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    let response: Response
    try {
      // boundary-raw-fetch: Greenhouse OAuth token exchange and introspection use external form requests.
      response = await fetch(url, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Authorization: authorization,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
        signal,
        redirect: 'error',
      })
    } catch {
      throw new Error(`Greenhouse ${label} request failed`)
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {})
      throw new Error(`Greenhouse ${label} failed with HTTP ${response.status}`)
    }
    try {
      return await readResponseJsonWithLimit<unknown>(response, {
        maxBytes: DEFAULT_MAX_ERROR_BODY_BYTES,
        label: `Greenhouse ${label} response`,
        signal,
      })
    } catch {
      throw new Error(`Invalid Greenhouse ${label} response`)
    }
  }
  return {
    providerId: 'greenhouse',
    clientId,
    clientSecret,
    authorizationUrl: 'https://auth.greenhouse.io/authorize',
    tokenUrl: GREENHOUSE_TOKEN_URL,
    scopes,
    responseType: 'code',
    authentication: 'basic',
    redirectURI,
    getToken: async ({ code }) => {
      const url = new URL(GREENHOUSE_TOKEN_URL)
      url.searchParams.set('grant_type', 'authorization_code')
      url.searchParams.set('code', code)
      return parseGreenhouseTokens(await post(url.toString(), undefined, 'token exchange'))
    },
    getUserInfo: async (tokens) => {
      if (!tokens.accessToken) throw new Error('Greenhouse token identity could not be verified')
      const parsed = introspectionSchema.safeParse(
        await post(
          GREENHOUSE_INTROSPECTION_URL,
          new URLSearchParams({ token: tokens.accessToken, token_type_hint: 'access_token' }),
          'token introspection'
        )
      )
      if (!parsed.success || parsed.data.client_id !== clientId) {
        throw new Error('Greenhouse token identity could not be verified')
      }
      const identity = parsed.data
      const organization = identity['https://auth.greenhouse.io/claims'].organization
      tokens.scopes = identity.scope.split(/\s+/).filter(Boolean)
      const now = new Date()
      return {
        id: `${organization.id}-${identity.sub}-${generateId()}`,
        name: organization.name || 'Greenhouse',
        email: identity.username || syntheticConnectorEmail('greenhouse', identity.sub),
        emailVerified: false,
        createdAt: now,
        updatedAt: now,
      }
    },
  }
}
