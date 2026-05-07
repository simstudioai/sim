import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { getValidationErrorMessage, isZodError } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { secureFetchWithValidation } from '@/lib/core/security/input-validation.server'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  assertSafeExternalUrl,
  extractSapConcurError,
  fetchSapConcurAccessToken,
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

interface Invocation {
  status: number
  body: unknown
  raw: string
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
    Accept: 'application/json',
  }
  if (hasBody) headers['Content-Type'] = req.contentType ?? 'application/json'
  if (req.companyUuid) headers['concur-correlationid'] = req.companyUuid

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
    },
    'apiUrl'
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
  return { status: response.status, body: parsed, raw }
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
      return NextResponse.json({ success: true, output: { status: invocation.status, data } })
    }

    const message = extractSapConcurError(invocation.body, invocation.status)
    logger.warn(
      `[${requestId}] Concur API error (${invocation.status}) ${proxyReq.path}: ${message}`
    )
    return NextResponse.json(
      { success: false, error: message, status: invocation.status },
      { status: invocation.status }
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
    return NextResponse.json({ success: false, error: toError(error).message }, { status: 500 })
  }
})
