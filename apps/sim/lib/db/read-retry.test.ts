/** @vitest-environment node */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isTransientDatabaseReadError, withDatabaseReadRetry } from '@/lib/db/read-retry'

function driverError(code: string): Error {
  return new Error('query wrapper', { cause: Object.assign(new Error('driver failure'), { code }) })
}

afterEach(() => vi.useRealTimers())

describe('independent database read retries', () => {
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
})
