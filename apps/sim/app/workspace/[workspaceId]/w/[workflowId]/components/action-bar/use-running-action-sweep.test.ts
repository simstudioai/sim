import { describe, expect, it } from 'vitest'
import {
  advanceActionSweep,
  INITIAL_ACTION_SWEEP_STATE,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/action-bar/use-running-action-sweep'

describe('advanceActionSweep', () => {
  it('fills action slots cumulatively from left to right', () => {
    const first = advanceActionSweep(INITIAL_ACTION_SWEEP_STATE, 3)
    const second = advanceActionSweep(first, 3)
    const third = advanceActionSweep(second, 3)

    expect([first.filledCount, second.filledCount, third.filledCount]).toEqual([1, 2, 3])
    expect(third.direction).toBe(-1)
  })

  it('empties action slots from right to left before restarting', () => {
    const second = advanceActionSweep({ filledCount: 3, direction: -1 }, 3)
    const first = advanceActionSweep(second, 3)
    const empty = advanceActionSweep(first, 3)

    expect([second.filledCount, first.filledCount, empty.filledCount]).toEqual([2, 1, 0])
    expect(empty.direction).toBe(1)
  })

  it('stays empty when there are no action slots', () => {
    expect(advanceActionSweep({ filledCount: 2, direction: -1 }, 0)).toEqual(
      INITIAL_ACTION_SWEEP_STATE
    )
  })
})
