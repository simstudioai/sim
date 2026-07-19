/**
 * "Open this URL in the Sim browser panel" — the desktop-only affordance that
 * routes chat links into the embedded agent browser instead of a new browser
 * tab.
 *
 * Rendering components (markdown links, chips) can't reach the chat's
 * resource state directly, so the request travels as a window CustomEvent;
 * the chat hook owns the panel resource and subscribes via
 * {@link onOpenInBrowserPanel}.
 *
 * OAuth/credential links must NOT go through here: the panel's browser runs
 * on its own partition (not signed in to Sim) and is an embedded user agent
 * that Google/Microsoft refuse — connect chips use the system-browser
 * handoff (`beginOAuthConnect`) instead.
 */
import { hasBrowserAgent } from '@/lib/desktop'

const OPEN_IN_BROWSER_PANEL_EVENT = 'sim:open-in-browser-panel'

interface OpenInBrowserPanelDetail {
  url: string
}

/** True when a click on this href should divert into the embedded panel. */
export function shouldOpenInBrowserPanel(href: string | undefined): href is string {
  return Boolean(href) && /^https?:\/\//i.test(href as string) && hasBrowserAgent()
}

/** Requests the chat surface to open the panel on this URL (fire-and-forget). */
export function openInBrowserPanel(url: string): void {
  window.dispatchEvent(
    new CustomEvent<OpenInBrowserPanelDetail>(OPEN_IN_BROWSER_PANEL_EVENT, { detail: { url } })
  )
}

/** Subscribes the chat surface to panel-open requests; returns an unsubscribe. */
export function onOpenInBrowserPanel(callback: (url: string) => void): () => void {
  const listener = (event: Event) => {
    const url = (event as CustomEvent<OpenInBrowserPanelDetail>).detail?.url
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
      callback(url)
    }
  }
  window.addEventListener(OPEN_IN_BROWSER_PANEL_EVENT, listener)
  return () => window.removeEventListener(OPEN_IN_BROWSER_PANEL_EVENT, listener)
}
