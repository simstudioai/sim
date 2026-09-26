import { redisConfigMockFns } from '@sim/testing'
import { sleep } from '@sim/utils/helpers'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { withLeaderLock } from '@/lib/concurrency/leader-lock'

beforeEach(() => {
  redisConfigMockFns.mockAcquireLock.mockResolvedValue(true)
  redisConfigMockFns.mockReleaseLock.mockResolvedValue(true)
})

describe('withLeaderLock', () => {
  it('runs onLeader exactly once when lock acquired', async () => {
    const onLeader = vi.fn(async () => 'leader-result')
    const onFollower = vi.fn(async () => null)

    const result = await withLeaderLock<string>({
      key: 'k',
      onLeader,
      onFollower,
    })

    expect(result).toBe('leader-result')
    expect(onLeader).toHaveBeenCalledTimes(1)
    expect(onFollower).not.toHaveBeenCalled()
    expect(redisConfigMockFns.mockReleaseLock).toHaveBeenCalledTimes(1)
  })

  it('falls back to uncoordinated leader when acquireLock throws', async () => {
    redisConfigMockFns.mockAcquireLock.mockRejectedValueOnce(new Error('redis down'))

    const onLeader = vi.fn(async () => 'fallback')
    const onFollower = vi.fn(async () => null)

    const result = await withLeaderLock<string>({
      key: 'k',
      onLeader,
      onFollower,
    })

    expect(result).toBe('fallback')
    expect(onLeader).toHaveBeenCalledTimes(1)
    expect(onFollower).not.toHaveBeenCalled()
    expect(redisConfigMockFns.mockReleaseLock).not.toHaveBeenCalled()
  })

  it('releases the lock even when onLeader throws', async () => {
    const onLeader = vi.fn(async () => {
      throw new Error('boom')
    })

    await expect(
      withLeaderLock<string>({
        key: 'k',
        onLeader,
        onFollower: async () => null,
      })
    ).rejects.toThrow('boom')

    expect(redisConfigMockFns.mockReleaseLock).toHaveBeenCalledTimes(1)
  })

  it('follower polls onFollower until it returns non-null', async () => {
    redisConfigMockFns.mockAcquireLock.mockResolvedValueOnce(false)

    let polls = 0
    const onFollower = vi.fn(async () => {
      polls += 1
      if (polls >= 2) return 'available'
      return null
    })

    const result = await withLeaderLock<string>({
      key: 'k',
      pollIntervalMs: 5,
      maxWaitMs: 1000,
      onLeader: async () => 'should-not-run',
      onFollower,
    })

    expect(result).toBe('available')
    expect(onFollower.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('follower does a final read after timeout to catch a just-finished leader', async () => {
    redisConfigMockFns.mockAcquireLock.mockResolvedValueOnce(false)

    /**
     * The intent: after the in-loop poll deadline is reached, the follower
     * does exactly one more (last-chance) `onFollower` call to catch a leader
     * that finished between the previous poll and the timeout. Using fake
     * timers makes the timing deterministic — pollInterval=10 and maxWait=15
     * cause two in-loop polls (T+10, T+20) and one last-chance read (T+20),
     * but the schedule is driven by mocked time, not the CI wall clock.
     */
    vi.useFakeTimers()
    try {
      let polls = 0
      const onFollower = vi.fn(async () => {
        polls += 1
        if (polls <= 2) return null
        return 'late-leader'
      })

      const promise = withLeaderLock<string>({
        key: 'k',
        pollIntervalMs: 10,
        maxWaitMs: 15,
        onLeader: async () => 'should-not-run',
        onFollower,
      })

      await vi.advanceTimersByTimeAsync(30)
      const result = await promise

      expect(result).toBe('late-leader')
      expect(onFollower).toHaveBeenCalledTimes(3)
    } finally {
      vi.useRealTimers()
    }
  })

  it('only one of N concurrent callers acquires the lock', async () => {
    // Track which calls won the lock: first one returns true, rest return false.
    let acquired = false
    redisConfigMockFns.mockAcquireLock.mockImplementation(async () => {
      if (acquired) return false
      acquired = true
      return true
    })
    redisConfigMockFns.mockReleaseLock.mockImplementation(async () => {
      acquired = false
      return true
    })

    let leaderRuns = 0

    const callers = Array.from({ length: 5 }, () =>
      withLeaderLock<string>({
        key: 'shared',
        pollIntervalMs: 5,
        maxWaitMs: 200,
        onLeader: async () => {
          leaderRuns += 1
          await sleep(20)
          return 'leader-value'
        },
        onFollower: async () => (acquired ? null : 'follower-saw-released'),
      })
    )

    const results = await Promise.all(callers)
    expect(leaderRuns).toBe(1)
    expect(results.filter((r) => r === 'leader-value').length).toBe(1)
    expect(results.filter((r) => r === 'follower-saw-released').length).toBeGreaterThan(0)
  })
})
