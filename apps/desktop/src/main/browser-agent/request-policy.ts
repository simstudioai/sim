import { createLogger } from '@sim/logger'
import type { OnBeforeRequestListenerDetails } from 'electron'
import { agentAppOrigin, routeAgentNavigation } from '@/main/browser-agent/registry'
import {
  checkAgentUrl,
  isBlockedRequestUrl,
  isBlockedSubresourceUrl,
  subresourceNeedsResolution,
} from '@/main/browser-agent/url-guard'
import { isAppOrigin } from '@/main/navigation'

const logger = createLogger('BrowserRequestPolicy')
type BrowserRequest = Pick<
  OnBeforeRequestListenerDetails,
  'url' | 'resourceType' | 'webContents' | 'method'
>

/**
 * Chromium's bundled PDF viewer and the shared UI resources it loads. Both are packaged local
 * resources rather than network requests, and Chromium never lets web content load them, so the
 * network guard, which admits only http(s), would otherwise block every PDF from rendering.
 */
const PDF_VIEWER_RESOURCE_PREFIXES = [
  'chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/',
  'chrome://resources/',
] as const

/** The same network guard applies to isolated and authenticated browser views. */
export async function allowBrowserRequest(details: BrowserRequest): Promise<boolean> {
  if (PDF_VIEWER_RESOURCE_PREFIXES.some((prefix) => details.url.startsWith(prefix))) return true
  if (
    details.resourceType === 'mainFrame' &&
    details.webContents &&
    routeAgentNavigation(details.webContents, details.url, details.method)
  )
    return false
  const appOrigin = details.webContents && agentAppOrigin(details.webContents)
  if (appOrigin && details.resourceType === 'mainFrame' && !isAppOrigin(details.url, appOrigin)) {
    return false
  }
  if (details.resourceType === 'mainFrame' || details.resourceType === 'subFrame') {
    return (await checkAgentUrl(details.url)).ok
  }
  return subresourceNeedsResolution(details.resourceType)
    ? !(await isBlockedSubresourceUrl(details.url))
    : !isBlockedRequestUrl(details.url)
}

/** A loader may disappear while DNS resolves; answer once without an unhandled rejection. */
export function handleBrowserRequest(
  details: BrowserRequest,
  callback: (response: { cancel: boolean }) => void
): void {
  const finish = (allowed: boolean) => {
    try {
      callback({ cancel: !allowed })
    } catch {
      logger.warn('Browser request ended before its guard completed')
    }
  }
  void allowBrowserRequest(details).then(finish, () => finish(false))
}
