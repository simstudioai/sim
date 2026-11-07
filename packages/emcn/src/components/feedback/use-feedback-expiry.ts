'use client'

import { useEffect, useEffectEvent } from 'react'
import { FEEDBACK_DURATION_MS } from '#emcn/lib/feedback'

/** A new feedback event restarts the dwell; null pauses or dismisses it. */
export function useFeedbackExpiry(event: unknown, expire: () => void) {
  const onExpire = useEffectEvent(expire)
  useEffect(() => {
    if (event == null) return
    const timer = window.setTimeout(onExpire, FEEDBACK_DURATION_MS)
    return () => window.clearTimeout(timer)
  }, [event])
}
