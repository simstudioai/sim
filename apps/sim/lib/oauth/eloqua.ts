import type { OAuth2Tokens } from 'better-auth/oauth2'
import { z } from 'zod'
import {
  DEFAULT_MAX_ERROR_BODY_BYTES,
  readResponseJsonWithLimit,
  readResponseTextWithLimit,
} from '@/lib/core/utils/stream-limits'

export const ELOQUA_OAUTH_AUTHORIZATION_URL = 'https://login.eloqua.com/auth/oauth2/authorize'
export const ELOQUA_OAUTH_TOKEN_URL = 'https://login.eloqua.com/auth/oauth2/token'
export const ELOQUA_IDENTITY_URL = 'https://login.eloqua.com/id'

const ELOQUA_OAUTH_TIMEOUT_MS = 15_000
const ELOQUA_ACCESS_TOKEN_FALLBACK_LIFETIME_SECONDS = 8 * 60 * 60
const ELOQUA_INSTANCE_SCOPE_PREFIX = '__eloqua_instance__:'
const ELOQUA_POD_HOST_REGEX = /^secure\.(p01|p02|p03|p04|p06|p07|p08)\.eloqua\.com$/

const eloquaOAuthTokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  token_type: z.string().min(1),
  expires_in: z.union([z.number(), z.string()]).optional(),
})

const eloquaIdentitySchema = z.object({
  site: z.object({
    id: z.union([z.number(), z.string()]),
    name: z.string().min(1),
  }),
  user: z.object({
    id: z.union([z.number(), z.string()]),
    username: z.string().min(1),
    displayName: z.string().min(1).optional(),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    emailAddress: z.string().optional(),
  }),
  urls: z.object({
    base: z.string().min(1),
  }),
})

export interface EloquaIdentity {
  site: {
    id: string
    name: string
  }
  user: {
    id: string
    username: string
    displayName?: string
    firstName?: string
    lastName?: string
    emailAddress?: string
  }
  instanceUrl: string
}

interface ExchangeEloquaAuthorizationCodeParams {
  clientId: string
  clientSecret: string
  code: string
  redirectUri: string
}

function parsePositiveLifetimeSeconds(value: unknown): number | undefined {
  const parsed = typeof value === 'number' || typeof value === 'string' ? Number(value) : Number.NaN
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 24 * 60 * 60 ? parsed : undefined
}

/** Validates and canonicalizes an Eloqua REST API pod root returned by `/id`. */
export function normalizeEloquaInstanceUrl(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('Eloqua instance URL must be a non-empty HTTPS URL')
  }

  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    throw new Error('Eloqua instance URL must be a valid HTTPS URL')
  }

  if (
    url.protocol !== 'https:' ||
    url.username !== '' ||
    url.password !== '' ||
    url.port !== '' ||
    (url.pathname !== '' && url.pathname !== '/') ||
    url.search !== '' ||
    url.hash !== '' ||
    !ELOQUA_POD_HOST_REGEX.test(url.hostname)
  ) {
    throw new Error('Eloqua instance URL must be a supported secure Eloqua pod root')
  }

  return `https://${url.hostname}`
}

/** Adds the credential-bound Eloqua pod to the stored OAuth scope set. */
export function withEloquaInstanceScope(
  instanceUrl: string,
  scopes: readonly string[] | undefined
): string[] {
  const normalized = normalizeEloquaInstanceUrl(instanceUrl)
  const ordinaryScopes = (scopes ?? []).filter(
    (scope) => !scope.startsWith(ELOQUA_INSTANCE_SCOPE_PREFIX)
  )
  return [`${ELOQUA_INSTANCE_SCOPE_PREFIX}${normalized}`, ...ordinaryScopes]
}

