import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { jupyterProxyContract } from '@/lib/api/contracts/tools/jupyter'
import { parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import {
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { buildJupyterAuthHeaders, normalizeJupyterServerUrl } from '@/tools/jupyter/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('JupyterProxyAPI')

/**
 * Proxies Contents/Kernels/Kernelspecs/Sessions API calls to a self-hosted
 * Jupyter server. Self-hosted servers have no fixed public host, so every
 * request is server-side (DNS-pinned, http(s) allowed, redirects disabled)
 * rather than going through the generic external tool executor, which blocks
 * plain-HTTP and private-IP hosts by default. Mirrors the upstream status
 * and body verbatim so callers can treat this exactly like a direct fetch.
 */
export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      logger.warn(`[${requestId}] Unauthorized Jupyter proxy attempt: ${authResult.error}`)
      return NextResponse.json(
        { success: false, error: authResult.error || 'Authentication required' },
        { status: 401 }
      )
    }

    const parsed = await parseRequest(jupyterProxyContract, request, {})
    if (!parsed.success) return parsed.response
    const data = parsed.data.body

    const base = normalizeJupyterServerUrl(data.serverUrl)
    const url = `${base}/api/${data.path}`

    const urlValidation = await validateUrlWithDNS(url, 'serverUrl', { allowHttp: true })
    if (!urlValidation.isValid || !urlValidation.resolvedIP) {
      return NextResponse.json(
        { success: false, error: `Invalid Jupyter serverUrl: ${urlValidation.error}` },
        { status: 400 }
      )
    }

    const hasBody = data.body !== undefined && data.body !== null

    const upstream = await secureFetchWithPinnedIP(url, urlValidation.resolvedIP, {
      method: data.method,
      headers: {
        ...buildJupyterAuthHeaders(data.token),
        ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      },
      body: hasBody ? JSON.stringify(data.body) : undefined,
      allowHttp: true,
      maxRedirects: 0,
    })

    const text = await upstream.text()

    return new NextResponse(text.length > 0 ? text : null, {
      status: upstream.status,
      headers: { 'Content-Type': upstream.headers.get('content-type') || 'application/json' },
    })
  } catch (error) {
    logger.error(`[${requestId}] Unexpected error:`, error)
    return NextResponse.json(
      { success: false, error: getErrorMessage(error, 'Unknown error') },
      { status: 500 }
    )
  }
})
