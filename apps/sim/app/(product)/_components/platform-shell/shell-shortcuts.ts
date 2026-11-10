'use client'

import { type RefObject, useEffect, useEffectEvent } from 'react'
import { useDesktopCommands } from '@/app/(product)/_components/desktop/desktop-host'

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  )
}

interface ShellShortcutHandlers {
  /** The navigation drawer, the one modal the shell's own shortcuts may act over. */
  drawer: RefObject<HTMLDialogElement | null>
  toggleSidebar: () => void
  /** Toggles command search; `canOpen` is false while another modal holds the page. */
  toggleCommand: (canOpen: boolean) => void
}

/**
 * Mod+K (command search) and Mod+B (sidebar) from the keyboard, and on desktop from the native
 * menu's accelerators for the same keys, which arrive as commands with no key event. Both paths
 * apply the same guards against the focused element: no shortcut opens over another modal, and
 * Mod+B leaves an editable field's own binding alone. A key a focused control already claimed
 * (`defaultPrevented`, as the terminal's Mod+K clear does) is never taken.
 */
export function useShellShortcuts({ drawer, toggleSidebar, toggleCommand }: ShellShortcutHandlers) {
  const run = useEffectEvent((key: 'k' | 'b', target: EventTarget | null) => {
    const modal = target instanceof Element ? target.closest('dialog:modal') : null
    const canOpen = !modal || modal === drawer.current
    if (key === 'k') {
      toggleCommand(canOpen)
      return true
    }
    if (!canOpen || isEditableTarget(target)) return false
    toggleSidebar()
    return true
  })

  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.altKey ||
        event.shiftKey ||
        !(event.metaKey || event.ctrlKey)
      )
        return
      const key = event.key.toLowerCase()
      if ((key === 'k' || key === 'b') && run(key, event.target)) event.preventDefault()
    }
    document.addEventListener('keydown', shortcut)
    return () => document.removeEventListener('keydown', shortcut)
  }, [])

  useDesktopCommands((command) => {
    if (command === 'toggle-sidebar') run('b', document.activeElement)
    if (command === 'open-search') run('k', document.activeElement)
  })
}
