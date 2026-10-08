import { describe, expect, it } from 'vitest'
import {
  desktopToolSession,
  stopAllDesktopTools,
  stopDesktopTools,
} from '@/app/workspace/[workspaceId]/home/hooks/desktop-tool-lifetimes'

describe('desktop tool leases', () => {
  it('cancels every running tool of the stopped turn and no other turn', () => {
    const first = desktopToolSession().turn('turn-a').lease()
    const second = desktopToolSession().turn('turn-a').lease()
    const other = desktopToolSession().turn('turn-b').lease()

    stopDesktopTools('turn-a', 'user_stop')

    expect(first.signal.aborted).toBe(true)
    expect(second.signal.aborted).toBe(true)
    expect(first.signal.reason).toBe('user_stop')
    expect(other.signal.aborted).toBe(false)
    other.release()
  })

  it('keeps a turn reachable by Stop while any of its tools still runs', () => {
    const settled = desktopToolSession().turn('turn-c').lease()
    const running = desktopToolSession().turn('turn-c').lease()
    for (let turn = 0; turn < 500; turn++)
      desktopToolSession().turn(`busy-${turn}`).lease().release()

    settled.release()
    settled.release()
    stopDesktopTools('turn-c', 'user_stop')

    expect(running.signal.aborted).toBe(true)
  })

  it('gives a turn whose tools all settled a fresh lifetime for its next tool', () => {
    const settled = desktopToolSession().turn('turn-d').lease()
    settled.release()
    stopDesktopTools('turn-d', 'user_stop')

    const next = desktopToolSession().turn('turn-d').lease()

    expect(settled.signal.aborted).toBe(false)
    expect(next.signal).not.toBe(settled.signal)
    expect(next.signal.aborted).toBe(false)
    next.release()
  })

  it('does not let a tool that settles after Stop release a newer lease on the turn', () => {
    const stopped = desktopToolSession().turn('turn-e').lease()
    stopDesktopTools('turn-e', 'user_stop')
    const next = desktopToolSession().turn('turn-e').lease()

    stopped.release()
    stopDesktopTools('turn-e', 'user_stop')

    expect(next.signal.aborted).toBe(true)
  })

  it('cancels the running tools of every turn when the session ends', () => {
    const first = desktopToolSession().turn('turn-f').lease()
    const second = desktopToolSession().turn('turn-g').lease()

    stopAllDesktopTools('signed_out')

    expect(first.signal.aborted).toBe(true)
    expect(second.signal.aborted).toBe(true)
    expect(first.signal.reason).toBe('signed_out')
    first.release()
    second.release()
  })

  it('cancels tools of a surface mounted before sign-out, even on a stream it reads later', () => {
    const surface = desktopToolSession()
    const running = surface.turn('turn-h')
    stopAllDesktopTools('signed_out')

    const late = running.lease()
    const reconnected = surface.turn('turn-j').lease()

    expect(late.signal.aborted).toBe(true)
    expect(late.signal.reason).toBe('signed_out')
    expect(reconnected.signal.aborted).toBe(true)
    late.release()
    reconnected.release()
  })

  it('runs the tools of a surface mounted after the session ended', () => {
    stopAllDesktopTools('signed_out')

    const next = desktopToolSession().turn('turn-i').lease()

    expect(next.signal.aborted).toBe(false)
    next.release()
  })
})
