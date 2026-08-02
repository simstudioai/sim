import {
  type ClientIpHeaderSource,
  parseTrustedProxies,
  resolveClientIp,
  UNKNOWN_CLIENT_IP,
} from '@sim/security/client-ip'
import { env, isFalsy } from '@/lib/core/config/env'

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
 * Whether forwarded headers may be believed at all.
 *
 * Every rule about which hop to read presumes a proxy wrote at least one of
 * them. Reachable directly — no proxy, port published straight to the internet —
 * the entire header is caller-authored and no parsing strategy can recover a
 * real address from it. Operators of such a deployment set
 * `TRUST_PROXY_HEADERS=false`, which makes {@link getClientIp} decline to guess.
 */
const trustForwardedHeaders = !isFalsy(env.TRUST_PROXY_HEADERS)

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
 *
 * With `TRUST_PROXY_HEADERS=false` this returns {@link UNKNOWN_CLIENT_IP} for
 * every caller, collapsing per-IP limits to a single shared bucket. That is
 * deliberately blunt — it throttles unrelated callers together — but it fails
 * closed, which a header nobody vouched for does not.
 */
export function getClientIp(request: ClientIpHeaderSource): string {
  if (!trustForwardedHeaders) return UNKNOWN_CLIENT_IP
  return resolveClientIp(request, trustedProxies)
}
