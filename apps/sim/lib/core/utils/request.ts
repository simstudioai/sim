import { getRequestContext } from '@sim/logger'
import { createClientIpResolver } from '@sim/security/ip'
import { generateId } from '@sim/utils/id'
import { env } from '@/lib/core/config/env'

const clientIpResolver = createClientIpResolver(env.AUTH_TRUSTED_PROXIES)

export const trustedProxies = clientIpResolver.trustedProxies

/**
 * Generate a short request ID for correlation. If called inside a request
 * context (see `withRouteHandler` and `runWithRequestContext`), returns the
 * active request's ID so inline `[${requestId}]` log prefixes align with
 * the auto-attached `{requestId=...}` logger metadata.
 */
export function generateRequestId(): string {
  return getRequestContext()?.requestId ?? generateId().slice(0, 8)
}

/**
 * Resolves the first untrusted client address from a proxy-appended forwarded
 * chain. Returns `null` when the chain is missing, malformed, or contains only
 * trusted proxies so callers can apply an explicit policy without sharing one
 * synthetic rate-limit identity.
 */
export function getClientIp(request: {
  headers: { get(name: string): string | null }
}): string | null {
  return clientIpResolver.resolve(request.headers)
}
