import {
  type ClientIpHeaderSource,
  parseTrustedProxies,
  resolveClientIp,
} from '@sim/security/client-ip'
import { env } from '@/lib/core/config/env'

/**
 * Reverse-proxy hops trusted for forwarded-IP resolution, shared with Better
 * Auth's `advanced.ipAddress.trustedProxies` so session IPs and Sim's own
 * rate-limit keys agree on who the caller is. Parsed once at module load.
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
