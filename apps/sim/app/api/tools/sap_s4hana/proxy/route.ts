import { createHash } from 'node:crypto'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import {
  assertSafeSapExternalUrl,
  type SapS4HanaProxyRequest,
  sapS4HanaProxyContract,
} from '@/lib/api/contracts/tools/sap'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import {
  type SecureFetchResponse,
  secureFetchWithValidation,
} from '@/lib/core/security/input-validation.server'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

export const dynamic = 'force-dynamic'

const logger = createLogger('SapS4HanaProxyAPI')

type ProxyRequest = SapS4HanaProxyRequest

interface CachedToken {
  accessToken: string
  expiresAt: number
}

const TOKEN_CACHE = new Map<string, CachedToken>()
const TOKEN_CACHE_MAX_ENTRIES = 500
const TOKEN_SAFETY_WINDOW_MS = 60_000
const OUTBOUND_FETCH_TIMEOUT_MS = 30_000

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

  const tokenUrl = assertSafeSapExternalUrl(resolveTokenUrl(req), 'tokenUrl').toString()
  const basic = Buffer.from(`${req.clientId}:${req.clientSecret}`).toString('base64')

  const response = await secureFetchWithValidation(
    tokenUrl,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: 'grant_type=client_credentials',
      timeout: OUTBOUND_FETCH_TIMEOUT_MS,
    },
    'tokenUrl'
  )

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

function joinSetCookies(response: SecureFetchResponse): string {
  return response.headers
    .getSetCookie()
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
  const response = await secureFetchWithValidation(
    url,
    {
      method: 'GET',
      headers: {
        Authorization: buildAuthHeader(req, accessToken),
        Accept: 'application/xml',
        'X-CSRF-Token': 'Fetch',
      },
      timeout: OUTBOUND_FETCH_TIMEOUT_MS,
    },
    'baseUrl'
  )

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    logger.warn(`[${requestId}] CSRF fetch failed (${response.status}): ${text}`)
    return null
  }

  const token = response.headers.get('x-csrf-token')
  const cookie = joinSetCookies(response)
  if (!token) return null
  return { token, cookie }
}

function resolveHost(req: ProxyRequest): string {
  if (req.deploymentType === 'cloud_public') {
    const constructed = `https://${req.subdomain}-api.s4hana.ondemand.com`
    return assertSafeSapExternalUrl(constructed, 'subdomain').toString().replace(/\/+$/, '')
  }
  if (!req.baseUrl) {
    throw new Error('baseUrl is required for cloud_private and on_premise deployments')
  }
  const trimmed = req.baseUrl.replace(/\/+$/, '')
  return assertSafeSapExternalUrl(trimmed, 'baseUrl').toString().replace(/\/+$/, '')
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

  const response = await secureFetchWithValidation(
    url,
    {
      method: req.method,
      headers,
      body: hasBody ? JSON.stringify(req.body) : undefined,
      timeout: OUTBOUND_FETCH_TIMEOUT_MS,
    },
    'baseUrl'
  )

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

    const parsed = await parseRequest(
      sapS4HanaProxyContract,
      request,
      {},
      {
        validationErrorResponse: (error) =>
          NextResponse.json(
            { success: false, error: getValidationErrorMessage(error, 'Validation failed') },
            { status: 400 }
          ),
      }
    )
    if (!parsed.success) return parsed.response
    const proxyReq = parsed.data.body
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
    logger.error(`[${requestId}] Unexpected SAP proxy error:`, error)
    return NextResponse.json({ success: false, error: toError(error).message }, { status: 500 })
  }
})
