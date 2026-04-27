import { createHash } from 'node:crypto'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

export const dynamic = 'force-dynamic'

const logger = createLogger('SapS4HanaProxyAPI')

const HttpMethod = z.enum(['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'MERGE'])
const DeploymentType = z.enum(['cloud_public', 'cloud_private', 'on_premise'])
const AuthType = z.enum(['oauth_client_credentials', 'basic'])

const ServiceName = z
  .string()
  .min(1, 'service is required')
  .regex(
    /^[A-Z][A-Z0-9_]*(;v=\d+)?$/,
    'service must be an uppercase OData service name optionally suffixed with ";v=NNNN" (e.g., API_BUSINESS_PARTNER, API_OUTBOUND_DELIVERY_SRV;v=0002)'
  )

const ServicePath = z
  .string()
  .min(1, 'path is required')
  .refine(
    (p) =>
      !p.split(/[/\\]/).some((seg) => seg === '..' || seg === '.') &&
      !p.includes('?') &&
      !p.includes('#') &&
      !/%(?:2[eEfF]|5[cC]|3[fF]|23)/.test(p),
    {
      message:
        'path must not contain ".." or "." segments, "?", "#", or percent-encoded path/query/fragment characters',
    }
  )

const Subdomain = z
  .string()
  .regex(
    /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i,
    'subdomain must contain only letters, digits, and hyphens (1-63 chars)'
  )

const ProxyRequestSchema = z
  .object({
    deploymentType: DeploymentType.default('cloud_public'),
    authType: AuthType.default('oauth_client_credentials'),
    subdomain: Subdomain.optional(),
    region: z
      .string()
      .regex(/^[a-z]{2,4}\d{1,3}$/i, 'region must be an SAP BTP region code (e.g., eu10, us30)')
      .optional(),
    baseUrl: z.string().optional(),
    tokenUrl: z.string().optional(),
    clientId: z.string().optional(),
    clientSecret: z.string().optional(),
    username: z.string().optional(),
    password: z.string().optional(),
    service: ServiceName,
    path: ServicePath,
    method: HttpMethod.default('GET'),
    query: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
    body: z.unknown().optional(),
    ifMatch: z.string().optional(),
  })
  .superRefine((req, ctx) => {
    if (req.deploymentType === 'cloud_public') {
      if (!req.subdomain) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['subdomain'],
          message: 'subdomain is required for cloud_public deployment',
        })
      }
      if (!req.region) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['region'],
          message: 'region is required for cloud_public deployment',
        })
      }
      if (req.authType !== 'oauth_client_credentials') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['authType'],
          message: 'cloud_public deployment only supports oauth_client_credentials',
        })
      }
      if (!req.clientId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['clientId'],
          message: 'clientId is required',
        })
      }
      if (!req.clientSecret) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['clientSecret'],
          message: 'clientSecret is required',
        })
      }
    } else {
      if (!req.baseUrl) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['baseUrl'],
          message: 'baseUrl is required for cloud_private and on_premise deployments',
        })
      } else {
        const baseUrlCheck = checkExternalUrlSafety(req.baseUrl, 'baseUrl')
        if (!baseUrlCheck.ok) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['baseUrl'],
            message: baseUrlCheck.message,
          })
        }
      }
      if (req.authType === 'oauth_client_credentials') {
        if (!req.tokenUrl) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['tokenUrl'],
            message: 'tokenUrl is required for OAuth on cloud_private/on_premise',
          })
        } else {
          const tokenUrlCheck = checkExternalUrlSafety(req.tokenUrl, 'tokenUrl')
          if (!tokenUrlCheck.ok) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['tokenUrl'],
              message: tokenUrlCheck.message,
            })
          }
        }
        if (!req.clientId) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['clientId'],
            message: 'clientId is required for OAuth',
          })
        }
        if (!req.clientSecret) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['clientSecret'],
            message: 'clientSecret is required for OAuth',
          })
        }
      } else {
        if (!req.username) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['username'],
            message: 'username is required for Basic auth',
          })
        }
        if (!req.password) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['password'],
            message: 'password is required for Basic auth',
          })
        }
      }
    }
  })

type ProxyRequest = z.infer<typeof ProxyRequestSchema>

interface CachedToken {
  accessToken: string
  expiresAt: number
}

const TOKEN_CACHE = new Map<string, CachedToken>()
const TOKEN_CACHE_MAX_ENTRIES = 500
const TOKEN_SAFETY_WINDOW_MS = 60_000
const OUTBOUND_FETCH_TIMEOUT_MS = 30_000

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

