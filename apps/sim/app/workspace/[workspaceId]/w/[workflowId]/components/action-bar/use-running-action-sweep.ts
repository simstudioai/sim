import { useEffect, useState } from 'react'

const ACTION_SWEEP_INTERVAL_MS = 160

/**
 * Advances the cumulative action-slot sweep by one frame.
 *
 * Fills left to right and starts over — it does not drain back. A bar that
 * empties itself reads as undoing progress, which is the opposite of what a
 * running block is doing.
 */
export function advanceActionSweep(filledCount: number, slotCount: number): number {
  if (slotCount <= 0) return 0
  return filledCount >= slotCount ? 0 : filledCount + 1
}

/** Runs a cumulative left-to-right fill while a block executes. */
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
