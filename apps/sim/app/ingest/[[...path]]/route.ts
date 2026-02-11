import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'

const logger = createLogger('PostHogProxy')

const API_HOST = 'us.i.posthog.com'
const ASSET_HOST = 'us-assets.i.posthog.com'

/**
 * Builds the target PostHog URL from the incoming request path.
 * Routes /ingest/static/* to the asset host, everything else to the API host.
 */
function buildTargetUrl(pathname: string, search: string): { url: string; hostname: string } {
  const strippedPath = pathname.replace(/^\/ingest/, '')
  const hostname = strippedPath.startsWith('/static/') ? ASSET_HOST : API_HOST
  return {
    url: `https://${hostname}${strippedPath}${search}`,
    hostname,
  }
}

/**
 * Builds forwarding headers for the PostHog request.
 * Sets the Host header and strips cookies/connection headers
 * that shouldn't be forwarded.
 */
function buildHeaders(request: NextRequest, hostname: string): Headers {
  const headers = new Headers(request.headers)
  headers.set('host', hostname)
  headers.delete('cookie')
  headers.delete('connection')

  return headers
}

async function handler(request: NextRequest) {
  const { url, hostname } = buildTargetUrl(request.nextUrl.pathname, request.nextUrl.search)
  const headers = buildHeaders(request, hostname)

  const hasBody = !['GET', 'HEAD'].includes(request.method)

  try {
    const response = await fetch(url, {
      method: request.method,
      headers,
      ...(hasBody ? { body: request.body, duplex: 'half' } : {}),
    } as RequestInit)

    const responseHeaders = new Headers(response.headers)
    responseHeaders.delete('content-encoding')
    responseHeaders.delete('content-length')
    responseHeaders.delete('transfer-encoding')

    return new NextResponse(response.body, {
      status: response.status,
      headers: responseHeaders,
    })
  } catch (error) {
    logger.error('PostHog proxy error', {
      url,
      method: request.method,
      error: error instanceof Error ? error.message : String(error),
    })
    return new NextResponse(null, { status: 502 })
  }
}

export const GET = handler
export const POST = handler
export const PUT = handler
export const PATCH = handler
export const DELETE = handler
export const OPTIONS = handler
