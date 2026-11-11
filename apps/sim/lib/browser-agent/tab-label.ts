import type { BrowserTabState } from '@sim/browser-protocol'
import { siteHost } from '@/lib/favicon/url'

/** Page loading needs a spinner only until the tab has a usable favicon. */
export function shouldShowBrowserTabSpinner(
  loading: boolean,
  hostname: string | null,
  loadedHostname: string | null
): boolean {
  return loading && (!hostname || loadedHostname !== hostname)
}

/** A settled blank-title page is identified by its host, never as still loading. */
export function browserTabTitle(tab: BrowserTabState): string {
  if (tab.issue?.kind === 'crashed') return 'Page crashed'
  if (tab.issue?.kind === 'unresponsive') return 'Not responding'
  if (tab.issue?.kind === 'load-error') return siteHost(tab.url) ?? 'Page unavailable'
  const title = tab.title.trim()
  if (title) return title
  if (tab.loading) return 'Loading'
  return siteHost(tab.url) ?? 'New tab'
}
