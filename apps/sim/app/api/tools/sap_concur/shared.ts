import { createHash } from 'node:crypto'
import { createLogger } from '@sim/logger'
import { z } from 'zod'
import { secureFetchWithValidation } from '@/lib/core/security/input-validation.server'
import { FileInputSchema } from '@/lib/uploads/utils/file-schemas'

const logger = createLogger('SapConcurShared')

export const SAP_CONCUR_ALLOWED_DATACENTERS = new Set([
  'us.api.concursolutions.com',
  'us2.api.concursolutions.com',
  'eu.api.concursolutions.com',
  'eu2.api.concursolutions.com',
  'cn.api.concursolutions.com',
  'emea.api.concursolutions.com',
])

export const SapConcurDatacenterSchema = z
  .string()
  .min(1)
  .refine((d) => SAP_CONCUR_ALLOWED_DATACENTERS.has(d), {
    message: `datacenter must be one of: ${Array.from(SAP_CONCUR_ALLOWED_DATACENTERS).join(', ')}`,
  })

export const SapConcurGrantTypeSchema = z.enum(['client_credentials', 'password'])

export const SapConcurAuthSchema = z.object({
  datacenter: SapConcurDatacenterSchema.default('us.api.concursolutions.com'),
  grantType: SapConcurGrantTypeSchema.default('client_credentials'),
  clientId: z.string().min(1, 'clientId is required'),
  clientSecret: z.string().min(1, 'clientSecret is required'),
  username: z.string().optional(),
  password: z.string().optional(),
  companyUuid: z.string().optional(),
})

export type SapConcurAuth = z.infer<typeof SapConcurAuthSchema>

export const SapConcurHttpMethod = z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])

export const SapConcurProxyPath = z
  .string()
  .min(1, 'path is required')
  .refine(
    (p) =>
      !p.split(/[/\\]/).some((seg) => seg === '..' || seg === '.') &&
      !p.includes('#') &&
      !/%(?:2[eEfF]|5[cC]|23)/.test(p),
    {
      message:
        'path must not contain ".." or "." segments, "#", or percent-encoded path/fragment characters',
    }
  )

export const SapConcurProxyRequestSchema = SapConcurAuthSchema.extend({
  path: SapConcurProxyPath,
  method: SapConcurHttpMethod.default('GET'),
  query: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  body: z.unknown().optional(),
  contentType: z.string().optional(),
}).superRefine((req, ctx) => {
  if (req.grantType === 'password') {
    if (!req.username) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['username'],
        message: 'username is required for password grant',
      })
    }
    if (!req.password) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['password'],
        message: 'password is required for password grant',
      })
    }
  }
})

export type SapConcurProxyRequest = z.infer<typeof SapConcurProxyRequestSchema>

export const SapConcurUploadOperation = z.enum([
  'upload_receipt_image',
  'create_quick_expense_with_image',
])

export const SapConcurUploadRequestSchema = SapConcurAuthSchema.extend({
  operation: SapConcurUploadOperation,
  userId: z.string().min(1, 'userId is required'),
  contextType: z.string().optional(),
  receipt: FileInputSchema,
  forwardId: z.string().max(40).optional(),
  body: z.union([z.record(z.string(), z.unknown()), z.string()]).optional(),
})

export type SapConcurUploadRequest = z.infer<typeof SapConcurUploadRequestSchema>

const FORBIDDEN_HOSTS = new Set([
  'localhost',
  '0.0.0.0',
  '127.0.0.1',
  '169.254.169.254',
  'metadata.google.internal',
  'metadata',
  '[::1]',
  '[::]',
  '[::ffff:127.0.0.1]',
  '[fd00:ec2::254]',
])

function isPrivateIPv4(host: string): boolean {
  const match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!match) return false
  const octets = match.slice(1, 5).map(Number) as [number, number, number, number]
  if (octets.some((o) => o < 0 || o > 255)) return false
  const [a, b] = octets
  if (a === 10) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 127) return true
  if (a === 169 && b === 254) return true
  if (a === 0) return true
  return false
}

function isPrivateOrLoopbackIPv6(host: string): boolean {
  const stripped = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host
  const lower = stripped.toLowerCase()
  if (lower === '::' || lower === '::1') return true
  if (/^fc[0-9a-f]{2}:/.test(lower) || /^fd[0-9a-f]{2}:/.test(lower)) return true
  if (lower.startsWith('fe80:')) return true
  return false
}

/** Validate a URL is https and not pointing to a private/loopback host. */
export function assertSafeExternalUrl(rawUrl: string, label: string): URL {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new Error(`${label} must be a valid URL`)
  }
  if (parsed.protocol !== 'https:') {
    throw new Error(`${label} must use https://`)
  }
  const host = parsed.hostname.toLowerCase()
  if (FORBIDDEN_HOSTS.has(host) || FORBIDDEN_HOSTS.has(`[${host}]`)) {
    throw new Error(`${label} host is not allowed`)
  }
  if (isPrivateIPv4(host)) {
    throw new Error(`${label} host is not allowed (private/loopback range)`)
  }
  if (isPrivateOrLoopbackIPv6(host)) {
    throw new Error(`${label} host is not allowed (IPv6 private/loopback)`)
  }
  return parsed
}

