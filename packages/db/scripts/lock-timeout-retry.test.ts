import { retryOnLockTimeout } from '@sim/db/scripts/lock-timeout-retry'
import { describe, expect, it, vi } from 'vitest'

const BACKOFF = { baseMs: 2_000, maxMs: 30_000 } as const

function pgError(code: string): Error {
  return Object.assign(new Error(`postgres error ${code}`), { code })
}

/** A fake clock that only advances when the retry loop sleeps. */
function fakeClock() {
  let nowMs = 0
  return {
    now: () => nowMs,
    sleep: vi.fn(async (ms: number) => {
      nowMs += ms
    }),
    advance: (ms: number) => {
      nowMs += ms
    },
  }
}

describe('retryOnLockTimeout', () => {
  it('keeps retrying lock timeouts well past eight attempts while the budget lasts', async () => {
    const clock = fakeClock()
    let calls = 0
    const result = await retryOnLockTimeout(
      async () => {
        calls++
        clock.advance(5_000)
        if (calls < 20) throw pgError('55P03')
        return 'applied'
      },
      { budgetMs: 20 * 60_000, backoff: BACKOFF, now: clock.now, sleep: clock.sleep }
    )

    expect(result).toBe('applied')
    expect(calls).toBe(20)
    expect(clock.sleep).toHaveBeenCalledTimes(19)
  })

  it('starts no attempt after the budget and throws the last lock timeout', async () => {
    const clock = fakeClock()
    const onRetry = vi.fn()
    const startedAt: number[] = []
    const attempt = vi.fn(async () => {
      startedAt.push(clock.now())
      clock.advance(5_000)
      throw pgError('55P03')
    })

    await expect(
      retryOnLockTimeout(attempt, {
        budgetMs: 2 * 60_000,
        backoff: BACKOFF,
        now: clock.now,
        sleep: clock.sleep,
        onRetry,
      })
    ).rejects.toMatchObject({ code: '55P03' })

    for (const start of startedAt) expect(start).toBeLessThan(2 * 60_000)
    /** The last attempt may run one lock timeout past the budget, never more. */
    expect(clock.now()).toBeLessThan(2 * 60_000 + 5_000)
    expect(attempt).toHaveBeenCalledTimes(onRetry.mock.calls.length + 1)
  })

  it('finds a lock timeout wrapped in a cause chain', async () => {
    const clock = fakeClock()
    let calls = 0
    await retryOnLockTimeout(
      async () => {
        calls++
        if (calls === 1) throw new Error('Failed query', { cause: pgError('55P03') })
      },
      { budgetMs: 60_000, backoff: BACKOFF, now: clock.now, sleep: clock.sleep }
    )

    expect(calls).toBe(2)
  })

  it('does not retry any other error', async () => {
    const clock = fakeClock()
    const attempt = vi.fn(async () => {
      throw pgError('42P07')
    })

    await expect(
      retryOnLockTimeout(attempt, {
        budgetMs: 60_000,
        backoff: BACKOFF,
        now: clock.now,
        sleep: clock.sleep,
      })
    ).rejects.toMatchObject({ code: '42P07' })
    expect(attempt).toHaveBeenCalledTimes(1)
    expect(clock.sleep).not.toHaveBeenCalled()
  })
})
