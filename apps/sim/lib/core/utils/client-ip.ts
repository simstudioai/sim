import {
  type ClientIpHeaderSource,
  parseTrustedProxies,
  resolveClientIp,
} from '@sim/security/client-ip'
import { env } from '@/lib/core/config/env'

/**
 * Reverse-proxy hops trusted for forwarded-IP resolution, read from the same
 * `AUTH_TRUSTED_PROXIES` as Better Auth's `advanced.ipAddress.trustedProxies`
 * (see `lib/auth/auth.ts`). Parsed once at module load.
 *
 * Configured, the two agree on who the caller is. Left unset they diverge by
 * design: Better Auth trusts only a single-value header and records no IP for a
 * longer chain, whereas a throttle cannot opt out of having a key, so this falls
 * back to the rightmost — still proxy-written, never caller-authored.
 */
const trustedProxies = parseTrustedProxies(env.AUTH_TRUSTED_PROXIES)

/**
 * Extract the client IP from a request for logging, audit trails, and — most
 * importantly — per-IP rate-limit keys.
 *
 * Server-only: kept out of `@/lib/core/utils/request` so the `ipaddr.js`
 * dependency never reaches a client bundle through that module's other exports.
 *
 * See {@link resolveClientIp} for why the chain is walked right to left. In
 * short: the leftmost `X-Forwarded-For` entry is supplied by the caller, so
 * keying a throttle on it lets anyone mint a fresh bucket per request.
 */
export function getClientIp(request: ClientIpHeaderSource): string {
  return resolveClientIp(request, trustedProxies)
}
