import { useEffect, useState } from 'react'

/**
 * How often the clock is re-read. Comfortably under a second so a displayed
 * second turns over close to when it actually should, rather than drifting by
 * most of a second against an interval that started late.
 */
const ELAPSED_TICK_MS = 250

/**
 * Milliseconds elapsed since `startedAt`, while `active`; 0 otherwise.
 *
 * Anchors to `startedAt` so a consumer that mounts partway through resumes
 * mid-count instead of restarting; falls back to activation time when there is
 * no start to give. A sample taken under a different `resetKey` reads as 0, so
 * switching subjects never flashes the previous subject's count.
 */
interface UseElapsedMsProps {
  active: boolean
  startedAt?: number
  /** Identity of what is being timed; defaults to `startedAt`. */
  resetKey?: string | number
}

export function useElapsedMs({
  active,
  startedAt,
  resetKey = startedAt,
}: UseElapsedMsProps): number {
  const [sample, setSample] = useState({ resetKey, elapsedMs: 0 })

  useEffect(() => {
    if (!active) return
    const anchor = startedAt ?? Date.now()
    const tick = () => setSample({ resetKey, elapsedMs: Date.now() - anchor })
    tick()
    const interval = setInterval(tick, ELAPSED_TICK_MS)
    return () => clearInterval(interval)
  }, [active, startedAt, resetKey])

  return active && sample.resetKey === resetKey ? sample.elapsedMs : 0
}
