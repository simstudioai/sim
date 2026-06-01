import { createHash } from 'node:crypto'
import { createLogger } from '@sim/logger'
import { z } from 'zod'
import { secureFetchWithValidation } from '@/lib/core/security/input-validation.server'

const logger = createLogger('ZoomInfoShared')

export const ZOOMINFO_API_BASE = 'https://api.zoominfo.com/gtm'
export const ZOOMINFO_TOKEN_URL = `${ZOOMINFO_API_BASE}/oauth/v1/token`
export const ZOOMINFO_OUTBOUND_FETCH_TIMEOUT_MS = 30_000

export const ZoomInfoAuthSchema = z.object({
  clientId: z.string().min(1, 'clientId is required'),
  clientSecret: z.string().min(1, 'clientSecret is required'),
})

export type ZoomInfoAuth = z.infer<typeof ZoomInfoAuthSchema>

export const ZoomInfoHttpMethod = z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])

export const ZoomInfoProxyPath = z
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

export const ZoomInfoProxyRequestSchema = ZoomInfoAuthSchema.extend({
  path: ZoomInfoProxyPath,
  method: ZoomInfoHttpMethod.default('POST'),
  query: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  body: z.unknown().optional(),
})

export type ZoomInfoProxyRequest = z.infer<typeof ZoomInfoProxyRequestSchema>

const FORBIDDEN_HOSTS = new Set([
  'localhost',
  '0.0.0.0',
  '127.0.0.1',
  '169.254.169.254',
  'metadata.google.internal',
  'metadata',
  '[::1]',
  '[::]',
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

export function assertSafeZoomInfoUrl(rawUrl: string, label: string): URL {
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
  if (FORBIDDEN_HOSTS.has(host)) {
    throw new Error(`${label} host is not allowed`)
  }
  if (isPrivateIPv4(host)) {
    throw new Error(`${label} host is not allowed (private/loopback range)`)
  }
  if (host !== 'api.zoominfo.com') {
    throw new Error(`${label} host must be api.zoominfo.com`)
  }
  return parsed
}

interface CachedToken {
  accessToken: string
  expiresAt: number
}

const TOKEN_CACHE = new Map<string, CachedToken>()
const TOKEN_CACHE_MAX_ENTRIES = 500
const TOKEN_SAFETY_WINDOW_MS = 60_000

function tokenCacheKey(auth: ZoomInfoAuth): string {
  const secretHash = createHash('sha256').update(auth.clientSecret).digest('hex').slice(0, 16)
  return `${auth.clientId}::${secretHash}`
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

export async function fetchZoomInfoAccessToken(
  auth: ZoomInfoAuth,
  requestId: string
): Promise<string> {
  const cacheKey = tokenCacheKey(auth)
  const cached = TOKEN_CACHE.get(cacheKey)
  if (cached && cached.expiresAt - TOKEN_SAFETY_WINDOW_MS > Date.now()) {
    return cached.accessToken
  }

  const tokenUrl = assertSafeZoomInfoUrl(ZOOMINFO_TOKEN_URL, 'tokenUrl').toString()
  const basic = Buffer.from(`${auth.clientId}:${auth.clientSecret}`).toString('base64')

  const params = new URLSearchParams()
  params.set('grant_type', 'client_credentials')

  const response = await secureFetchWithValidation(
    tokenUrl,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: params.toString(),
      timeout: ZOOMINFO_OUTBOUND_FETCH_TIMEOUT_MS,
    },
    'tokenUrl'
  )

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    logger.warn(`[${requestId}] ZoomInfo token fetch failed (${response.status}): ${text}`)
    throw new Error(`ZoomInfo token request failed: HTTP ${response.status}`)
  }

  const data = (await response.json()) as {
    access_token?: string
    expires_in?: number
  }

  if (!data.access_token) {
    throw new Error('ZoomInfo token response missing access_token')
  }

  const expiresInMs = (data.expires_in ?? 3300) * 1000
  rememberToken(cacheKey, {
    accessToken: data.access_token,
    expiresAt: Date.now() + expiresInMs,
  })
  return data.access_token
}

export function extractZoomInfoError(body: unknown, status: number): string {
  if (body && typeof body === 'object') {
    const obj = body as Record<string, unknown>
    if (obj.error && typeof obj.error === 'object') {
      const eo = obj.error as Record<string, unknown>
      const message = typeof eo.message === 'string' ? eo.message : ''
      const code = typeof eo.code === 'string' ? eo.code : ''
      if (message) return code ? `[${code}] ${message}` : message
    }
    if (typeof obj.error === 'string' && obj.error.length > 0) {
      const desc = typeof obj.error_description === 'string' ? `: ${obj.error_description}` : ''
      return `${obj.error}${desc}`
    }
    if (typeof obj.message === 'string' && obj.message.length > 0) {
      return obj.message
    }
    if (Array.isArray(obj.errors) && obj.errors.length > 0) {
      return obj.errors
        .map((e) => {
          if (e && typeof e === 'object') {
            const eo = e as Record<string, unknown>
            const title = typeof eo.title === 'string' ? eo.title : ''
            const detail = typeof eo.detail === 'string' ? `: ${eo.detail}` : ''
            return `${title}${detail}`.trim()
          }
          return String(e)
        })
        .filter(Boolean)
        .join('; ')
    }
  }
  if (typeof body === 'string' && body.length > 0) return body
  return `ZoomInfo request failed with HTTP ${status}`
}
