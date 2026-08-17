import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { getValidationErrorMessage, isZodError } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import {
  MAX_JSON_API_RESPONSE_BYTES,
  secureFetchWithValidation,
} from '@/lib/core/security/input-validation.server'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  assertSafeExternalUrl,
  describeSapConcurFetchError,
  extractSapConcurError,
  fetchSapConcurAccessToken,
  forwardedSapConcurHeaders,
  SAP_CONCUR_OUTBOUND_FETCH_TIMEOUT_MS,
  type SapConcurProxyRequest,
  SapConcurProxyRequestSchema,
} from '@/app/api/tools/sap_concur/shared'

export const dynamic = 'force-dynamic'

const logger = createLogger('SapConcurProxyAPI')

type ProxyRequest = SapConcurProxyRequest

function buildApiUrl(geolocation: string, req: ProxyRequest): string {
  const base = geolocation.replace(/\/+$/, '')
  const subPath = req.path.startsWith('/') ? req.path : `/${req.path}`
  const url = `${base}${subPath}`

  if (!req.query || Object.keys(req.query).length === 0) {
    return url
  }
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(req.query)) {
    if (value === undefined || value === null) continue
    search.append(key, String(value))
  }
  const queryString = search.toString()
  if (!queryString) return url
  return url.includes('?') ? `${url}&${queryString}` : `${url}?${queryString}`
}

/**
 * Map a non-2xx Concur status that cannot be re-emitted as an error status onto 502.
 *
 * With `maxRedirects: 0` a 3xx carrying a `Location` never reaches here — it rejects with
 * "Too many redirects" and is handled in the outer catch. What does reach here is a 3xx
 * *without* a `Location`, and a 304, which is excluded from the redirect handling
 * upstream. Neither is a usable error status to return to the caller.
 */
function clampErrorStatus(status: number): number {
  return status >= 400 ? status : 502
}

interface Invocation {
  status: number
  body: unknown
  raw: string
  /** Concur response headers forwarded onto this route's response. */
  headers: Record<string, string>
}

/**
 * Invoke a Concur API endpoint with the bearer token.
 *
 * `concur-correlationid` is a support/tracing header expected to be a fresh RFC 4122
 * UUID per request; it does not scope a request to a company. Redirects are refused so
 * the Authorization header is never forwarded to another origin.
 *
 * `stripAuthOnRedirect` is unreachable while `maxRedirects` is 0 — no redirect is ever
 * followed for it to act on. It is kept as defense-in-depth so raising `maxRedirects`
 * later cannot silently start forwarding the bearer token; do not remove it as dead code.
 */
/**
 * Read a Concur response body, keeping the upstream status meaningful.
 *
 * On a success status the body is the result, so a stream failure is a real
 * error and must propagate. On an error status the body only supplies the
 * message, and throwing would turn Concur's 4xx into a Sim 500 — the status is
 * preserved instead and the message falls back to the generic HTTP-status form.
 */
export async function readConcurProxyBody(response: {
  status: number
  text: () => Promise<string>
}): Promise<string> {
  const read = response.text()
  if (response.status >= 200 && response.status < 300) return read
  return read.catch(() => '')
}

async function callConcur(
  req: ProxyRequest,
  accessToken: string,
  geolocation: string
): Promise<Invocation> {
  const url = assertSafeExternalUrl(buildApiUrl(geolocation, req), 'apiUrl').toString()
  const hasBody = req.body !== undefined && req.body !== null
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    Accept: req.accept ?? 'application/json',
  }
  if (hasBody) headers['Content-Type'] = req.contentType ?? 'application/json'
  headers['concur-correlationid'] = generateId()

  const response = await secureFetchWithValidation(
    url,
    {
      method: req.method,
      headers,
      body: hasBody
        ? typeof req.body === 'string'
          ? req.body
          : JSON.stringify(req.body)
        : undefined,
      timeout: SAP_CONCUR_OUTBOUND_FETCH_TIMEOUT_MS,
      maxRedirects: 0,
      stripAuthOnRedirect: true,
      maxResponseBytes: MAX_JSON_API_RESPONSE_BYTES,
    },
    'apiUrl'
  )

  const raw = await readConcurProxyBody(response)
  let parsed: unknown = null
  if (raw.length > 0) {
    try {
      parsed = JSON.parse(raw)
    } catch {
      parsed = raw
    }
  }
  return {
    status: response.status,
    body: parsed,
    raw,
    headers: forwardedSapConcurHeaders(response.headers),
  }
}

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success) {
      logger.warn(`[${requestId}] Unauthorized Concur proxy request: ${authResult.error}`)
      return NextResponse.json(
        { success: false, error: authResult.error || 'Authentication required' },
        { status: 401 }
      )
    }

    // boundary-raw-json: internal proxy envelope validated by SapConcurProxyRequestSchema below; not a public boundary
    const json = await request.json()
    const proxyReq = SapConcurProxyRequestSchema.parse(json)

    const { accessToken, geolocation } = await fetchSapConcurAccessToken(proxyReq, requestId)
    const invocation = await callConcur(proxyReq, accessToken, geolocation)

    if (invocation.status >= 200 && invocation.status < 300) {
      const data = invocation.status === 204 ? null : invocation.body
      return NextResponse.json(
        { success: true, output: { status: invocation.status, data } },
        { headers: invocation.headers }
      )
    }

    const message = extractSapConcurError(invocation.body, invocation.status)
    logger.warn(
      `[${requestId}] Concur API error (${invocation.status}) ${proxyReq.path}: ${message}`
    )
    return NextResponse.json(
      { success: false, error: message, status: invocation.status },
      { status: clampErrorStatus(invocation.status), headers: invocation.headers }
    )
  } catch (error) {
    if (isZodError(error)) {
      logger.warn(`[${requestId}] Validation error:`, error.issues)
      return NextResponse.json(
        { success: false, error: getValidationErrorMessage(error, 'Validation failed') },
        { status: 400 }
      )
    }
    logger.error(`[${requestId}] Unexpected Concur proxy error:`, error)
    return NextResponse.json(
      { success: false, error: describeSapConcurFetchError(error) },
      { status: 500 }
    )
  }
})
