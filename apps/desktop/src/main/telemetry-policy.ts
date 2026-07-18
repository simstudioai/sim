import { createLogger } from '@sim/logger'
import type { Session } from 'electron'
import { matchesHostList } from '@/main/navigation'

const logger = createLogger('DesktopTelemetryPolicy')

/**
 * Third-party web-analytics hosts blocked at the network layer. The hosted
 * origin gates GA/GTM on isHosted (true for sim.ai), so desktop sessions
 * would otherwise pollute web analytics as untagged pageviews. First-party
 * product analytics (same-origin /ingest) is untouched.
 */
export const BLOCKED_ANALYTICS_HOSTS: readonly string[] = [
  'googletagmanager.com',
  'google-analytics.com',
  'analytics.google.com',
  'stats.g.doubleclick.net',
]

const BLOCK_URL_PATTERNS = BLOCKED_ANALYTICS_HOSTS.flatMap((host) => [
  `*://${host}/*`,
  `*://*.${host}/*`,
])

/**
 * Suffix-matches a URL's hostname against the blocked analytics hosts.
 */
export function shouldBlockRequest(rawUrl: string): boolean {
  let hostname: string
  try {
    hostname = new URL(rawUrl).hostname
  } catch {
    return false
  }
  return matchesHostList(hostname, BLOCKED_ANALYTICS_HOSTS)
}

/**
 * Installs the desktop analytics policy on the app session. This is the only
 * onBeforeRequest consumer — Electron allows a single listener per session.
 */
export function attachTelemetryPolicy(session: Session, enabled: boolean): void {
  if (!enabled) {
    return
  }
  session.webRequest.onBeforeRequest({ urls: BLOCK_URL_PATTERNS }, (details, callback) => {
    callback({ cancel: shouldBlockRequest(details.url) })
  })
  logger.info('Third-party analytics blocking enabled')
}
