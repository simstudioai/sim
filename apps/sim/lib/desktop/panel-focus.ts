'use client'

/**
 * Reports which renderer-owned panel currently owns the user's interaction
 * context, so the desktop shell can route global menu accelerators — a Cmd-W
 * typed into a shell should close that shell, not the window.
 *
 * Tracking belongs to the PANEL, not to the widgets inside it. A panel that
 * renders N children (terminal tabs) must not let each child report on its own
 * unmount: the shell holds a single flag per panel, so one child tearing down
 * would erase a sibling's live claim, and the accelerator would fall through to
 * closing the window.
 *
 * The claim follows real interaction, and only that: a document-level
 * `pointerdown` or `focusin` landing inside the panel. Appearing on screen is
 * NOT a claim — the agent opens these panels on the user's behalf, and a panel
 * that claimed on appearance would answer a Cmd-W aimed at the chat by closing
 * something the user never touched.
 *
 * This covers only what the shell cannot see for itself — renderer-owned
 * chrome. Content rendered in a native view above the renderer (the browser's
 * page) emits no DOM events here, and needs none: the shell reads that focus
 * directly from the view's own `webContents`.
 */
export function trackPanelFocus(
  panel: HTMLElement,
  reportFocus: (focused: boolean) => void
): () => void {
  // Deduped: these listeners see every pointerdown and focus move in the whole
  // app, and each report is an IPC hop whose handler re-registers listeners on
  // the main thread. Only transitions are worth sending.
  let reported: boolean | null = null
  const updateFocusOwner = (target: EventTarget | null) => {
    const owns = target instanceof Node && panel.contains(target)
    if (owns === reported) return
    reported = owns
    reportFocus(owns)
  }
  const handlePointerDown = (event: PointerEvent) => updateFocusOwner(event.target)
  const handleFocusIn = (event: FocusEvent) => updateFocusOwner(event.target)
  document.addEventListener('pointerdown', handlePointerDown, true)
  document.addEventListener('focusin', handleFocusIn, true)
  return () => {
    document.removeEventListener('pointerdown', handlePointerDown, true)
    document.removeEventListener('focusin', handleFocusIn, true)
    // Unconditional: the panel is going away, so the shell must not be left
    // holding a claim for it even if nothing inside it was ever focused.
    reportFocus(false)
  }
}
