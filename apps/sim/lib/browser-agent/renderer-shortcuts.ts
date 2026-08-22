const FOCUS_VISIBLE_BROWSER_OMNIBOX_EVENT = 'sim:focus-visible-browser-omnibox'

/**
 * Gives the visible browser panel first refusal on Sim renderer shortcuts.
 * Returns true only when a live panel claimed and handled the request.
 */
export function focusVisibleBrowserOmnibox(): boolean {
  if (typeof window === 'undefined') return false
  const event = new Event(FOCUS_VISIBLE_BROWSER_OMNIBOX_EVENT, { cancelable: true })
  window.dispatchEvent(event)
  return event.defaultPrevented
}

/** Registers the currently visible browser panel as the renderer-side Cmd+L owner. */
export function onFocusVisibleBrowserOmnibox(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const listener = (event: Event) => {
    event.preventDefault()
    callback()
  }
  window.addEventListener(FOCUS_VISIBLE_BROWSER_OMNIBOX_EVENT, listener)
  return () => window.removeEventListener(FOCUS_VISIBLE_BROWSER_OMNIBOX_EVENT, listener)
}
