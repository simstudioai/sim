/**
 * @vitest-environment node
 */
import { redisConfigMockFns } from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cascadeLockKey, withCascadeLock } from '@/lib/table/cascade-lock'

const TABLE_ID = 'tbl_1'
const ROW_ID = 'row_1'
const OWNER_ID = 'exec-1'

describe('withCascadeLock', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    redisConfigMockFns.mockAcquireLock.mockResolvedValue(true)
    redisConfigMockFns.mockReleaseLock.mockResolvedValue(true)
    redisConfigMockFns.mockExtendLock.mockResolvedValue(true)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('runs the work and releases under the owner that took the lock', async () => {
    const fn = vi.fn().mockResolvedValue('done')

    await expect(withCascadeLock(TABLE_ID, ROW_ID, OWNER_ID, fn)).resolves.toEqual({
      status: 'acquired',
      result: 'done',
    })
    expect(fn).toHaveBeenCalledOnce()
    expect(redisConfigMockFns.mockReleaseLock).toHaveBeenCalledWith(
      cascadeLockKey(TABLE_ID, ROW_ID),
      OWNER_ID
    )
  })

  it('skips the work when another task holds the row', async () => {
    redisConfigMockFns.mockAcquireLock.mockResolvedValue(false)
    const fn = vi.fn()

    await expect(withCascadeLock(TABLE_ID, ROW_ID, OWNER_ID, fn)).resolves.toEqual({
      status: 'contended',
    })
    expect(fn).not.toHaveBeenCalled()
    // Nothing was taken, so nothing may be deleted — the holder still owns it.
    expect(redisConfigMockFns.mockReleaseLock).not.toHaveBeenCalled()
  })

  it('reclaims a lock a timed-out acquire may have taken', async () => {
    // A client-side timeout does not mean Redis declined the SET: the command
    // can still land and hold the row for the full TTL under an owner that
    // already threw, silently starving every later cell task for that row.
    redisConfigMockFns.mockAcquireLock.mockRejectedValue(new Error('Command timed out'))
    const fn = vi.fn()

    await expect(withCascadeLock(TABLE_ID, ROW_ID, OWNER_ID, fn)).rejects.toThrow(
      'Command timed out'
    )
    expect(fn).not.toHaveBeenCalled()
    expect(redisConfigMockFns.mockAcquireLock).toHaveBeenCalledWith(
      cascadeLockKey(TABLE_ID, ROW_ID),
      OWNER_ID,
      expect.any(Number),
      { reclaimOnFailure: true }
    )
  })

  it('releases the lock when the work throws', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('boom'))

    await expect(withCascadeLock(TABLE_ID, ROW_ID, OWNER_ID, fn)).rejects.toThrow('boom')
    expect(redisConfigMockFns.mockReleaseLock).toHaveBeenCalledWith(
      cascadeLockKey(TABLE_ID, ROW_ID),
      OWNER_ID
    )
  })

  it('stops the heartbeat once the work settles', async () => {
    vi.useFakeTimers()
    const fn = vi.fn().mockResolvedValue(undefined)

    await withCascadeLock(TABLE_ID, ROW_ID, OWNER_ID, fn)
    await vi.advanceTimersByTimeAsync(60_000)

    // A heartbeat outliving the work would keep extending a lock nobody holds.
    expect(redisConfigMockFns.mockExtendLock).not.toHaveBeenCalled()
  })
})
