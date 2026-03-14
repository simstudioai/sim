import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

const CLOSE_DELAY_MS = 150

const preventAutoFocus = (e: Event) => e.preventDefault()

/**
 * Manages hover-triggered dropdown menu state.
 * Provides handlers for trigger and content mouse events with a delay
 * to prevent flickering when moving between trigger and content.
 */
export function useHoverMenu() {
  const [isOpen, setIsOpen] = useState(false)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const cancelClose = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
  }, [])

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current)
      }
    }
  }, [])

  const scheduleClose = useCallback(() => {
    cancelClose()
    closeTimerRef.current = setTimeout(() => setIsOpen(false), CLOSE_DELAY_MS)
  }, [cancelClose])

  const open = useCallback(() => {
    cancelClose()
    setIsOpen(true)
  }, [cancelClose])

  const close = useCallback(() => {
    cancelClose()
    setIsOpen(false)
  }, [cancelClose])

  const triggerProps = useMemo(
    () => ({ onMouseEnter: open, onMouseLeave: scheduleClose }) as const,
    [open, scheduleClose]
  )

  const contentProps = useMemo(
    () =>
      ({
        onMouseEnter: cancelClose,
        onMouseLeave: scheduleClose,
        onCloseAutoFocus: preventAutoFocus,
      }) as const,
    [cancelClose, scheduleClose]
  )

  return { isOpen, open, close, triggerProps, contentProps }
}
