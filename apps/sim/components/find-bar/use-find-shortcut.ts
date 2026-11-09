'use client'

import type React from 'react'
import { useCallback, useEffect } from 'react'

interface UseFindShortcutOptions {
  /**
   * Whether this surface owns Cmd/Ctrl+F. Full-page owners must be mutually exclusive;
   * scoped owners arbitrate through containment and descendant event handling.
   */
  enabled: boolean
  /** The find bar's input, focused and selected once the bar opens. */
  inputRef: React.RefObject<HTMLInputElement | null>
  /** Limits a split-pane surface to shortcuts originating inside it. */
  containerRef?: React.RefObject<HTMLElement | null>
  onOpen: () => void
}

/**
 * Binds Cmd/Ctrl+F to open a find bar, overriding the browser's own find.
 *
 * Full-page surfaces listen on the document so an opened file responds before being focused.
 * Scoped surfaces attach the returned React key handler so descendant controls can consume it first.
 * A press another surface already consumed is left alone (`defaultPrevented`), and any chord with a
 * further modifier falls through to the browser, so Cmd+Shift+F and Cmd+Alt+F keep their meanings.
 */
export function useFindShortcut({
  enabled,
  inputRef,
  containerRef,
  onOpen,
}: UseFindShortcutOptions): React.KeyboardEventHandler<HTMLElement> {
  const handleFindShortcut = useCallback(
    (event: KeyboardEvent | React.KeyboardEvent<HTMLElement>) => {
      if (!enabled) return
      if (
        containerRef &&
        (!(event.target instanceof Node) || !containerRef.current?.contains(event.target))
      )
        return
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
    },
    [enabled, inputRef, containerRef, onOpen]
  )
  useEffect(() => {
    if (!enabled || containerRef) return
    document.addEventListener('keydown', handleFindShortcut)
    return () => document.removeEventListener('keydown', handleFindShortcut)
  }, [enabled, containerRef, handleFindShortcut])
  return handleFindShortcut
}
