import { describe, expect, it } from 'vitest'
import {
  leaseDesktopTool,
  stopAllDesktopTools,
  stopDesktopTools,
} from '@/app/workspace/[workspaceId]/home/hooks/desktop-tool-lifetimes'

describe('desktop tool leases', () => {
  it('cancels every running tool of the stopped turn and no other turn', () => {
    const first = leaseDesktopTool('turn-a')
    const second = leaseDesktopTool('turn-a')
    const other = leaseDesktopTool('turn-b')

    stopDesktopTools('turn-a', 'user_stop')

    expect(first.signal.aborted).toBe(true)
    expect(second.signal.aborted).toBe(true)
    expect(first.signal.reason).toBe('user_stop')
    expect(other.signal.aborted).toBe(false)
    other.release()
  })

  it('keeps a turn reachable by Stop while any of its tools still runs', () => {
    const settled = leaseDesktopTool('turn-c')
    const running = leaseDesktopTool('turn-c')
    for (let turn = 0; turn < 500; turn++) leaseDesktopTool(`busy-${turn}`).release()

    settled.release()
    settled.release()
    stopDesktopTools('turn-c', 'user_stop')

    expect(running.signal.aborted).toBe(true)
  })

  it('gives a turn whose tools all settled a fresh lifetime for its next tool', () => {
    const settled = leaseDesktopTool('turn-d')
    settled.release()
    stopDesktopTools('turn-d', 'user_stop')

    const next = leaseDesktopTool('turn-d')

    expect(settled.signal.aborted).toBe(false)
    expect(next.signal).not.toBe(settled.signal)
    expect(next.signal.aborted).toBe(false)
    next.release()
  })

  it('does not let a tool that settles after Stop release a newer lease on the turn', () => {
    const stopped = leaseDesktopTool('turn-e')
    stopDesktopTools('turn-e', 'user_stop')
    const next = leaseDesktopTool('turn-e')

    stopped.release()
    stopDesktopTools('turn-e', 'user_stop')

    expect(next.signal.aborted).toBe(true)
  })

  it('cancels the running tools of every turn when the session ends', () => {
    const first = leaseDesktopTool('turn-f')
    const second = leaseDesktopTool('turn-g')

    stopAllDesktopTools('signed_out')
    const next = leaseDesktopTool('turn-f')

    expect(first.signal.aborted).toBe(true)
    expect(second.signal.aborted).toBe(true)
    expect(first.signal.reason).toBe('signed_out')
    expect(next.signal.aborted).toBe(false)
    first.release()
    next.release()
  })
})
