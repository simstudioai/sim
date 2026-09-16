'use client'

import { useEffect, useState } from 'react'

/**
 * Reveals an incrementing count (typed chars, streamed words) at a fixed
 * step interval while `active`, deriving progress from ELAPSED time so a
 * throttled background tab catches up instead of stalling mid-reveal.
 * Resets to 0 when inactive; jumps straight to `total` under
 * `prefers-reduced-motion`.
 */
export function useElapsedReveal(active: boolean, stepMs: number, total: number): number {
  const [revealed, setRevealed] = useState(0)

  useEffect(() => {
    if (!active) {
      setRevealed(0)
      return
    }

    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    let interval: ReturnType<typeof setInterval> | null = null

    const run = () => {
      const startedAt = performance.now()
      interval = setInterval(() => {
        const elapsed = performance.now() - startedAt
        const n = Math.min(Math.floor(elapsed / stepMs) + 1, total)
        setRevealed(n)
        if (n >= total && interval) clearInterval(interval)
      }, stepMs)
    }

    const syncMotionPreference = () => {
      if (interval) clearInterval(interval)
      if (media.matches) {
        setRevealed(total)
        return
      }
      run()
    }

    syncMotionPreference()
    media.addEventListener('change', syncMotionPreference)
    return () => {
      media.removeEventListener('change', syncMotionPreference)
      if (interval) clearInterval(interval)
    }
  }, [active, stepMs, total])

  return revealed
}
