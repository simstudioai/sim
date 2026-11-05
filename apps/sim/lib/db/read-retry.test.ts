import { sleep } from '@sim/utils/helpers'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  isTransientDatabaseReadError,
  withDatabaseReadRetry,
  withIdempotentWriteRetry,
} from '@/lib/db/read-retry'

function driverError(code: string): Error {
  return new Error('query wrapper', { cause: Object.assign(new Error('driver failure'), { code }) })
}

afterEach(() => vi.useRealTimers())

describe('independent database read retries', () => {
  it('does not start another read after the elapsed budget is spent', async () => {
    vi.useFakeTimers()
    const error = driverError('40001')
    let attempts = 0
    const result = expect(
      withDatabaseReadRetry(
        async () => {
          attempts++
          if (attempts > 1) return 'late recovery'
          await sleep(100)
          throw error
        },
        { maxElapsedMs: 50 }
      )
    ).rejects.toBe(error)
    await vi.runAllTimersAsync()
    await result
    expect(attempts).toBe(1)
  })

  it('supplies the remaining budget to each fresh read', async () => {
    vi.useFakeTimers()
    const budgets: Array<number | undefined> = []
    const result = withDatabaseReadRetry(
      async (remainingMs) => {
        budgets.push(remainingMs)
        if (budgets.length === 1) throw driverError('40001')
        return 'recovered'
      },
      { maxElapsedMs: 1000, maxAttempts: 2 }
    )
    await vi.runAllTimersAsync()
    await expect(result).resolves.toBe('recovered')
    expect(budgets[0]).toBe(1000)
    expect(budgets[1]).toBeGreaterThan(0)
    expect(budgets[1]).toBeLessThan(1000)
  })

  it.each(['08006', '57P01', '53300', '55P03', 'ECONNRESET', 'CONNECTION_CLOSED'])(
    'rebuilds a failed %s read and returns the recovered rows',
    async (code) => {
      vi.useFakeTimers()
      const rows = [{ id: 'source' }]
      const read = vi.fn().mockRejectedValueOnce(driverError(code)).mockResolvedValueOnce(rows)
      const result = withDatabaseReadRetry(read)
      await vi.runAllTimersAsync()
      await expect(result).resolves.toBe(rows)
      expect(read).toHaveBeenCalledTimes(2)
    }
  )

  it('stops after three attempts and preserves the final cause', async () => {
    vi.useFakeTimers()
    const error = driverError('ECONNRESET')
    const read = vi.fn().mockRejectedValue(error)
    const result = expect(withDatabaseReadRetry(read)).rejects.toBe(error)
    await vi.runAllTimersAsync()
    await result
    expect(read).toHaveBeenCalledTimes(3)
  })

  it.each(['23505', '23503', '42P01', '57014', '08P01'])(
    'does not retry a permanent error or query cancellation (%s)',
    async (code) => {
      const error = driverError(code)
      const read = vi.fn().mockRejectedValue(error)
      expect(isTransientDatabaseReadError(error)).toBe(false)
      await expect(withDatabaseReadRetry(read)).rejects.toBe(error)
      expect(read).toHaveBeenCalledOnce()
    }
  )

  it('does not retry an application error containing a transient code in its message', async () => {
    const error = new Error('ECONNRESET')
    const read = vi.fn().mockRejectedValue(error)
    await expect(withDatabaseReadRetry(read)).rejects.toBe(error)
    expect(read).toHaveBeenCalledOnce()
  })

  it('paces retries by the caller backoff, so a budget can outlast a burst of resets', async () => {
    vi.useFakeTimers()
    const read = vi.fn().mockRejectedValue(driverError('ECONNRESET'))
    const started = Date.now()
    const result = expect(
      withDatabaseReadRetry(read, { maxAttempts: 2, backoff: { baseMs: 1000, maxMs: 1000 } })
    ).rejects.toThrow()
    await vi.runAllTimersAsync()
    await result
    expect(Date.now() - started).toBeGreaterThanOrEqual(800)
  })
})

describe('idempotent database write retries', () => {
  /** A write's own error carries its statement, which is what marks a socket error as the database's. */
  function lostConnection(code = 'ECONNRESET'): Error {
    return Object.assign(new Error('Failed query: update "x"'), {
      query: 'update "x"',
      params: [],
      cause: Object.assign(new Error('read ECONNRESET'), { code }),
    })
  }

  it('repeats a write whose connection was lost and returns its result', async () => {
    vi.useFakeTimers()
    const write = vi.fn().mockRejectedValueOnce(lostConnection()).mockResolvedValueOnce('wrote')
    const result = withIdempotentWriteRetry(write)
    await vi.runAllTimersAsync()
    await expect(result).resolves.toBe('wrote')
    expect(write).toHaveBeenCalledTimes(2)
  })

  it.each(['55P03', '40P01', '40001', '53300', '57014', '23505'])(
    'surfaces %s rather than holding a worker through contention or repeating a rejected write',
    async (code) => {
      const error = Object.assign(new Error('rejected'), { code })
      const write = vi.fn().mockRejectedValue(error)
      await expect(withIdempotentWriteRetry(write)).rejects.toBe(error)
      expect(write).toHaveBeenCalledOnce()
    }
  )

  it('leaves a socket error that did not come from a query to the caller', async () => {
    const error = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' })
    const write = vi.fn().mockRejectedValue(error)
    await expect(withIdempotentWriteRetry(write)).rejects.toBe(error)
    expect(write).toHaveBeenCalledOnce()
  })

  it('stops at its attempt ceiling and preserves the final error', async () => {
    vi.useFakeTimers()
    const error = lostConnection()
    const write = vi.fn().mockRejectedValue(error)
    const result = expect(withIdempotentWriteRetry(write, { maxAttempts: 2 })).rejects.toBe(error)
    await vi.runAllTimersAsync()
    await result
    expect(write).toHaveBeenCalledTimes(2)
  })
})
