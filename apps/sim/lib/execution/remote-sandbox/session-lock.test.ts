/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { acquire, extend, release } = vi.hoisted(() => ({
  acquire: vi.fn(),
  extend: vi.fn(),
  release: vi.fn(),
}))
vi.mock('@/lib/core/config/redis', () => ({
  acquireLock: acquire,
  extendLock: extend,
  releaseLock: release,
}))

import { withSandboxSessionLock } from '@/lib/execution/remote-sandbox/session-lock'

describe('sandbox session coordination', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    acquire.mockResolvedValue(true)
    extend.mockResolvedValue(true)
    release.mockResolvedValue(true)
  })

  it('does no provider work during a coordination outage or after losing ownership', async () => {
    const work = vi.fn().mockResolvedValue('ready')
    acquire.mockRejectedValueOnce(new Error('coordination unavailable'))
    await expect(
      withSandboxSessionLock('outage', new AbortController().signal, work)
    ).rejects.toThrow('coordination unavailable')
    expect(work).not.toHaveBeenCalled()
    extend.mockResolvedValueOnce(false)
    await expect(
      withSandboxSessionLock('outage', new AbortController().signal, work)
    ).rejects.toThrow('lease expired')
    expect(release).toHaveBeenCalledTimes(1)
    expect(await withSandboxSessionLock('outage', new AbortController().signal, work)).toBe('ready')
  })

  it('cancels a queued caller without disturbing the current owner or blocking later calls', async () => {
    let finish!: () => void
    let entered!: () => void
    const started = new Promise<void>((resolve) => {
      entered = resolve
    })
    const owner = withSandboxSessionLock('queue', new AbortController().signal, async () => {
      entered()
      await new Promise<void>((resolve) => {
        finish = resolve
      })
    })
    await started
    const cancelled = new AbortController()
    const work = vi.fn()
    const waiting = withSandboxSessionLock('queue', cancelled.signal, work)
    cancelled.abort()
    await expect(waiting).rejects.toThrow()
    expect(work).not.toHaveBeenCalled()
    expect(release).not.toHaveBeenCalled()
    finish()
    await owner
    await withSandboxSessionLock('queue', new AbortController().signal, work)
    expect(work).toHaveBeenCalledTimes(1)
  })
})
