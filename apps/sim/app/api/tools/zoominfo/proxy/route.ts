import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { getValidationErrorMessage, isZodError } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { secureFetchWithValidation } from '@/lib/core/security/input-validation.server'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  assertSafeZoomInfoUrl,
  extractZoomInfoError,
  fetchZoomInfoAccessToken,
  ZOOMINFO_API_BASE,
  ZOOMINFO_OUTBOUND_FETCH_TIMEOUT_MS,
  type ZoomInfoProxyRequest,
  ZoomInfoProxyRequestSchema,
} from '@/app/api/tools/zoominfo/shared'

export const dynamic = 'force-dynamic'

const logger = createLogger('ZoomInfoProxyAPI')

function buildApiUrl(req: ZoomInfoProxyRequest): string {
  const subPath = req.path.startsWith('/') ? req.path : `/${req.path}`
  const url = `${ZOOMINFO_API_BASE}${subPath}`

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
}

async function callZoomInfo(req: ZoomInfoProxyRequest, accessToken: string): Promise<Invocation> {
  const url = assertSafeZoomInfoUrl(buildApiUrl(req), 'apiUrl').toString()
  const hasBody = req.body !== undefined && req.body !== null
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
  }
  if (hasBody) headers['Content-Type'] = 'application/json'

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
      timeout: ZOOMINFO_OUTBOUND_FETCH_TIMEOUT_MS,
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
  return { status: response.status, body: parsed }
}

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success) {
      logger.warn(`[${requestId}] Unauthorized ZoomInfo proxy request: ${authResult.error}`)
      return NextResponse.json(
        { success: false, error: authResult.error || 'Authentication required' },
        { status: 401 }
      )
    }

    // boundary-raw-json: internal proxy envelope validated by ZoomInfoProxyRequestSchema below; not a public boundary
    const json = await request.json()
    const proxyReq = ZoomInfoProxyRequestSchema.parse(json)

    const accessToken = await fetchZoomInfoAccessToken(proxyReq, requestId)
    const invocation = await callZoomInfo(proxyReq, accessToken)

    if (invocation.status >= 200 && invocation.status < 300) {
      const data = invocation.status === 204 ? null : invocation.body
      return NextResponse.json({ success: true, output: { status: invocation.status, data } })
    }

    const message = extractZoomInfoError(invocation.body, invocation.status)
    logger.warn(
      `[${requestId}] ZoomInfo API error (${invocation.status}) ${proxyReq.path}: ${message}`
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
    logger.error(`[${requestId}] Unexpected ZoomInfo proxy error:`, error)
    return NextResponse.json({ success: false, error: toError(error).message }, { status: 500 })
  }
})
