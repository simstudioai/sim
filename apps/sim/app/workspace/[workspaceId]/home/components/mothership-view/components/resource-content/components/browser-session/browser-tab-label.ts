import type { BrowserTabState } from '@sim/browser-protocol'

export function browserTabHostname(url: string): string | null {
  if (!/^https?:\/\//i.test(url)) return null
  try {
    return new URL(url).hostname
  } catch {
    return null
  }
}

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
  const title = tab.title.trim()
  if (title) return title
  if (tab.loading) return 'Loading…'
  return browserTabHostname(tab.url) ?? 'New tab'
}
