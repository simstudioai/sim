import { useEffect, useState } from 'react'

const ACTION_SWEEP_INTERVAL_MS = 160

/**
 * Advances the cumulative action-slot sweep by one frame.
 *
 * Fills left to right once and holds. It neither drains back nor restarts:
 * both re-run ground the bar has already covered, which reads as the block
 * losing progress rather than making it.
 */
export function advanceActionSweep(filledCount: number, slotCount: number): number {
  if (slotCount <= 0) return 0
  return Math.min(filledCount + 1, slotCount)
}

/** Runs a one-pass left-to-right fill while a block executes. */
export function useRunningActionSweep(isRunning: boolean, slotCount: number): number {
  const [filledCount, setFilledCount] = useState(0)

  useEffect(() => {
    /* After the early return, not before it: every idle ActionBar on the canvas
       runs this effect on mount, and scheduling an update there is wasted work.
       The `isRunning` guard on the return value already hides a stale count. */
    if (!isRunning || slotCount <= 0) return
    setFilledCount(0)

    const intervalId = window.setInterval(() => {
      setFilledCount((current) => advanceActionSweep(current, slotCount))
    }, ACTION_SWEEP_INTERVAL_MS)

    return () => window.clearInterval(intervalId)
  }, [isRunning, slotCount])

  return isRunning ? filledCount : 0
}
