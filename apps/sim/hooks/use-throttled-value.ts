'use client'

import { useEffect, useRef, useState } from 'react'

const DEFAULT_THROTTLE_MS = 100

/**
 * Trailing-edge throttle for rendered string values.
 *
 * The underlying data accumulates instantly via the caller's state, but this
 * hook gates DOM re-renders to at most every `intervalMs` milliseconds.
 * When streaming stops (i.e. the value settles), the final value is flushed
 * immediately so no trailing content is lost.
 *
 * @param value      The raw string that may update very frequently.
 * @param intervalMs Throttle window in ms. Lower values = smoother updates
 *                   at the cost of more renders. Defaults to 100ms.
 */
export function useThrottledValue(value: string, intervalMs = DEFAULT_THROTTLE_MS): string {
  const [displayed, setDisplayed] = useState(value)
  const lastFlushRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    const now = Date.now()
    const remaining = intervalMs - (now - lastFlushRef.current)

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
  }, [value, intervalMs])

  return displayed
}
