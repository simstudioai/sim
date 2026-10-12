/**
 * "Put the caret in this new tab's omnibox" — sent by the resource strip when
 * the user opens a blank browser tab. The tab only reaches the screen after the
 * desktop confirms it and the strip selects it, and the browser panel may not
 * be mounted yet, so the request is held here until the panel shows that exact
 * tab. Tabs the agent opens never send one, so its work cannot move the caret.
 */
const BROWSER_OMNIBOX_FOCUS_EVENT = 'sim:focus-browser-omnibox'

interface BrowserOmniboxFocusRequest {
  scopeId: string
  tabId: string
}

let pendingRequest: BrowserOmniboxFocusRequest | null = null

/** Asks the browser panel to focus the omnibox once it shows this tab. */
export function requestBrowserOmniboxFocus(tabId: string, scopeId: string): void {
  pendingRequest = { scopeId, tabId }
  window.dispatchEvent(new Event(BROWSER_OMNIBOX_FOCUS_EVENT))
}

/** Claims the pending request when it names the tab now on screen. */
export function takeBrowserOmniboxFocusRequest(tabId: string, scopeId: string): boolean {
  if (pendingRequest?.tabId !== tabId || pendingRequest.scopeId !== scopeId) return false
  pendingRequest = null
  return true
}

/** Subscribes the browser panel to new requests; returns an unsubscribe. */
export function onBrowserOmniboxFocusRequest(callback: () => void): () => void {
  window.addEventListener(BROWSER_OMNIBOX_FOCUS_EVENT, callback)
  return () => window.removeEventListener(BROWSER_OMNIBOX_FOCUS_EVENT, callback)
}