/** Reads and validates the credential-bound Eloqua pod from a stored scope string. */
export function extractEloquaInstanceUrl(scope: string | null | undefined): string | undefined {
  const markers = (scope ?? '')
    .split(/[\s,]+/)
    .filter((value) => value.startsWith(ELOQUA_INSTANCE_SCOPE_PREFIX))
  if (markers.length !== 1) return undefined

  const candidate = markers[0].slice(ELOQUA_INSTANCE_SCOPE_PREFIX.length)
  if (!candidate) return undefined
  try {
    return normalizeEloquaInstanceUrl(candidate)
  } catch {
    return undefined
  }
}

/** Exchanges an Eloqua authorization code using JSON and HTTP Basic client authentication. */
export async function exchangeEloquaAuthorizationCode({
  clientId,
  clientSecret,
  code,
  redirectUri,
}: ExchangeEloquaAuthorizationCodeParams): Promise<OAuth2Tokens> {
  const signal = AbortSignal.timeout(ELOQUA_OAUTH_TIMEOUT_MS)
  const response = await fetch(ELOQUA_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    }),
    redirect: 'error',
    signal,
  })

  if (!response.ok) {
    await readResponseTextWithLimit(response, {
      maxBytes: DEFAULT_MAX_ERROR_BODY_BYTES,
      label: 'Eloqua OAuth token error response',
      signal,
    }).catch(() => {})
    throw new Error(`Eloqua OAuth token exchange failed with HTTP ${response.status}`)
  }

  const payload = await readResponseJsonWithLimit<unknown>(response, {
    maxBytes: DEFAULT_MAX_ERROR_BODY_BYTES,
    label: 'Eloqua OAuth token response',
    signal,
  })
  const parsed = eloquaOAuthTokenResponseSchema.safeParse(payload)
  if (!parsed.success || parsed.data.token_type.toLowerCase() !== 'bearer') {
    throw new Error('Eloqua OAuth token response was incomplete')
  }

  const lifetimeSeconds =
    parsePositiveLifetimeSeconds(parsed.data.expires_in) ??
    ELOQUA_ACCESS_TOKEN_FALLBACK_LIFETIME_SECONDS
  return {
    accessToken: parsed.data.access_token,
    refreshToken: parsed.data.refresh_token,
    tokenType: parsed.data.token_type,
    accessTokenExpiresAt: new Date(Date.now() + lifetimeSeconds * 1000),
    scopes: ['full'],
  }
}

/** Fetches and strictly projects the authenticated Eloqua site/user identity and API pod. */
export async function fetchEloquaIdentity(accessToken: string): Promise<EloquaIdentity> {
  const signal = AbortSignal.timeout(ELOQUA_OAUTH_TIMEOUT_MS)
  const response = await fetch(ELOQUA_IDENTITY_URL, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    redirect: 'error',
    signal,
  })

  if (!response.ok) {
    await readResponseTextWithLimit(response, {
      maxBytes: DEFAULT_MAX_ERROR_BODY_BYTES,
      label: 'Eloqua identity error response',
      signal,
    }).catch(() => {})
    throw new Error(`Eloqua identity lookup failed with HTTP ${response.status}`)
  }

  const payload = await readResponseJsonWithLimit<unknown>(response, {
    maxBytes: DEFAULT_MAX_ERROR_BODY_BYTES,
    label: 'Eloqua identity response',
    signal,
  })
  const parsed = eloquaIdentitySchema.safeParse(payload)
  if (!parsed.success) throw new Error('Eloqua identity response was incomplete')

  return {
    site: { id: String(parsed.data.site.id), name: parsed.data.site.name },
    user: {
      id: String(parsed.data.user.id),
      username: parsed.data.user.username,
      ...(parsed.data.user.displayName ? { displayName: parsed.data.user.displayName } : {}),
      ...(parsed.data.user.firstName ? { firstName: parsed.data.user.firstName } : {}),
      ...(parsed.data.user.lastName ? { lastName: parsed.data.user.lastName } : {}),
      ...(parsed.data.user.emailAddress ? { emailAddress: parsed.data.user.emailAddress } : {}),
    },
    instanceUrl: normalizeEloquaInstanceUrl(parsed.data.urls.base),
  }
}