function extractIPv4MappedHost(host: string): string | null {
  const stripped = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host
  const lower = stripped.toLowerCase()
  for (const prefix of ['::ffff:', '::']) {
    if (lower.startsWith(prefix)) {
      const candidate = lower.slice(prefix.length)
      if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(candidate)) return candidate
    }
  }
  const hexMatch = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
  if (hexMatch) {
    const high = Number.parseInt(hexMatch[1] as string, 16)
    const low = Number.parseInt(hexMatch[2] as string, 16)
    if (high >= 0 && high <= 0xffff && low >= 0 && low <= 0xffff) {
      const a = (high >> 8) & 0xff
      const b = high & 0xff
      const c = (low >> 8) & 0xff
      const d = low & 0xff
      return `${a}.${b}.${c}.${d}`
    }
  }
  return null
}

function isPrivateOrLoopbackIPv6(host: string): boolean {
  const stripped = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host
  const lower = stripped.toLowerCase()
  if (lower === '::' || lower === '::1') return true
  if (/^fc[0-9a-f]{2}:/.test(lower) || /^fd[0-9a-f]{2}:/.test(lower)) return true
  if (lower.startsWith('fe80:')) return true
  return false
}

function checkExternalUrlSafety(
  rawUrl: string,
  label: string
): { ok: true; url: URL } | { ok: false; message: string } {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return { ok: false, message: `${label} must be a valid URL` }
  }
  if (parsed.protocol !== 'https:') {
    return { ok: false, message: `${label} must use https://` }
  }
  const host = parsed.hostname.toLowerCase()
  if (FORBIDDEN_HOSTS.has(host) || FORBIDDEN_HOSTS.has(`[${host}]`)) {
    return { ok: false, message: `${label} host is not allowed` }
  }
  if (isPrivateIPv4(host)) {
    return { ok: false, message: `${label} host is not allowed (private/loopback range)` }
  }
  const mapped = extractIPv4MappedHost(host)
  if (mapped && isPrivateIPv4(mapped)) {
    return { ok: false, message: `${label} host is not allowed (IPv4-mapped private range)` }
  }
  if (isPrivateOrLoopbackIPv6(host)) {
    return { ok: false, message: `${label} host is not allowed (IPv6 private/loopback)` }
  }
  return { ok: true, url: parsed }
}

function assertSafeExternalUrl(rawUrl: string, label: string): URL {
  const result = checkExternalUrlSafety(rawUrl, label)
  if (!result.ok) throw new Error(result.message)
  return result.url
}

function resolveTokenUrl(req: ProxyRequest): string {
  if (req.deploymentType === 'cloud_public') {
    return `https://${req.subdomain}.authentication.${req.region}.hana.ondemand.com/oauth/token`
  }
  if (!req.tokenUrl) {
    throw new Error('tokenUrl is required for OAuth on cloud_private/on_premise')
  }
  return req.tokenUrl
}

function tokenCacheKey(req: ProxyRequest): string {
  const secretHash = req.clientSecret
    ? createHash('sha256').update(req.clientSecret).digest('hex').slice(0, 16)
    : ''
  return `${resolveTokenUrl(req)}::${req.clientId ?? ''}::${secretHash}`
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

async function fetchAccessToken(req: ProxyRequest, requestId: string): Promise<string> {
  const cacheKey = tokenCacheKey(req)
  const cached = TOKEN_CACHE.get(cacheKey)
  if (cached && cached.expiresAt - TOKEN_SAFETY_WINDOW_MS > Date.now()) {
    return cached.accessToken
  }

  const tokenUrl = assertSafeExternalUrl(resolveTokenUrl(req), 'tokenUrl').toString()
  const basic = Buffer.from(`${req.clientId}:${req.clientSecret}`).toString('base64')

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(OUTBOUND_FETCH_TIMEOUT_MS),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    logger.warn(`[${requestId}] Token fetch failed (${response.status}): ${text}`)
    throw new Error(`SAP token request failed: HTTP ${response.status}`)
  }

  const data = (await response.json()) as {
    access_token?: string
    expires_in?: number
  }

  if (!data.access_token) {
    throw new Error('SAP token response missing access_token')
  }

  const expiresInMs = (data.expires_in ?? 3600) * 1000
  rememberToken(cacheKey, {
    accessToken: data.access_token,
    expiresAt: Date.now() + expiresInMs,
  })
  return data.access_token
}

