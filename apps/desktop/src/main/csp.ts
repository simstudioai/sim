import { createLogger } from '@sim/logger'
import type { Session } from 'electron'
import { isAppOrigin } from '@/main/navigation'

const logger = createLogger('DesktopCsp')

/**
 * A minimal, non-drifting Content-Security-Policy applied ONLY to an app-origin
 * top-level document whose response ships no CSP of its own.
 *
 * The hosted web app sends a full, env-aware policy on every response (see
 * `apps/sim/lib/core/security/csp.ts`), which the shell can neither import
 * (monorepo boundary) nor safely duplicate (it varies by env). This is a
 * defense-in-depth backstop for the narrow case where that header is somehow
 * absent — a deliberately small subset of the server's own base directives, so
 * it can never be stricter than what the app already depends on and cannot
 * break embeds or integrations.
 */
export const DEFAULT_DESKTOP_CSP = "frame-ancestors 'self'; object-src 'none'; base-uri 'self'"

function hasCspHeader(headers: Record<string, string[] | undefined>): boolean {
  return Object.keys(headers).some((key) => key.toLowerCase() === 'content-security-policy')
}

/**
 * Installs the CSP fallback on a session. Runs on `onHeadersReceived` (a
 * distinct event from telemetry-policy's `onBeforeRequest`, so the two coexist)
 * and leaves every response untouched except an app-origin main-frame document
 * that carries no CSP, which gets {@link DEFAULT_DESKTOP_CSP}.
 */
export function attachCspFallback(ses: Session, appOrigin: () => string): void {
  ses.webRequest.onHeadersReceived((details, callback) => {
    const headers = details.responseHeaders ?? {}
    if (
      details.resourceType === 'mainFrame' &&
      isAppOrigin(details.url, appOrigin()) &&
      !hasCspHeader(headers)
    ) {
      logger.info('Injecting fallback CSP for app document without one')
      callback({
        responseHeaders: { ...headers, 'Content-Security-Policy': [DEFAULT_DESKTOP_CSP] },
      })
      return
    }
    callback({})
  })
}
