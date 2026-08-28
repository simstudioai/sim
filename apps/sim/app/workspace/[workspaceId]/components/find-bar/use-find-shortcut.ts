'use client'

import type React from 'react'
import { useEffect } from 'react'

interface UseFindShortcutOptions {
  /**
   * Whether this surface currently owns Cmd/Ctrl+F. Every find surface binds its own listener, so
   * exactly one owner may be enabled at a time — the surfaces arbitrate by mounting (the Files list
   * disables itself while a file is open, and the file editor enables itself only where the document
   * is the page), by an embed flag (the table grid), or by DOM containment (the browser session).
   * Two enabled owners mounted at once would race, and first-registered would win.
   */
  enabled: boolean
  /** The find bar's input, focused and selected once the bar opens. */
  inputRef: React.RefObject<HTMLInputElement | null>
  onOpen: () => void
}

/**
 * Binds Cmd/Ctrl+F to open a find bar, overriding the browser's own find.
 *
 * Listens on the document rather than a container so the shortcut answers before anything inside the
 * surface has been focused — a file that has only been opened, never clicked into, still responds.
 * A press another surface already consumed is left alone (`defaultPrevented`), and any chord with a
 * further modifier falls through to the browser, so Cmd+Shift+F and Cmd+Alt+F keep their meanings.
 */
export function useFindShortcut({ enabled, inputRef, onOpen }: UseFindShortcutOptions): void {
  useEffect(() => {
    if (!enabled) return
    const handleFindShortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return
      if (event.key.toLowerCase() !== 'f') return
      if (event.defaultPrevented) return
      event.preventDefault()
      onOpen()
      // After the open has painted the bar, so there is an input to focus.
      requestAnimationFrame(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      })
    }
    document.addEventListener('keydown', handleFindShortcut)
    return () => document.removeEventListener('keydown', handleFindShortcut)
  }, [enabled, inputRef, onOpen])
}
