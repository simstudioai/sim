'use client'

import { useEffect, useMemo } from 'react'

/**
 * Detect if the current platform is Mac
 */
export function isMacPlatform() {
  if (typeof navigator === 'undefined') return false
  return navigator.platform.toUpperCase().indexOf('MAC') >= 0
}

/**
 * Get a formatted keyboard shortcut string for display
 * @param key The key part of the shortcut (e.g., "Enter")
 * @param requiresCmd Whether the shortcut requires Cmd/Ctrl
 * @param requiresShift Whether the shortcut requires Shift
 * @param requiresAlt Whether the shortcut requires Alt/Option
 */
export function getKeyboardShortcutText(
  key: string,
  requiresCmd = false,
  requiresShift = false,
  requiresAlt = false
) {
  const isMac = isMacPlatform()
  const cmdKey = isMac ? '⌘' : 'Ctrl'
  const altKey = isMac ? '⌥' : 'Alt'
  const shiftKey = '⇧'

  const parts: string[] = []
  if (requiresCmd) parts.push(cmdKey)
  if (requiresShift) parts.push(shiftKey)
  if (requiresAlt) parts.push(altKey)
  parts.push(key)

  return parts.join('+')
}

/**
 * Hook to manage keyboard shortcuts
 * @param onRunWorkflow - Function to run when Cmd/Ctrl+Enter is pressed
 * @param isDisabled - Whether shortcuts should be disabled
 */
export function useKeyboardShortcuts(onRunWorkflow: () => void, isDisabled = false) {
  // Memoize the platform detection
  const isMac = useMemo(() => isMacPlatform(), [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Run workflow with Cmd+Enter (Mac) or Ctrl+Enter (Windows/Linux)
      if (event.key === 'Enter' && ((isMac && event.metaKey) || (!isMac && event.ctrlKey))) {
        // Don't trigger if user is typing in an input, textarea, or contenteditable element
        const activeElement = document.activeElement
        const isEditableElement =
          activeElement instanceof HTMLInputElement ||
          activeElement instanceof HTMLTextAreaElement ||
          activeElement?.hasAttribute('contenteditable')

        if (!isEditableElement && !isDisabled) {
          event.preventDefault()
          onRunWorkflow()
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onRunWorkflow, isDisabled, isMac])
} 