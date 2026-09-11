import { CLIENT_INFO_HEADER, formatClientInfo } from '@sim/utils/client-info'
import { getDesktopShellVersion } from '@/lib/desktop'

export { CLIENT_INFO_HEADER }

export interface BrowserSurface {
  surface: 'web' | 'desktop'
  /** The desktop shell's version; absent on the web, which has no version of its own. */
  version?: string
}

/**
 * Which browser-hosted surface this page is: the desktop shell when its
 * preload bridge is present, the web app otherwise. The one decision behind
 * both the `X-Sim-Client-Info` header and the PostHog super property, so the
 * two can never disagree.
 */
export function resolveBrowserSurface(): BrowserSurface {
  const shellVersion = getDesktopShellVersion()
  return shellVersion === undefined
    ? { surface: 'web' }
    : { surface: 'desktop', version: shellVersion }
}

/**
 * The `X-Sim-Client-Info` value the web app sends on its own API calls.
 *
 * Returns `undefined` on the server, where the same client code runs during
 * prefetching and a request from the app to itself is not a web-surface call.
 * Inside the desktop shell the main process stamps the same identity on every
 * app-origin request as a backstop for traffic the page never issues itself.
 */
export function getClientInfoHeader(): string | undefined {
  if (typeof window === 'undefined') return undefined
  return formatClientInfo(resolveBrowserSurface())
}
