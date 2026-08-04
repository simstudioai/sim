import { useEffect, useState } from 'react'

const ACTION_SWEEP_INTERVAL_MS = 160

interface ActionSweepState {
  filledCount: number
  direction: 1 | -1
}

export const INITIAL_ACTION_SWEEP_STATE: ActionSweepState = {
  filledCount: 0,
  direction: 1,
}

/** Advances the cumulative action-slot sweep by one frame. */
export function advanceActionSweep(state: ActionSweepState, slotCount: number): ActionSweepState {
  if (slotCount <= 0) return INITIAL_ACTION_SWEEP_STATE

  const nextCount = state.filledCount + state.direction
  if (nextCount >= slotCount) {
    return { filledCount: slotCount, direction: -1 }
  }
  if (nextCount <= 0) {
    return INITIAL_ACTION_SWEEP_STATE
  }
  return { filledCount: nextCount, direction: state.direction }
}

/** Runs a cumulative left-to-right, right-to-left sweep while a block executes. */
export function useRunningActionSweep(isRunning: boolean, slotCount: number): number {
  const [state, setState] = useState<ActionSweepState>(INITIAL_ACTION_SWEEP_STATE)

  useEffect(() => {
    setState(INITIAL_ACTION_SWEEP_STATE)
    if (!isRunning || slotCount <= 0) return

    const intervalId = window.setInterval(() => {
      setState((current) => advanceActionSweep(current, slotCount))
    }, ACTION_SWEEP_INTERVAL_MS)

    return () => window.clearInterval(intervalId)
  }, [isRunning, slotCount])

  return isRunning ? state.filledCount : 0
}
