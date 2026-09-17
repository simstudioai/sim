import { createLogger } from '@sim/logger'
import type { Session } from 'electron'
import { isAgentWebContents } from '@/main/browser-agent/registry'
import { handleBrowserRequest } from '@/main/browser-agent/request-policy'
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
  session.webRequest.onBeforeRequest((details, callback) => {
    if (enabled && shouldBlockRequest(details.url)) {
      callback({ cancel: true })
    } else if (details.webContents && isAgentWebContents(details.webContents)) {
      handleBrowserRequest(details, callback)
    } else {
      callback({ cancel: false })
    }
  })
  if (enabled) logger.info('Third-party analytics blocking enabled')
}
