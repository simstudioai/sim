import { createHmac, timingSafeEqual } from 'node:crypto'
import { getEnv } from '@/lib/core/config/env'
import { isProd } from '@/lib/core/config/env-flags'

/** Visitor×app session abuse token TTL (after Turnstile). */
const ABUSE_TOKEN_TTL_MS = 30 * 60 * 1000

function abuseSecret(): string {
  // Prefer dedicated secret. Hop-secret fallback is for local/dev only — production
  // should set APPS_ABUSE_TOKEN_SECRET so abuse tokens are not cross-purpose with proxy HMAC.
  const dedicated = (getEnv('APPS_ABUSE_TOKEN_SECRET') || '').trim()
  if (dedicated.length >= 32) return dedicated
  if (isProd) {
    throw new Error('APPS_ABUSE_TOKEN_SECRET must be configured separately in production')
  }
  const hop = (getEnv('APPS_PROXY_HOP_SECRET') || '').trim()
  if (hop.length >= 32) return hop
  throw new Error('APPS_ABUSE_TOKEN_SECRET (preferred) or APPS_PROXY_HOP_SECRET must be set')
}

export type AbuseTokenClaims = {
  publicId: string
  visitorId: string
  exp: number
}

export function issueAppsAbuseToken(publicId: string, visitorId: string, now = Date.now()): string {
  const claims: AbuseTokenClaims = {
    publicId,
    visitorId,
    exp: now + ABUSE_TOKEN_TTL_MS,
  }
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url')
  const sig = createHmac('sha256', abuseSecret()).update(body, 'utf8').digest('base64url')
  return `${body}.${sig}`
}

export function verifyAppsAbuseToken(
  token: string | null | undefined,
  publicId: string,
  now = Date.now()
): { ok: true; claims: AbuseTokenClaims } | { ok: false } {
  if (!token) return { ok: false }
  const [body, sig] = token.split('.')
  if (!body || !sig) return { ok: false }
  const expected = createHmac('sha256', abuseSecret()).update(body, 'utf8').digest('base64url')
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false }

  try {
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as AbuseTokenClaims
    if (claims.publicId !== publicId) return { ok: false }
    if (!claims.visitorId || typeof claims.exp !== 'number' || claims.exp < now)
      return { ok: false }
    return { ok: true, claims }
  } catch {
    return { ok: false }
  }
}
