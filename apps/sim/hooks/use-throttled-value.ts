'use client'

import { useEffect, useRef, useState } from 'react'

const TEXT_RENDER_THROTTLE_MS = 100

/**
 * Trailing-edge throttle for rendered string values.
 *
 * The underlying data accumulates instantly via the caller's state, but this
 * hook gates DOM re-renders to at most every {@link TEXT_RENDER_THROTTLE_MS}ms.
 * When streaming stops (i.e. the value settles), the final value is flushed
 * immediately so no trailing content is lost.
 */
export function useThrottledValue(value: string): string {
  const [displayed, setDisplayed] = useState(value)
  const lastFlushRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    const now = Date.now()
    const remaining = TEXT_RENDER_THROTTLE_MS - (now - lastFlushRef.current)

    if (remaining <= 0) {
      if (timerRef.current !== undefined) {
        clearTimeout(timerRef.current)
        timerRef.current = undefined
      }
      lastFlushRef.current = now
      setDisplayed(value)
    } else {
      if (timerRef.current !== undefined) clearTimeout(timerRef.current)

      timerRef.current = setTimeout(() => {
        lastFlushRef.current = Date.now()
        setDisplayed(value)
        timerRef.current = undefined
      }, remaining)
    }

    return () => {
      if (timerRef.current !== undefined) {
        clearTimeout(timerRef.current)
        timerRef.current = undefined
      }
    }
  }, [value])

  return displayed
}