interface CsrfBundle {
  token: string
  cookie: string
}

function joinSetCookies(headers: Headers): string {
  const cookies =
    typeof (headers as { getSetCookie?: () => string[] }).getSetCookie === 'function'
      ? (headers as { getSetCookie: () => string[] }).getSetCookie()
      : (headers.get('set-cookie') ?? '').split(/,\s*(?=[^=,;\s]+=)/)
  return cookies
    .map((c) => c.split(';')[0]?.trim())
    .filter(Boolean)
    .join('; ')
}

function buildAuthHeader(req: ProxyRequest, accessToken: string | null): string {
  if (req.authType === 'basic') {
    const basic = Buffer.from(`${req.username}:${req.password}`).toString('base64')
    return `Basic ${basic}`
  }
  return `Bearer ${accessToken}`
}

async function fetchCsrf(
  req: ProxyRequest,
  accessToken: string | null,
  requestId: string
): Promise<CsrfBundle | null> {
  const url = buildOdataUrl(req, '/$metadata')
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: buildAuthHeader(req, accessToken),
      Accept: 'application/xml',
      'X-CSRF-Token': 'Fetch',
    },
    signal: AbortSignal.timeout(OUTBOUND_FETCH_TIMEOUT_MS),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    logger.warn(`[${requestId}] CSRF fetch failed (${response.status}): ${text}`)
    return null
  }

  const token = response.headers.get('x-csrf-token')
  const cookie = joinSetCookies(response.headers)
  if (!token) return null
  return { token, cookie }
}

function resolveHost(req: ProxyRequest): string {
  if (req.deploymentType === 'cloud_public') {
    const constructed = `https://${req.subdomain}-api.s4hana.ondemand.com`
    return assertSafeExternalUrl(constructed, 'subdomain').toString().replace(/\/+$/, '')
  }
  if (!req.baseUrl) {
    throw new Error('baseUrl is required for cloud_private and on_premise deployments')
  }
  const trimmed = req.baseUrl.replace(/\/+$/, '')
  return assertSafeExternalUrl(trimmed, 'baseUrl').toString().replace(/\/+$/, '')
}

function buildOdataUrl(req: ProxyRequest, pathOverride?: string): string {
  const host = resolveHost(req)
  const servicePath = `/sap/opu/odata/sap/${req.service}`
  const subPath = pathOverride ?? req.path
  const normalized = subPath.startsWith('/') ? subPath : `/${subPath}`
  const base = `${host}${servicePath}${normalized}`

  if (pathOverride !== undefined) {
    return base
  }
  if (!req.query || Object.keys(req.query).length === 0) {
    return base
  }
  const encode = (s: string) => encodeURIComponent(s).replace(/%24/g, '$')
  const parts: string[] = []
  for (const [key, value] of Object.entries(req.query)) {
    if (value === undefined || value === null) continue
    parts.push(`${encode(key)}=${encode(String(value))}`)
  }
  const queryString = parts.join('&')
  if (!queryString) return base
  return base.includes('?') ? `${base}&${queryString}` : `${base}?${queryString}`
}

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE', 'MERGE'])

interface OdataInvocation {
  status: number
  body: unknown
  raw: string
  csrfHeader: string
}

async function callOdata(
  req: ProxyRequest,
  accessToken: string | null,
  csrf: CsrfBundle | null
): Promise<OdataInvocation> {
  const url = buildOdataUrl(req)
  const headers: Record<string, string> = {
    Authorization: buildAuthHeader(req, accessToken),
    Accept: 'application/json',
  }

  const isWrite = WRITE_METHODS.has(req.method)
  const hasBody = req.body !== undefined && req.body !== null
  if (hasBody) headers['Content-Type'] = 'application/json'
  if (req.ifMatch) headers['If-Match'] = req.ifMatch

  if (isWrite && csrf) {
    headers['X-CSRF-Token'] = csrf.token
    if (csrf.cookie) headers.Cookie = csrf.cookie
  }

  const response = await fetch(url, {
    method: req.method,
    headers,
    body: hasBody ? JSON.stringify(req.body) : undefined,
    signal: AbortSignal.timeout(OUTBOUND_FETCH_TIMEOUT_MS),
  })

  const raw = await response.text()
  let parsed: unknown = null
  if (raw.length > 0) {
    try {
      parsed = JSON.parse(raw)
    } catch {
      parsed = raw
    }
  }

  const csrfHeader = response.headers.get('x-csrf-token')?.toLowerCase() ?? ''
  return { status: response.status, body: parsed, raw, csrfHeader }
}

