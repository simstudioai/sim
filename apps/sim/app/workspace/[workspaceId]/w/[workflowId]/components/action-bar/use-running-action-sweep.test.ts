import { describe, expect, it } from 'vitest'
import { advanceActionSweep } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/action-bar/use-running-action-sweep'

describe('advanceActionSweep', () => {
  it('fills action slots cumulatively from left to right', () => {
    const first = advanceActionSweep(0, 3)
    const second = advanceActionSweep(first, 3)
    const third = advanceActionSweep(second, 3)

    expect([first, second, third]).toEqual([1, 2, 3])
  })

  it('restarts from empty once full, rather than draining back', () => {
    expect(advanceActionSweep(3, 3)).toBe(0)
    expect(advanceActionSweep(0, 3)).toBe(1)
  })

  it('stays empty when there are no action slots', () => {
    expect(advanceActionSweep(2, 0)).toBe(0)
  })
})
