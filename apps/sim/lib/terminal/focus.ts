/**
 * "Put the keyboard in this terminal" — sent by the resource strip when the
 * user picks a terminal tab with the pointer or opens a new shell. The strip
 * cannot reach the panel's xterm instances, so the request travels as a
 * window CustomEvent and the terminal panel subscribes via
 * {@link onTerminalFocusRequest}. Keyboard navigation along the strip does
 * not send one, so arrow keys keep working there.
 */
const TERMINAL_FOCUS_EVENT = 'sim:focus-terminal'

interface TerminalFocusDetail {
  terminalId: string
}

/** Asks the terminal panel to focus one shell once it is on screen. */
export function requestTerminalFocus(terminalId: string): void {
  window.dispatchEvent(
    new CustomEvent<TerminalFocusDetail>(TERMINAL_FOCUS_EVENT, { detail: { terminalId } })
  )
}

/** Subscribes the terminal panel to focus requests; returns an unsubscribe. */
export function onTerminalFocusRequest(callback: (terminalId: string) => void): () => void {
  const listener = (event: Event) => {
    const terminalId = (event as CustomEvent<TerminalFocusDetail>).detail?.terminalId
    if (typeof terminalId === 'string' && terminalId) callback(terminalId)
  }
  window.addEventListener(TERMINAL_FOCUS_EVENT, listener)
  return () => window.removeEventListener(TERMINAL_FOCUS_EVENT, listener)
}
