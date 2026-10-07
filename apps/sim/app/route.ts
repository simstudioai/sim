import { createLogger } from '@sim/logger'
import { getEnv } from '@/lib/core/config/env'
import { isHosted } from '@/lib/core/config/env-flags'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

export const dynamic = 'force-dynamic'
const logger = createLogger('PublicHomepage')
const MAX_HTML_BYTES = 2 * 1024 * 1024
const HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'private, no-store',
  Vary: 'Cookie',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Content-Security-Policy':
    "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'",
}

/** Public HTML bridge: the proxy owns session redirects; no request data reaches the static service. */
export const GET = withRouteHandler(async () => {
  if (!isHosted) {
    return new Response(null, { status: 307, headers: { ...HEADERS, Location: '/login' } })
  }
  try {
    const configuredOrigin = getEnv('LANDING_INTERNAL_ORIGIN')
    if (!configuredOrigin) throw new Error('Missing landing origin')
    const origin = new URL(configuredOrigin)
    if (
      !['http:', 'https:'].includes(origin.protocol) ||
      origin.username ||
      origin.password ||
      origin.pathname !== '/' ||
      origin.search ||
      origin.hash
    ) {
      throw new Error('Invalid landing origin')
    }
    // boundary-raw-fetch: fixed operator-configured private origin; returns static HTML, never forwards credentials.
    const upstream = await fetch(new URL('/', origin), {
      redirect: 'error',
      cache: 'no-store',
      credentials: 'omit',
      signal: AbortSignal.timeout(5000),
      headers: { Accept: 'text/html' },
    })
    if (
      upstream.status !== 200 ||
      upstream.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'text/html' ||
      !upstream.body
    ) {
      await upstream.body?.cancel()
      throw new Error('Invalid landing response')
    }
    const reader = upstream.body.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    try {
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) break
        size += chunk.value.byteLength
        if (size > MAX_HTML_BYTES) throw new Error('Landing response exceeds limit')
        chunks.push(chunk.value)
      }
    } finally {
      await reader.cancel()
    }
    return new Response(Buffer.concat(chunks), { headers: HEADERS })
  } catch {
    logger.warn('Public homepage unavailable')
    return new Response(
      '<!doctype html><title>Temporarily unavailable</title><p>Please try again later.</p><a href="/login">Sign in</a>',
      {
        status: 503,
        headers: { ...HEADERS, 'Retry-After': '60', 'X-Robots-Tag': 'noindex' },
      }
    )
  }
})
