import dns from 'node:dns/promises'
import { createLogger } from '@sim/logger'
import {
  isIpLiteral,
  isLoopbackIp,
  isPrivateIp,
  isPrivateIpHost,
  unwrapIpv6Brackets,
} from '@sim/security/ssrf'
import { getErrorMessage } from '@sim/utils/errors'
import { parseHttpUrl } from '@/main/navigation'

const logger = createLogger('BrowserAgentUrlGuard')

/** Hard deadline on the SSRF DNS lookup so a slow/hung resolver can't suspend
 * the check — and the onBeforeRequest callback that awaits it — indefinitely.
 * A timeout rejects, which fails closed (blocks) via the caller's catch. */
const DNS_TIMEOUT_MS = 5_000

/** dns.lookup bounded by {@link DNS_TIMEOUT_MS}; the timer is always cleared so a
 * won race never leaves a dangling rejection. */
async function resolveHost(host: string) {
  const lookup = dns.lookup(host, { all: true, verbatim: true })
  // If the timeout wins the race the lookup stays pending; swallow its eventual
  // settlement so a late rejection can't surface as an unhandled rejection.
  lookup.catch(() => {})
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      lookup,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('DNS lookup timed out')), DNS_TIMEOUT_MS)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

export interface UrlGuardResult {
  ok: boolean
  error?: string
}

const OK: UrlGuardResult = { ok: true }

/**
 * Whether an address is off limits to the embedded browser.
 *
 * Loopback is deliberately allowed: it is the user's own machine, and opening
 * a dev server on localhost is one of the most ordinary things to do in this
 * panel — the URL bar already assumes `http://` for it. Nothing is given away
 * by it either, since the desktop app hands the same agent an unrestricted
 * shell on that machine, so a blocked `http://localhost:3000` is one
 * `curl http://localhost:3000` away regardless.
 *
 * Every other private range stays blocked. Those are a different matter: the
 * LAN is other people's machines, and `169.254.169.254` is link-local rather
 * than loopback, so the cloud-metadata endpoint this guard exists for is
 * unaffected.
 */
function isBlockedAddress(ip: string): boolean {
  return isPrivateIp(ip) && !isLoopbackIp(ip)
}
const BLOCKED: UrlGuardResult = {
  ok: false,
  error: 'That address points to a private or internal network and was blocked.',
}

/**
 * SSRF guard for agent-browser navigation. The embedded browser is a
 * general-purpose surface driven by model/tool input, so a navigation to a
 * loopback/RFC1918/link-local host (e.g. the `169.254.169.254` cloud-metadata
 * endpoint) would let a page's contents be read back through the read/snapshot
 * tools. This resolves the host the same way `apps/sim` does for outbound
 * fetches and blocks any that land on a private/reserved address — except
 * loopback, which is allowed (see {@link isBlockedAddress}).
 *
 * IP literals are classified directly; hostnames are DNS-resolved and every
 * returned address is checked. Resolution failure fails CLOSED (blocks): we
 * can't confirm the host is public, and Chromium resolves independently, so it
 * could still reach a private address our lookup missed — matching
 * `validateUrlWithDNS` in `apps/sim`. The residual DNS-rebinding TOCTOU window
 * (our lookup vs Chromium's) is only fully closable with egress firewalling;
 * {@link isBlockedRequestUrl} adds a synchronous per-request literal-IP backstop
 * for redirects and subresources.
 */
export async function checkAgentUrl(rawUrl: string): Promise<UrlGuardResult> {
  const url = parseHttpUrl(rawUrl)
  if (!url) {
    return { ok: false, error: 'URL must be absolute and start with http:// or https://' }
  }

  const host = unwrapIpv6Brackets(url.hostname)

  // IP literal: classify directly, no DNS lookup needed.
  if (isIpLiteral(host)) {
    if (isBlockedAddress(host)) {
      logger.warn('Blocked agent navigation to private IP literal', { host })
      return BLOCKED
    }
    return OK
  }

  try {
    const resolved = await resolveHost(host)
    if (resolved.some(({ address }) => isBlockedAddress(address))) {
      logger.warn('Blocked agent navigation resolving to private IP', { host })
      return BLOCKED
    }
  } catch (error) {
    // Fail closed: an unresolved host can't be confirmed public, and Chromium
    // resolves independently, so it could still reach a private address.
    logger.warn('Agent navigation host did not resolve; blocking', {
      host,
      error: getErrorMessage(error),
    })
    return { ok: false, error: 'That address could not be resolved.' }
  }

  return OK
}

/**
 * Synchronous backstop for the agent partition's `onBeforeRequest`: blocks any
 * request whose host is a **literal** private/reserved IP. This is cheap enough
 * to run per-request and catches redirects and subresources that target the
 * metadata endpoint or an internal IP directly, without the cost of a DNS
 * lookup on every subresource. Hostnames pass here (they are classified at
 * navigation time by {@link checkAgentUrl}).
 */
export function isBlockedRequestUrl(rawUrl: string): boolean {
  try {
    // isPrivateIpHost strips IPv6 brackets itself; unwrap again for the
    // loopback carve-out, which takes a bare address.
    const host = new URL(rawUrl).hostname
    return isPrivateIpHost(host) && !isLoopbackIp(unwrapIpv6Brackets(host))
  } catch {
    return false
  }
}