interface CachedToken {
  accessToken: string
  geolocation: string
  expiresAt: number
}

const TOKEN_CACHE = new Map<string, CachedToken>()
const TOKEN_CACHE_MAX_ENTRIES = 500
const TOKEN_SAFETY_WINDOW_MS = 60_000
export const SAP_CONCUR_OUTBOUND_FETCH_TIMEOUT_MS = 30_000

function tokenCacheKey(req: SapConcurAuth): string {
  const secretHash = createHash('sha256').update(req.clientSecret).digest('hex').slice(0, 16)
  const userHash = req.username
    ? createHash('sha256').update(req.username).digest('hex').slice(0, 12)
    : ''
  return `${req.datacenter}::${req.grantType}::${req.clientId}::${secretHash}::${userHash}`
}

function rememberToken(key: string, token: CachedToken): void {
  if (TOKEN_CACHE.has(key)) TOKEN_CACHE.delete(key)
  TOKEN_CACHE.set(key, token)
  while (TOKEN_CACHE.size > TOKEN_CACHE_MAX_ENTRIES) {
    const oldestKey = TOKEN_CACHE.keys().next().value
    if (oldestKey === undefined) break
    TOKEN_CACHE.delete(oldestKey)
  }
}

function normalizeGeolocation(raw: string | undefined, fallback: string): string {
  if (!raw) return `https://${fallback}`
  const trimmed = raw.replace(/\/+$/, '')
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed
  return `https://${trimmed}`
}

/**
 * Acquire a Concur access token, sharing a cache with the proxy route.
 * Validates that the geolocation returned by Concur is a safe external URL.
 */
export async function fetchSapConcurAccessToken(
  auth: SapConcurAuth,
  requestId: string
): Promise<{ accessToken: string; geolocation: string }> {
  if (auth.grantType === 'password') {
    if (!auth.username) throw new Error('username is required for password grant')
    if (!auth.password) throw new Error('password is required for password grant')
  }

  const cacheKey = tokenCacheKey(auth)
  const cached = TOKEN_CACHE.get(cacheKey)
  if (cached && cached.expiresAt - TOKEN_SAFETY_WINDOW_MS > Date.now()) {
    return { accessToken: cached.accessToken, geolocation: cached.geolocation }
  }

  const tokenUrl = assertSafeExternalUrl(
    `https://${auth.datacenter}/oauth2/v0/token`,
    'tokenUrl'
  ).toString()

  const params = new URLSearchParams()
  params.set('client_id', auth.clientId)
  params.set('client_secret', auth.clientSecret)
  params.set('grant_type', auth.grantType)
  if (auth.grantType === 'password') {
    params.set('username', auth.username ?? '')
    params.set('password', auth.password ?? '')
    if (auth.companyUuid) params.set('credtype', 'authtoken')
  }

  const response = await secureFetchWithValidation(
    tokenUrl,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: params.toString(),
      timeout: SAP_CONCUR_OUTBOUND_FETCH_TIMEOUT_MS,
    },
    'tokenUrl'
  )

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    logger.warn(`[${requestId}] Concur token fetch failed (${response.status}): ${text}`)
    throw new Error(`Concur token request failed: HTTP ${response.status}`)
  }

  const data = (await response.json()) as {
    access_token?: string
    expires_in?: number
    geolocation?: string
  }

  if (!data.access_token) {
    throw new Error('Concur token response missing access_token')
  }

  const geolocation = normalizeGeolocation(data.geolocation, auth.datacenter)
  const geolocationUrl = assertSafeExternalUrl(geolocation, 'geolocation')
  if (!SAP_CONCUR_ALLOWED_DATACENTERS.has(geolocationUrl.hostname.toLowerCase())) {
    throw new Error(
      `Concur geolocation host is not in the allowed datacenter list: ${geolocationUrl.hostname}`
    )
  }

  const expiresInMs = (data.expires_in ?? 3600) * 1000
  rememberToken(cacheKey, {
    accessToken: data.access_token,
    geolocation,
    expiresAt: Date.now() + expiresInMs,
  })
  return { accessToken: data.access_token, geolocation }
}

/** Extract a meaningful error message from a Concur error response body. */
export function extractSapConcurError(body: unknown, status: number): string {
  if (body && typeof body === 'object') {
    const obj = body as Record<string, unknown>
    if (typeof obj.error === 'string' && obj.error.length > 0) {
      const desc = typeof obj.error_description === 'string' ? `: ${obj.error_description}` : ''
      return `${obj.error}${desc}`
    }
    if (typeof obj.message === 'string' && obj.message.length > 0) {
      return obj.message
    }
    const errors = obj.errors
    if (Array.isArray(errors) && errors.length > 0) {
      return errors
        .map((e) => {
          if (e && typeof e === 'object') {
            const eo = e as Record<string, unknown>
            const code = typeof eo.errorCode === 'string' ? `[${eo.errorCode}] ` : ''
            const msg = typeof eo.errorMessage === 'string' ? eo.errorMessage : ''
            return `${code}${msg}`.trim()
          }
          return String(e)
        })
        .filter(Boolean)
        .join('; ')
    }
  }
  if (typeof body === 'string' && body.length > 0) return body
  return `Concur request failed with HTTP ${status}`
}
