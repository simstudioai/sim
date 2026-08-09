import { getRequestContext } from '@sim/logger'
import {
  type ClientIpHeaders,
  parseTrustedProxies,
  resolveClientIp as resolveClientIpWith,
  UNRESOLVED_CLIENT_IP_BUCKET,
} from '@sim/security/client-ip'
import { generateId } from '@sim/utils/id'
import { env } from '@/lib/core/config/env'

/**
 * Generate a short request ID for correlation. If called inside a request
 * context (see `withRouteHandler` and `runWithRequestContext`), returns the
 * active request's ID so inline `[${requestId}]` log prefixes align with
 * the auto-attached `{requestId=...}` logger metadata.
 */
export function generateRequestId(): string {
  return getRequestContext()?.requestId ?? generateId().slice(0, 8)
}

/** Shared with Better Auth's `advanced.ipAddress.trustedProxies` — see auth.ts. */
const trustedProxies = parseTrustedProxies(env.AUTH_TRUSTED_PROXIES)

/**
 * The request's client IP, or `null` when none can be trusted. `null` is a real
 * outcome, not an error: behind an unconfigured proxy the forwarded chain is
 * unverifiable, and resolving it anyway would return a client-controlled value.
 * Never treat it as a match.
 */
export function resolveClientIp(request: { headers: ClientIpHeaders }): string | null {
  return resolveClientIpWith(request, { trustedProxies })
}

/**
 * The client IP to key a rate limit on, falling back to one shared bucket when
 * no trustworthy address exists — the opposite of what an IP-gated check does
 * with the same `null`. Callers behind an unverifiable chain are
 * indistinguishable, so they must not each get a full allowance; that is the
 * amplification a spoofable IP hands an attacker. Use this for every IP-keyed
 * limit rather than resolving and defaulting at the call site.
 */
export function getRateLimitIpKey(request: { headers: ClientIpHeaders }): string {
  return resolveClientIp(request) ?? UNRESOLVED_CLIENT_IP_BUCKET
}
