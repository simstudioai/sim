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

const ProxyRequestSchema = z
  .object({
    deploymentType: DeploymentType.default('cloud_public'),
    authType: AuthType.default('oauth_client_credentials'),
    subdomain: z.string().optional(),
    region: z.string().optional(),
    baseUrl: z.string().optional(),
    tokenUrl: z.string().optional(),
    clientId: z.string().optional(),
    clientSecret: z.string().optional(),
    username: z.string().optional(),
    password: z.string().optional(),
    service: z.string().min(1, 'service is required'),
    path: z.string().min(1, 'path is required'),
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
      }
      if (req.authType === 'oauth_client_credentials') {
        if (!req.tokenUrl) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['tokenUrl'],
            message: 'tokenUrl is required for OAuth on cloud_private/on_premise',
          })
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
const TOKEN_SAFETY_WINDOW_MS = 60_000

function resolveTokenUrl(req: ProxyRequest): string {
  if (req.tokenUrl) return req.tokenUrl
  return `https://${req.subdomain}.authentication.${req.region}.hana.ondemand.com/oauth/token`
}

function tokenCacheKey(req: ProxyRequest): string {
  return `${resolveTokenUrl(req)}::${req.clientId ?? ''}`
}

async function fetchAccessToken(req: ProxyRequest, requestId: string): Promise<string> {
  const cacheKey = tokenCacheKey(req)
  const cached = TOKEN_CACHE.get(cacheKey)
  if (cached && cached.expiresAt - TOKEN_SAFETY_WINDOW_MS > Date.now()) {
    return cached.accessToken
  }

  const tokenUrl = resolveTokenUrl(req)
  const basic = Buffer.from(`${req.clientId}:${req.clientSecret}`).toString('base64')

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: 'grant_type=client_credentials',
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
  TOKEN_CACHE.set(cacheKey, {
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
      : (headers.get('set-cookie') ?? '').split(/,(?=[^ ;]+=)/)
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
  if (req.baseUrl) {
    return req.baseUrl.replace(/\/+$/, '')
  }
  return `https://${req.subdomain}-api.s4hana.ondemand.com`
}

function buildOdataUrl(req: ProxyRequest, pathOverride?: string): string {
  const host = resolveHost(req)
  const servicePath = `/sap/opu/odata/sap/${req.service}`
  const subPath = pathOverride ?? req.path
  const normalized = subPath.startsWith('/') ? subPath : `/${subPath}`
  const base = `${host}${servicePath}${normalized}`

  if (!req.query || Object.keys(req.query).length === 0) {
    return base
  }
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(req.query)) {
    if (value === undefined || value === null) continue
    search.append(key, String(value))
  }
  const queryString = search.toString()
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
