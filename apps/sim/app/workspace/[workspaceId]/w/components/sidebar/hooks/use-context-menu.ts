import { useCallback, useEffect, useRef, useState } from 'react'

interface UseContextMenuProps {
  /**
   * Callback when context menu should open
   */
  onContextMenu?: (e: React.MouseEvent) => void
}

interface ContextMenuPosition {
  x: number
  y: number
}

/**
 * Hook for managing context menu (right-click) state and positioning.
 *
 * Handles:
 * - Right-click event prevention and positioning
 * - Menu open/close state
 * - Click-outside detection to close menu
 *
 * @param props - Hook configuration
 * @returns Context menu state and handlers
 */
export function useContextMenu({ onContextMenu }: UseContextMenuProps = {}) {
  const [isOpen, setIsOpen] = useState(false)
  const [position, setPosition] = useState<ContextMenuPosition>({ x: 0, y: 0 })
  const menuRef = useRef<HTMLDivElement>(null)
  // Used to prevent click-outside dismissal when trigger is clicked
  const dismissPreventedRef = useRef(false)

  /**
   * Handle right-click event
   */
  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()

      // Calculate position relative to viewport
      const x = e.clientX
      const y = e.clientY

      setPosition({ x, y })
      setIsOpen(true)

      onContextMenu?.(e)
    },
    [onContextMenu]
  )

  /**
   * Close the context menu
   */
  const closeMenu = useCallback(() => {
    setIsOpen(false)
  }, [])

  /**
   * Prevent the next click-outside from dismissing the menu.
   * Call this on pointerdown of a toggle trigger to allow proper toggle behavior.
   */
  const preventDismiss = useCallback(() => {
    dismissPreventedRef.current = true
  }, [])

  /**
   * Handle clicks outside the menu to close it
   */
  useEffect(() => {
    if (!isOpen) return

    const handleClickOutside = (e: MouseEvent) => {
      // Check if dismissal was prevented (e.g., by toggle trigger's pointerdown)
      if (dismissPreventedRef.current) {
        dismissPreventedRef.current = false
        return
      }
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        closeMenu()
      }
    }

    // Small delay to prevent immediate close from the same click that opened the menu
    const timeoutId = setTimeout(() => {
      document.addEventListener('click', handleClickOutside)
    }, 0)

    return () => {
      clearTimeout(timeoutId)
      document.removeEventListener('click', handleClickOutside)
    }
  }, [isOpen, closeMenu])

  return {
    isOpen,
    position,
    menuRef,
    handleContextMenu,
    closeMenu,
    preventDismiss,
  }
}
