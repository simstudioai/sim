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
  const isLockedRef = useRef(false)
  const hoverRegionCountRef = useRef(0)

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
    if (isLockedRef.current) {
      return
    }
    cancelClose()
    closeTimerRef.current = setTimeout(() => {
      if (!isLockedRef.current && hoverRegionCountRef.current === 0) {
        setIsOpen(false)
      }
    }, CLOSE_DELAY_MS)
  }, [cancelClose])

  const open = useCallback(() => {
    cancelClose()
    setIsOpen(true)
  }, [cancelClose])

  const close = useCallback(() => {
    if (isLockedRef.current) {
      return
    }
    cancelClose()
    setIsOpen(false)
  }, [cancelClose])

  const setLocked = useCallback(
    (locked: boolean) => {
      isLockedRef.current = locked
      cancelClose()
      if (locked) {
        setIsOpen(true)
      } else if (hoverRegionCountRef.current === 0) {
        setIsOpen(false)
      }
    },
    [cancelClose]
  )

  const handleTriggerMouseEnter = useCallback(() => {
    hoverRegionCountRef.current += 1
    open()
  }, [open])

  const handleTriggerMouseLeave = useCallback(() => {
    hoverRegionCountRef.current = Math.max(0, hoverRegionCountRef.current - 1)
    scheduleClose()
  }, [scheduleClose])

  const handleContentMouseEnter = useCallback(() => {
    hoverRegionCountRef.current += 1
    cancelClose()
  }, [cancelClose])

  const handleContentMouseLeave = useCallback(() => {
    hoverRegionCountRef.current = Math.max(0, hoverRegionCountRef.current - 1)
    scheduleClose()
  }, [scheduleClose])

  const triggerProps = useMemo(
    () =>
      ({
        onMouseEnter: handleTriggerMouseEnter,
        onMouseLeave: handleTriggerMouseLeave,
      }) as const,
    [handleTriggerMouseEnter, handleTriggerMouseLeave]
  )

  const contentProps = useMemo(
    () =>
      ({
        onMouseEnter: handleContentMouseEnter,
        onMouseLeave: handleContentMouseLeave,
        onCloseAutoFocus: preventAutoFocus,
      }) as const,
    [handleContentMouseEnter, handleContentMouseLeave]
  )

  return { isOpen, open, close, setLocked, triggerProps, contentProps }
}
