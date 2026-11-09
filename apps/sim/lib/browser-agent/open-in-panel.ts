/**
 * "Open this URL in the Sim browser panel" — the desktop-only affordance that
 * routes chat links into the embedded agent browser instead of a system-browser
 * tab.
 *
 * Rendering components (markdown links, chips) can't reach the chat's
 * resource state directly, so the request travels as a window CustomEvent;
 * the chat surface that owns the panel resource subscribes to it.
 *
 * OAuth/credential links must NOT go through here: the panel's browser runs
 * on its own partition (not signed in to Sim) and is an embedded user agent
 * that Google/Microsoft refuse — connect chips use the system-browser
 * handoff (`beginOAuthConnect`) instead.
 */
import { isBrowserAgentEnabled } from '@/lib/desktop'

const OPEN_IN_BROWSER_PANEL_EVENT = 'sim:open-in-browser-panel'

interface OpenInBrowserPanelDetail {
  url: string
}

/** True when a click on this href should divert into the embedded panel. */
export function shouldOpenInBrowserPanel(href: string | undefined): href is string {
  return Boolean(href) && /^https?:\/\//i.test(href as string) && isBrowserAgentEnabled()
}

/** Requests the chat surface to open the panel on this URL (fire-and-forget). */
export function openInBrowserPanel(url: string): void {
  window.dispatchEvent(
    new CustomEvent<OpenInBrowserPanelDetail>(OPEN_IN_BROWSER_PANEL_EVENT, { detail: { url } })
  )
}
