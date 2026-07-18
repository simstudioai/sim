import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
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
 * Apps-domain proxy signs: `${timestamp}.${method}.${path}.${bodySha256}` with HMAC-SHA256.
 * Header value: `${timestamp}.${hexDigest}`
 */
export function createAppsHopProof(
  method: string,
  path: string,
  body: string | Buffer | Uint8Array = '',
  now = Date.now()
): string {
  const ts = String(now)
  const bodyDigest = createHash('sha256').update(body).digest('hex')
  const payload = `${ts}.${method.toUpperCase()}.${path}.${bodyDigest}`
  const digest = createHmac('sha256', hopSecret()).update(payload, 'utf8').digest('hex')
  return `${ts}.${digest}`
}

export function verifyAppsHopProof(
  method: string,
  path: string,
  body: string | Buffer | Uint8Array,
  headerValue: string | null | undefined,
  now = Date.now()
): boolean {
  if (!headerValue) return false
  const [ts, digest] = headerValue.split('.')
  if (!ts || !digest) return false
  const timestamp = Number(ts)
  if (!Number.isFinite(timestamp) || Math.abs(now - timestamp) > HOP_TTL_MS) return false

  const expected = createAppsHopProof(method, path, body, timestamp)
  const a = Buffer.from(expected)
  const b = Buffer.from(`${ts}.${digest}`)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export async function requireAppsHopFromRequest(request: {
  method: string
  nextUrl: { pathname: string }
  headers: { get: (name: string) => string | null }
  clone: () => { arrayBuffer: () => Promise<ArrayBuffer> }
}): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  const proof = request.headers.get(APP_ORIGIN_HEADER)
  const path = request.nextUrl.pathname
  try {
    const body = Buffer.from(await request.clone().arrayBuffer())
    if (!verifyAppsHopProof(request.method, path, body, proof)) {
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
