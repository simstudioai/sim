'use client'

import { type DependencyList, useEffect } from 'react'

/** Timers one cycle schedules; cleared on restart, unmount, or motion change. */
type CycleTimer = ReturnType<typeof setTimeout>

interface MotionSafeCycleOptions {
  /**
   * Starts one animation cycle: resets the loop's state (including any
   * remount `cycleId` bump), schedules the cycle's beats, and returns the
   * pending timers plus the cycle's total length. The hook restarts the
   * cycle `totalMs` after it begins, so the callback only schedules the
   * beats within one cycle - including the final fade-out.
   */
  scheduleCycle: () => { timers: CycleTimer[]; totalMs: number }
  /** Jumps the loop to its finished frame for reduced-motion viewers. */
  showFinished: () => void
}

/**
 * The hero loops' shared clock scaffold: watches
 * `matchMedia('(prefers-reduced-motion: reduce)')` and either replays
 * {@link MotionSafeCycleOptions.scheduleCycle} on repeat or renders the
 * static finished frame via {@link MotionSafeCycleOptions.showFinished}.
 * Reacts live to preference changes and clears every pending timer on
 * restart, preference flip, and unmount.
 *
 * @param deps - Effect dependencies; the loop restarts from scratch when
 *   they change. Defaults to mount-only.
 */
export function useMotionSafeCycle(
  { scheduleCycle, showFinished }: MotionSafeCycleOptions,
  deps: DependencyList = []
) {
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    let timers: CycleTimer[] = []

    const clearScheduled = () => {
      timers.forEach(clearTimeout)
      timers = []
    }

    const runCycle = () => {
      const { timers: scheduled, totalMs } = scheduleCycle()
      timers = [...scheduled, setTimeout(runCycle, totalMs)]
    }

    const syncMotionPreference = () => {
      clearScheduled()
      if (media.matches) {
        showFinished()
        return
      }
      runCycle()
    }

    syncMotionPreference()
    media.addEventListener('change', syncMotionPreference)
    return () => {
      media.removeEventListener('change', syncMotionPreference)
      clearScheduled()
    }
  }, deps)
}