function isCsrfRequired(invocation: OdataInvocation): boolean {
  if (invocation.status !== 403) return false
  if (invocation.csrfHeader === 'required') return true
  if (typeof invocation.body !== 'object' || invocation.body === null) return false
  const errorObj = (invocation.body as { error?: { message?: { value?: string } | string } }).error
  const messageField = errorObj?.message
  const message = typeof messageField === 'string' ? messageField : (messageField?.value ?? '')
  return message.toLowerCase().includes('csrf')
}

function extractOdataError(body: unknown, status: number): string {
  if (body && typeof body === 'object') {
    const err = (
      body as {
        error?: {
          message?: { value?: string } | string
          code?: string
          innererror?: {
            errordetails?: Array<{ code?: string; message?: string; severity?: string }>
          }
        }
      }
    ).error
    if (err) {
      const messageField = err.message
      const base =
        typeof messageField === 'string' ? messageField : (messageField?.value ?? err.code ?? '')
      const prefix = err.code ? `[${err.code}] ` : ''
      const details = err.innererror?.errordetails
        ?.filter((d) => d.message && (!d.severity || d.severity.toLowerCase() !== 'info'))
        .map((d) => {
          const tag = d.code ? `[${d.code}] ` : ''
          return `${tag}${d.message}`
        })
        .filter((m): m is string => Boolean(m))
      if (details && details.length > 0) {
        const extras = details.filter((d) => !d.endsWith(base))
        return extras.length > 0 ? `${prefix}${base} (${extras.join('; ')})` : `${prefix}${base}`
      }
      if (base) return `${prefix}${base}`
    }
  }
  if (typeof body === 'string' && body.length > 0) return body
  return `SAP request failed with HTTP ${status}`
}

function unwrapOdata(body: unknown): unknown {
  if (!body || typeof body !== 'object') return body
  const root = (body as { d?: unknown }).d
  if (root === undefined) return body
  if (root && typeof root === 'object' && 'results' in (root as Record<string, unknown>)) {
    const rootObj = root as { results: unknown; __count?: string; __next?: string }
    if (rootObj.__count !== undefined || rootObj.__next !== undefined) {
      return {
        results: rootObj.results,
        ...(rootObj.__count !== undefined && { __count: rootObj.__count }),
        ...(rootObj.__next !== undefined && { __next: rootObj.__next }),
      }
    }
    return rootObj.results
  }
  return root
}

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success) {
      logger.warn(`[${requestId}] Unauthorized SAP proxy request: ${authResult.error}`)
      return NextResponse.json(
        { success: false, error: authResult.error || 'Authentication required' },
        { status: 401 }
      )
    }

    const json = await request.json()
    const proxyReq = ProxyRequestSchema.parse(json)
    const isWrite = WRITE_METHODS.has(proxyReq.method)

    const accessToken =
      proxyReq.authType === 'oauth_client_credentials'
        ? await fetchAccessToken(proxyReq, requestId)
        : null
    const csrf = isWrite ? await fetchCsrf(proxyReq, accessToken, requestId) : null

    let invocation = await callOdata(proxyReq, accessToken, csrf)

    if (isWrite && isCsrfRequired(invocation)) {
      logger.info(`[${requestId}] CSRF token rejected, refetching and retrying`)
      const refreshed = await fetchCsrf(proxyReq, accessToken, requestId)
      if (refreshed) {
        invocation = await callOdata(proxyReq, accessToken, refreshed)
      }
    }

    if (invocation.status >= 200 && invocation.status < 300) {
      const data = invocation.status === 204 ? null : unwrapOdata(invocation.body)
      return NextResponse.json({ success: true, output: { status: invocation.status, data } })
    }

    const message = extractOdataError(invocation.body, invocation.status)
    logger.warn(
      `[${requestId}] SAP API error (${invocation.status}) ${proxyReq.service}${proxyReq.path}: ${message}`
    )
    return NextResponse.json(
      { success: false, error: message, status: invocation.status },
      { status: invocation.status }
    )
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.warn(`[${requestId}] Validation error:`, error.errors)
      return NextResponse.json(
        { success: false, error: error.errors[0]?.message || 'Validation failed' },
        { status: 400 }
      )
    }
    logger.error(`[${requestId}] Unexpected SAP proxy error:`, error)
    return NextResponse.json({ success: false, error: toError(error).message }, { status: 500 })
  }
})
