'use client'

import { useEffect, useEffectEvent } from 'react'

const FEEDBACK_DURATION_MS = 4_000

/** A new feedback event restarts the dwell; null pauses or dismisses it. */
export function useFeedbackExpiry(event: unknown, expire: () => void) {
  const onExpire = useEffectEvent(expire)
  useEffect(() => {
    if (event == null) return
    const timer = window.setTimeout(onExpire, FEEDBACK_DURATION_MS)
    return () => window.clearTimeout(timer)
  }, [event])
}
