import { createHmac, timingSafeEqual } from 'node:crypto'
import { APP_ORIGIN_HEADER } from '@/lib/apps/origin'
import { getEnv } from '@/lib/core/config/env'

const HOP_TTL_MS = 60_000

function hopSecret(): string {
  const secret = (getEnv('APPS_PROXY_HOP_SECRET') || '').trim()
  if (!secret || secret.length < 32) {
    throw new Error('APPS_PROXY_HOP_SECRET is not configured')
  }
  return secret
}

/**
 * Apps-domain proxy signs: `${timestamp}.${method}.${path}` with HMAC-SHA256.
 * Header value: `${timestamp}.${hexDigest}`
 */
export function createAppsHopProof(method: string, path: string, now = Date.now()): string {
  const ts = String(now)
  const payload = `${ts}.${method.toUpperCase()}.${path}`
  const digest = createHmac('sha256', hopSecret()).update(payload, 'utf8').digest('hex')
  return `${ts}.${digest}`
}

export function verifyAppsHopProof(
  method: string,
  path: string,
  headerValue: string | null | undefined,
  now = Date.now()
): boolean {
  if (!headerValue) return false
  const [ts, digest] = headerValue.split('.')
  if (!ts || !digest) return false
  const timestamp = Number(ts)
  if (!Number.isFinite(timestamp) || Math.abs(now - timestamp) > HOP_TTL_MS) return false

  const expected = createAppsHopProof(method, path, timestamp)
  const a = Buffer.from(expected)
  const b = Buffer.from(`${ts}.${digest}`)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export function requireAppsHopFromRequest(request: {
  method: string
  nextUrl: { pathname: string }
  headers: { get: (name: string) => string | null }
}): { ok: true } | { ok: false; status: number; message: string } {
  const proof = request.headers.get(APP_ORIGIN_HEADER)
  const path = request.nextUrl.pathname
  try {
    if (!verifyAppsHopProof(request.method, path, proof)) {
      return {
        ok: false,
        status: 403,
        message: 'Invalid or missing apps proxy hop proof',
      }
    }
  } catch {
    return { ok: false, status: 503, message: 'Apps gateway is not configured' }
  }
  return { ok: true }
}
