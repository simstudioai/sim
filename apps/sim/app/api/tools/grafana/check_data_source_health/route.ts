import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { truncate } from '@sim/utils/string'
import { type NextRequest, NextResponse } from 'next/server'
import { grafanaCheckDataSourceHealthContract } from '@/lib/api/contracts/tools/grafana'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import {
  MAX_JSON_API_RESPONSE_BYTES,
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

export const dynamic = 'force-dynamic'

const logger = createLogger('GrafanaCheckDataSourceHealthAPI')

const OUTBOUND_FETCH_TIMEOUT_MS = 30_000
const MAX_ERROR_MESSAGE_LENGTH = 2000

/**
 * Runs a data source health check.
 *
 * Grafana answers an *unhealthy* data source with HTTP 400 carrying the same
 * `{status, message}` payload it uses for a healthy one, so the diagnostic the
 * caller actually wants only exists on the failure status. A plain tool would
 * have that converted into an opaque tool error, making the check able to report
 * health and never ill-health — hence this route, which reads the payload off
 * either status and reports it as a successful check.
 */
export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      logger.warn(`[${requestId}] Unauthorized Grafana health check: ${authResult.error}`)
      return NextResponse.json(
        { success: false, error: authResult.error || 'Authentication required' },
        { status: 401 }
      )
    }

    const parsed = await parseRequest(
      grafanaCheckDataSourceHealthContract,
      request,
      {},
      {
        validationErrorResponse: (error) => {
          logger.warn(`[${requestId}] Invalid request data`, { errors: error.issues })
          return NextResponse.json(
            {
              success: false,
              error: getValidationErrorMessage(error, 'Invalid request data'),
              details: error.issues,
            },
            { status: 400 }
          )
        },
      }
    )
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    const baseUrl = params.baseUrl.replace(/\/$/, '')
    const healthUrl = `${baseUrl}/api/datasources/uid/${encodeURIComponent(
      params.dataSourceUid.trim()
    )}/health`

    const urlValidation = await validateUrlWithDNS(healthUrl, 'baseUrl')
    if (!urlValidation.isValid || !urlValidation.resolvedIP) {
      return NextResponse.json({
        success: false,
        error: `Invalid Grafana baseUrl: ${urlValidation.error}`,
      })
    }

    const headers: Record<string, string> = {
      Accept: 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }
    if (params.organizationId) {
      headers['X-Grafana-Org-Id'] = params.organizationId
    }

    const response = await secureFetchWithPinnedIP(healthUrl, urlValidation.resolvedIP, {
      method: 'GET',
      headers,
      maxResponseBytes: MAX_JSON_API_RESPONSE_BYTES,
      timeout: OUTBOUND_FETCH_TIMEOUT_MS,
      stripAuthOnRedirect: true,
    })

    const raw = await response.text()
    let body: unknown = null
    if (raw.length > 0) {
      try {
        body = JSON.parse(raw)
      } catch {
        body = null
      }
    }

    const payload =
      body && typeof body === 'object'
        ? (body as { status?: unknown; message?: unknown; details?: unknown })
        : null

    /**
     * A `status` in the body means Grafana ran the check and reported a verdict,
     * whatever the HTTP status. Anything else — an auth failure, a missing data
     * source, a plugin with no health endpoint — is a genuine request failure.
     */
    if (payload && typeof payload.status === 'string') {
      return NextResponse.json({
        success: true,
        output: {
          status: payload.status,
          message: typeof payload.message === 'string' ? payload.message : null,
          ...(payload.details === undefined ? {} : { details: payload.details }),
        },
      })
    }

    logger.warn(`[${requestId}] Grafana health check did not report a status (${response.status})`)
    return NextResponse.json({
      success: false,
      error: `Failed to check data source health: HTTP ${response.status} ${truncate(
        raw,
        MAX_ERROR_MESSAGE_LENGTH
      )}`,
    })
  } catch (error) {
    logger.error(`[${requestId}] Error checking Grafana data source health:`, error)
    return NextResponse.json({ success: false, error: getErrorMessage(error) })
  }
})
