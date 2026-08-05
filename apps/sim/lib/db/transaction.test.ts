/**
 * @vitest-environment node
 */
import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isRetryableTransactionError, withTransactionRetry } from '@/lib/db/transaction'

/** Shaped like the `postgres` driver's error, which carries `code` on the error. */
function pgError(code: string): Error {
  return Object.assign(new Error(`pg error ${code}`), { code })
}

describe('withTransactionRetry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  describe('isRetryableTransactionError', () => {
    /**
     * `55P03` is what a caller's own `lock_timeout` raises. Excluding it would
     * make bounding the lock wait worse than not bounding it.
     */
    it.each(['40001', '40P01', '55P03'])('treats %s as retryable', (code) => {
      expect(isRetryableTransactionError(pgError(code))).toBe(true)
    })

    it.each(['23505', '23503', '42P01'])('treats %s as terminal', (code) => {
      expect(isRetryableTransactionError(pgError(code))).toBe(false)
    })

    it('treats a non-postgres error as terminal', () => {
      expect(isRetryableTransactionError(new Error('boom'))).toBe(false)
    })
  })

  it('returns the callback result without retrying when it succeeds', async () => {
    const fn = vi.fn().mockResolvedValue('ok')

    await expect(withTransactionRetry(fn)).resolves.toBe('ok')
    expect(dbChainMockFns.transaction).toHaveBeenCalledTimes(1)
  })

  it.each(['40001', '40P01', '55P03'])(
    'retries a %s abort and returns the later result',
    async (code) => {
      const fn = vi.fn().mockRejectedValueOnce(pgError(code)).mockResolvedValue('recovered')

      await expect(withTransactionRetry(fn)).resolves.toBe('recovered')
      expect(fn).toHaveBeenCalledTimes(2)
    }
  )

  it('gives up after the attempt cap and rethrows the driver error', async () => {
    const fn = vi.fn().mockRejectedValue(pgError('40P01'))

    await expect(withTransactionRetry(fn, { attempts: 3 })).rejects.toMatchObject({ code: '40P01' })
    expect(fn).toHaveBeenCalledTimes(3)
  })

  /**
   * The typed domain errors callers throw to force a rollback must not be
   * replayed — a second attempt would reach the same decision.
   */
  it('does not retry an error the database did not raise', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('membership changed'))

    await expect(withTransactionRetry(fn)).rejects.toThrow('membership changed')
    expect(fn).toHaveBeenCalledTimes(1)
  })
})
