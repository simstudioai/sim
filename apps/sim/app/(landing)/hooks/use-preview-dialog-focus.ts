'use client'

import { type RefObject, useEffect, useRef } from 'react'

/** Restores the actual opener when a preview uses a controlled modal without a DialogTrigger. */
export function usePreviewDialogFocus(open: boolean, fallbackRef: RefObject<HTMLElement | null>) {
  const openerRef = useRef<HTMLElement | null>(null)
  const previousOpenRef = useRef(open)

  useEffect(() => {
    const closed = previousOpenRef.current && !open
    previousOpenRef.current = open
    if (!closed) return

    /** Let the dialog release its focus trap before returning to the preview. */
    const frame = requestAnimationFrame(() => {
      const opener = openerRef.current
      if (opener?.isConnected) opener.focus({ preventScroll: true })
      if (!opener?.isConnected || document.activeElement !== opener) {
        fallbackRef.current?.focus({ preventScroll: true })
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [open, fallbackRef])

  return openerRef
}
